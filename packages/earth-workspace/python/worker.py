#!/usr/bin/env python3
"""Typed ScoutPi Earth Engine worker. It never evaluates model-generated code."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import math
import os
import statistics
import sys
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


RUNTIME_BACKENDS = {
    "earthengine": ("ee", "earthengine-api", "cloud compute, tasks and tiles"),
    "geemap": ("geemap", "geemap", "interactive review and map export"),
    "geedim": ("geedim", "geedim", "tiled GeoTIFF, NumPy and Xarray export"),
    "geetools": ("geetools", "geetools", "reviewed preprocessing and server-side operations"),
    "leafmap": ("leafmap", "leafmap", "local raster, vector, STAC and database workbench"),
    "wxee": ("wxee", "wxee", "Earth Engine to Xarray climate workflows"),
    "xee": ("xee", "xee", "lazy Xarray Earth Engine backend"),
    "samgeo": ("samgeo", "segment-geospatial", "optional geospatial segmentation adapter"),
    "hydrafloods": ("hydrafloods", "hydrafloods", "optional flood workflow adapter"),
}


def runtime_backends() -> list[dict[str, Any]]:
    rows = []
    for backend_id, (module_name, distribution, purpose) in RUNTIME_BACKENDS.items():
        installed = importlib.util.find_spec(module_name) is not None
        package_version = None
        if installed:
            try:
                package_version = version(distribution)
            except PackageNotFoundError:
                package_version = "unknown"
        rows.append({"id": backend_id, "installed": installed, "version": package_version, "purpose": purpose})
    return rows


def response(**payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def region_geometry(ee: Any, region: dict[str, Any]) -> Any:
    kind = region.get("kind")
    if kind == "bbox":
        return ee.Geometry.Rectangle(region["bbox"])
    if kind == "geojson":
        return ee.Geometry(region["geometry"])
    if kind == "asset":
        return ee.FeatureCollection(region["assetId"]).geometry()
    raise ValueError(f"Unsupported region kind: {kind}")


def mask_collection(ee: Any, collection: Any, quality_mask: dict[str, Any] | None) -> Any:
    if not quality_mask:
        return collection

    rules = list(quality_mask.get("rules") or [])

    def apply_mask(image: Any) -> Any:
        combined = ee.Image.constant(1)
        for rule in rules:
            band = image.select(rule["band"])
            operation = rule["op"]
            if operation == "eq":
                current = band.eq(float(rule["value"]))
            elif operation == "neq":
                current = band.neq(float(rule["value"]))
            elif operation == "lt":
                current = band.lt(float(rule["value"]))
            elif operation == "lte":
                current = band.lte(float(rule["value"]))
            elif operation == "gt":
                current = band.gt(float(rule["value"]))
            elif operation == "gte":
                current = band.gte(float(rule["value"]))
            elif operation == "bit_clear":
                current = band.bitwiseAnd(1 << int(rule["bit"])).eq(0)
            elif operation == "bit_set":
                current = band.bitwiseAnd(1 << int(rule["bit"])).neq(0)
            else:
                raise ValueError(f"Unsupported quality-mask operation: {operation}")
            combined = combined.And(current)
        return image.updateMask(combined)

    return collection.map(apply_mask)


def metric_image(ee: Any, collection: Any, analysis: dict[str, Any]) -> Any:
    metric = analysis["metric"]
    bands = analysis["bands"]
    if metric == "normalized_difference_mean":
        image = collection.median().normalizedDifference(bands[:2]).rename(analysis["outputName"])
    elif metric in {"band_mean", "class_probability_mean"}:
        image = collection.select(bands[0]).mean().rename(analysis["outputName"])
    elif metric == "threshold_fraction":
        source = collection.select(bands[0]).mean()
        threshold = float(analysis.get("threshold", 0.5))
        image = (source.eq(threshold) if analysis.get("comparison") == "eq" else source.gte(threshold)).rename(analysis["outputName"])
    elif metric == "band_sum":
        image = collection.select(bands[0]).sum().rename(analysis["outputName"])
    else:
        raise ValueError(f"Unsupported metric: {metric}")
    scale_factor = analysis.get("scaleFactor")
    offset = analysis.get("offset")
    if scale_factor is not None:
        image = image.multiply(float(scale_factor))
    if offset is not None:
        image = image.add(float(offset))
    return image


def annual_features(ee: Any, plan: dict[str, Any], dataset_item: dict[str, Any], geometry: Any) -> Any:
    spec = plan["spec"]
    period = spec["period"]
    dataset = dataset_item["dataset"]
    start_month = int(period.get("startMonth", 1))
    end_month = int(period.get("endMonth", 12))
    features = []
    for year in range(int(period["startYear"]), int(period["endYear"]) + 1):
        image = metric_for_year(ee, dataset, geometry, year, start_month, end_month)
        reduced = image.reduceRegion(
            reducer=ee.Reducer.mean(), geometry=geometry,
            scale=max(float(dataset["scaleMeters"]), 10.0), bestEffort=True, maxPixels=10_000_000_000,
        )
        features.append(ee.Feature(None, reduced).set({"year": year, "role": dataset_item["role"], "dataset_id": dataset["datasetId"]}))
    return ee.FeatureCollection(features)


def metric_for_year(ee: Any, dataset: dict[str, Any], geometry: Any, year: int, start_month: int, end_month: int) -> Any:
    start = ee.Date.fromYMD(year, start_month, 1)
    end = ee.Date.fromYMD(year + (1 if end_month < start_month else 0), end_month, 1).advance(1, "month")
    collection = ee.ImageCollection(dataset["collectionId"]).filterBounds(geometry).filterDate(start, end)
    collection = mask_collection(ee, collection, dataset["analysis"].get("qualityMask"))
    return metric_image(ee, collection, dataset["analysis"])


def initialize_ee(project: str | None) -> tuple[Any | None, dict[str, Any] | None]:
    try:
        import ee  # type: ignore
    except ImportError:
        return None, {"ok": False, "code": "GEE_NOT_INSTALLED", "error": "Install earthengine-api in the selected Python environment."}
    try:
        ee.Initialize(project=project or os.getenv("EARTHENGINE_PROJECT"))
        return ee, None
    except Exception as exc:
        return None, {"ok": False, "code": "GEE_AUTH_REQUIRED", "error": str(exc)}


def requested_adapter_bands(adapter: dict[str, Any]) -> list[str]:
    analyses = [adapter["analysis"], *(adapter.get("analysisByRole") or {}).values()]
    bands: set[str] = set()
    for analysis in analyses:
        bands.update(str(value) for value in analysis.get("bands") or [])
        for rule in (analysis.get("qualityMask") or {}).get("rules") or []:
            bands.add(str(rule["band"]))
    return sorted(bands)


def probe_adapter(payload: dict[str, Any]) -> dict[str, Any]:
    adapter = payload["adapter"]
    ee, error = initialize_ee(payload.get("cloudProject"))
    if error:
        return error
    requested_year = payload.get("year")
    final_year = int(adapter.get("endYear") or datetime.now(timezone.utc).year - 1)
    year = int(requested_year if requested_year is not None else max(int(adapter["startYear"]), final_year))
    collection = ee.ImageCollection(adapter["collectionId"]).filterDate(
        ee.Date.fromYMD(year, 1, 1), ee.Date.fromYMD(year + 1, 1, 1)
    )
    if payload.get("region"):
        collection = collection.filterBounds(region_geometry(ee, payload["region"]))
    collection_size = int(collection.limit(2).size().getInfo())
    if collection_size == 0:
        return {
            "ok": False,
            "code": "ADAPTER_PROBE_EMPTY",
            "error": f"No images were found for {adapter['collectionId']} in {year}.",
        }
    sample = ee.Image(collection.first())
    available_bands = [str(value) for value in sample.bandNames().getInfo()]
    requested_bands = requested_adapter_bands(adapter)
    missing = sorted(set(requested_bands) - set(available_bands))
    if missing:
        return {
            "ok": False,
            "code": "ADAPTER_PROBE_BANDS_MISSING",
            "error": f"Missing bands: {', '.join(missing)}",
            "availableBands": available_bands,
            "requestedBands": requested_bands,
        }
    analyses = [adapter["analysis"], *(adapter.get("analysisByRole") or {}).values()]
    output_bands: set[str] = set()
    for analysis in analyses:
        prepared = mask_collection(ee, collection, analysis.get("qualityMask"))
        output_bands.update(str(value) for value in metric_image(ee, prepared, analysis).bandNames().getInfo())
    sample_time = None
    try:
        sample_time = ee.Date(sample.get("system:time_start")).format("YYYY-MM-dd").getInfo()
    except Exception:
        pass
    return {
        "ok": True,
        "datasetId": adapter["datasetId"],
        "sampleCount": collection_size,
        "availableBands": available_bands,
        "requestedBands": requested_bands,
        "outputBands": sorted(output_bands),
        "sampleTime": sample_time,
        "year": year,
    }


def run_plan(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload["plan"]
    artifact_dir = Path(payload["artifactDir"])
    artifact_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "planId": plan["planId"], "question": plan["spec"]["question"],
        "datasets": [{"role": row["role"], "collectionId": row["dataset"]["collectionId"], "analysis": row["dataset"]["analysis"]} for row in plan["datasets"]],
        "dag": plan["dag"], "criticChecks": plan["criticChecks"],
    }
    (artifact_dir / "execution_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if payload.get("mode") == "dry_run":
        return {"ok": True, "mode": "dry_run", "artifact": str(artifact_dir / "execution_manifest.json"), "taskIds": [], "manifest": manifest}

    options = payload.get("options", {})
    ee, error = initialize_ee(options.get("cloudProject"))
    if error:
        return error
    geometry = region_geometry(ee, plan["spec"]["region"])
    collections = [annual_features(ee, plan, row, geometry) for row in plan["datasets"]]
    merged = ee.FeatureCollection([])
    for collection in collections:
        merged = merged.merge(collection)

    if options.get("execution") == "drive":
        description = f"scoutpi_{plan['spec']['investigationId']}"
        folder = options.get("driveFolder") or "ScoutPi_Earth"
        outputs = set(options.get("outputs") or ["table_csv", "change_geotiff"])
        tasks = []
        if "table_csv" in outputs or "table_geojson" in outputs:
            file_format = "GeoJSON" if "table_geojson" in outputs and "table_csv" not in outputs else "CSV"
            task = ee.batch.Export.table.toDrive(collection=merged, description=f"{description}_metrics", folder=folder, fileNamePrefix=f"{description}_metrics", fileFormat=file_format)
            task.start()
            tasks.append(task.status())
        if "change_geotiff" in outputs:
            period = plan["spec"]["period"]
            start_month = int(period.get("startMonth", 1))
            end_month = int(period.get("endMonth", 12))
            for row in plan["datasets"]:
                dataset = row["dataset"]
                baseline = metric_for_year(ee, dataset, geometry, int(period["startYear"]), start_month, end_month)
                target = metric_for_year(ee, dataset, geometry, int(period["endYear"]), start_month, end_month)
                change = target.subtract(baseline).rename(f"{dataset['analysis']['outputName']}_change")
                image_task = ee.batch.Export.image.toDrive(
                    image=change, description=f"{description}_{row['role']}_change", folder=folder,
                    fileNamePrefix=f"{description}_{row['role']}_change", region=geometry,
                    scale=max(float(dataset["scaleMeters"]), 10.0), maxPixels=10_000_000_000,
                    fileFormat="GeoTIFF", formatOptions={"cloudOptimized": True},
                )
                image_task.start()
                tasks.append(image_task.status())
        return {"ok": True, "mode": "live", "execution": "drive", "taskIds": [status.get("id") for status in tasks if status.get("id")], "taskStatus": tasks, "artifact": str(artifact_dir / "execution_manifest.json")}

    info = merged.getInfo()
    result_path = artifact_dir / "yearly_metrics.json"
    result_path.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "mode": "live", "execution": "inline", "taskIds": [], "metricsPath": str(result_path), "artifact": str(artifact_dir / "execution_manifest.json")}


def task_status(payload: dict[str, Any]) -> dict[str, Any]:
    ee, error = initialize_ee(payload.get("cloudProject"))
    if error:
        return error
    ids = set(str(value) for value in payload.get("taskIds", []))
    tasks = [task.status() for task in ee.batch.Task.list() if str(task.id) in ids]
    return {"ok": True, "tasks": tasks}


def visualize_plan(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload["plan"]
    role = str(payload["role"])
    year = int(payload["year"])
    dataset_item = next((row for row in plan["datasets"] if row["role"] == role), None)
    if dataset_item is None:
        return {"ok": False, "code": "VISUALIZATION_ROLE_INVALID", "error": f"Role {role} is not part of this plan."}
    analysis = dataset_item["dataset"]["analysis"]
    visualization = analysis.get("visualization")
    if not visualization:
        return {"ok": False, "code": "VISUALIZATION_NOT_CONFIGURED", "error": f"Role {role} has no reviewed visualization contract."}
    ee, error = initialize_ee(payload.get("cloudProject"))
    if error:
        return error
    geometry = region_geometry(ee, plan["spec"]["region"])
    period = plan["spec"]["period"]
    image = metric_for_year(
        ee,
        dataset_item["dataset"],
        geometry,
        year,
        int(period.get("startMonth", 1)),
        int(period.get("endMonth", 12)),
    ).clip(geometry)
    map_info = image.getMapId({
        "min": float(visualization["min"]),
        "max": float(visualization["max"]),
        "palette": list(visualization["palette"]),
    })
    return {
        "ok": True,
        "planId": plan["planId"],
        "role": role,
        "year": year,
        "datasetId": dataset_item["dataset"]["datasetId"],
        "outputName": analysis["outputName"],
        "tileUrl": map_info["tile_fetcher"].url_format,
        "mapId": map_info.get("mapid", ""),
        "legend": visualization,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


def export_local(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        import geedim  # noqa: F401  # type: ignore
    except ImportError:
        return {
            "ok": False,
            "code": "GEEDIM_NOT_INSTALLED",
            "error": "Install the pipeline extra with: uv sync --extra pipeline",
        }

    plan = payload["plan"]
    request = payload["request"]
    role = str(request["role"])
    dataset_item = next((row for row in plan["datasets"] if row["role"] == role), None)
    if dataset_item is None:
        return {"ok": False, "code": "EXPORT_ROLE_INVALID", "error": f"Role {role} is not part of this plan."}
    ee, error = initialize_ee(request.get("cloudProject"))
    if error:
        return error
    geometry = region_geometry(ee, plan["spec"]["region"])
    period = plan["spec"]["period"]
    start_month = int(period.get("startMonth", 1))
    end_month = int(period.get("endMonth", 12))
    dataset = dataset_item["dataset"]
    kind = request.get("kind", "year")
    if kind == "change":
        baseline_year = int(request["baselineYear"])
        target_year = int(request["targetYear"])
        baseline = metric_for_year(ee, dataset, geometry, baseline_year, start_month, end_month)
        target = metric_for_year(ee, dataset, geometry, target_year, start_month, end_month)
        image = target.subtract(baseline).rename(f"{dataset['analysis']['outputName']}_change")
        period_label = f"{baseline_year}-{target_year}-change"
    else:
        year = int(request["year"])
        image = metric_for_year(ee, dataset, geometry, year, start_month, end_month)
        period_label = str(year)

    artifact_dir = Path(payload["artifactDir"])
    artifact_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{role}_{period_label}.tif"
    output_path = artifact_dir / filename
    prepared = image.clip(geometry).gd.prepareForExport(
        crs=str(request.get("crs") or "EPSG:4326"),
        region=geometry,
        scale=float(request["scaleMeters"]),
        dtype=str(request.get("dtype") or "float32"),
    )
    prepared.gd.toGeoTIFF(str(output_path))
    digest = sha256_file(output_path)
    manifest = {
        "schemaVersion": "scoutpi.earth.local-export.v1",
        "planId": plan["planId"],
        "datasetId": dataset["datasetId"],
        "role": role,
        "kind": kind,
        "period": period_label,
        "format": "geotiff",
        "scaleMeters": float(request["scaleMeters"]),
        "crs": str(request.get("crs") or "EPSG:4326"),
        "dtype": str(request.get("dtype") or "float32"),
        "path": str(output_path),
        "bytes": output_path.stat().st_size,
        "sha256": digest,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path = artifact_dir / "local_export.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "execution": "local_export",
        "backend": "geedim",
        "artifact": str(output_path),
        "manifest": str(manifest_path),
        "bytes": manifest["bytes"],
        "sha256": digest,
    }


def cancel_tasks(payload: dict[str, Any]) -> dict[str, Any]:
    ee, error = initialize_ee(payload.get("cloudProject"))
    if error:
        return error
    tasks = []
    for task_id in [str(value) for value in payload.get("taskIds", [])]:
        ee.data.cancelTask(task_id)
        tasks.append({"id": task_id, "state": "CANCEL_REQUESTED"})
    return {"ok": True, "tasks": tasks}


def environment_status(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        import ee  # type: ignore
        version = getattr(ee, "__version__", "unknown")
    except ImportError:
        return {"ok": True, "installed": False, "authenticated": False, "code": "GEE_NOT_INSTALLED", "backends": runtime_backends()}
    try:
        ee.Initialize(project=payload.get("cloudProject") or os.getenv("EARTHENGINE_PROJECT"))
        return {"ok": True, "installed": True, "authenticated": True, "earthengineVersion": version, "project": payload.get("cloudProject") or os.getenv("EARTHENGINE_PROJECT"), "backends": runtime_backends()}
    except Exception as exc:
        return {"ok": True, "installed": True, "authenticated": False, "earthengineVersion": version, "code": "GEE_AUTH_REQUIRED", "message": str(exc), "backends": runtime_backends()}


def load_rows(path: Path) -> list[dict[str, Any]]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as handle:
            return list(csv.DictReader(handle))
    value = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict) and isinstance(value.get("features"), list):
        return [row.get("properties", {}) for row in value["features"]]
    raise ValueError("Analysis input must be CSV, a JSON row list, or a GeoJSON FeatureCollection")


def ols(values: list[float]) -> dict[str, float]:
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = statistics.fmean(values)
    denominator = sum((index - x_mean) ** 2 for index in range(n))
    slope = sum((index - x_mean) * (value - y_mean) for index, value in enumerate(values)) / denominator if denominator else 0.0
    fitted = [y_mean + slope * (index - x_mean) for index in range(n)]
    ss_res = sum((value - prediction) ** 2 for value, prediction in zip(values, fitted))
    ss_tot = sum((value - y_mean) ** 2 for value in values)
    return {"slope_per_step": slope, "r_squared": 1 - ss_res / ss_tot if ss_tot else 1.0}


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    path = Path(payload["path"])
    rows = load_rows(path)
    requested = set(payload.get("columns") or [])
    numeric: dict[str, list[float]] = {}
    for row in rows:
        for key, raw in row.items():
            if requested and key not in requested:
                continue
            try:
                value = float(raw)
                if math.isfinite(value):
                    numeric.setdefault(key, []).append(value)
            except (TypeError, ValueError):
                pass
    summaries = {}
    for key, values in numeric.items():
        summaries[key] = {
            "count": len(values), "mean": statistics.fmean(values), "min": min(values), "max": max(values),
            "stddev": statistics.stdev(values) if len(values) > 1 else 0.0,
            "trend": ols(values) if len(values) > 1 else None,
        }
    artifact_dir = Path(payload["artifactDir"])
    artifact_dir.mkdir(parents=True, exist_ok=True)
    output = artifact_dir / f"analysis_{path.stem}.json"
    result = {"source": str(path), "rowCount": len(rows), "columns": summaries, "warnings": [] if summaries else ["No numeric columns were found."]}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "summary": result, "artifact": str(output)}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read())
        operation = payload.get("op")
        if operation == "run":
            result = run_plan(payload)
        elif operation == "status":
            result = task_status(payload)
        elif operation == "visualize":
            result = visualize_plan(payload)
        elif operation == "probe_adapter":
            result = probe_adapter(payload)
        elif operation == "export_local":
            result = export_local(payload)
        elif operation == "cancel":
            result = cancel_tasks(payload)
        elif operation == "analyze":
            result = analyze(payload)
        elif operation == "environment":
            result = environment_status(payload)
        else:
            result = {"ok": False, "code": "UNSUPPORTED_OPERATION", "error": str(operation)}
        response(**result)
        return 0 if result.get("ok") else 2
    except Exception as exc:
        response(ok=False, code="WORKER_FAILED", error=str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
