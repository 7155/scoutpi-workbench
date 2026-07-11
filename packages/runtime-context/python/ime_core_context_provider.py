from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


MAX_REQUEST_BYTES = 256 * 1024
MAX_TEXT_CHARS = 2_000
SECRET_PATTERN = re.compile(
    r"(?:\bsk-[A-Za-z0-9_-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._~-]{12,}|(?:password|secret|token)\s*[:=]\s*\S{6,})",
    re.IGNORECASE,
)


def _fail(code: str, message: str) -> dict[str, object]:
    return {"ok": False, "error": {"code": code, "message": message}}


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.replace("\x00", "").split())[:limit]


def _safe_path(value: object, *, directory: bool) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError("path is required")
    path = Path(value).expanduser().resolve(strict=True)
    if directory and not path.is_dir():
        raise ValueError("directory is required")
    if not directory and not path.is_file():
        raise ValueError("file is required")
    return path


def _kind(value: object) -> str:
    source = _text(value, 80).lower()
    for needle, kind in (
        ("failure", "failure_pattern"),
        ("workflow", "workflow"),
        ("procedure", "procedure"),
        ("decision", "decision"),
        ("project", "project_state"),
        ("preference", "preference"),
    ):
        if needle in source:
            return kind
    return "fact"


def _candidate(provider_id: str, raw: dict[str, Any]) -> dict[str, object] | None:
    text = _text(raw.get("text"), MAX_TEXT_CHARS)
    if not text or SECRET_PATTERN.search(text):
        return None
    memory_ids = [_text(item, 180) for item in raw.get("memoryIds", []) if _text(item, 180)][:8]
    source_id = memory_ids[0] if memory_ids else hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]
    source_type = _text(raw.get("sourceType"), 80)
    memory_kind = _text(raw.get("memoryKind"), 80)
    score = float(raw.get("score") or 0.0)
    confidence = max(0.05, min(1.0, score))
    candidate_id = "ime:" + hashlib.sha256(f"{source_id}:{text}".encode("utf-8")).hexdigest()[:24]
    evidence = _text(raw.get("evidencePreview"), 500)
    if evidence and SECRET_PATTERN.search(evidence):
        evidence = ""
    return {
        "candidateId": candidate_id,
        "kind": _kind(memory_kind),
        "text": text,
        "confidence": confidence,
        "trust": "external_memory",
        "tags": [item for item in (source_type, memory_kind, "ime-core") if item],
        "provenance": {
            "providerId": provider_id,
            "sourceId": source_id,
            **({"sourceRef": evidence} if evidence else {}),
        },
    }


def _query(request: dict[str, Any]) -> dict[str, object]:
    core_root = _safe_path(request.get("coreRoot"), directory=True)
    db_path = _safe_path(request.get("dbPath"), directory=False)
    if not (core_root / "rag_ime" / "local_sqlite_core.py").is_file():
        return _fail("IME_CORE_MODULE_MISSING", "RAG Core module is missing")
    sys.path.insert(0, str(core_root))
    from rag_ime.local_sqlite_core import LocalSqliteCoreClient
    from rag_ime.memory_models import ImeQueryContext

    query = _text(request.get("query"), 4_000)
    if not query or SECRET_PATTERN.search(query):
        return _fail("IME_CORE_QUERY_REJECTED", "query is empty or sensitive")
    top_k = max(1, min(16, int(request.get("topK") or 8)))
    started = time.perf_counter()
    core = LocalSqliteCoreClient(db_path)
    result = core.retrieve_candidates_v2(
        context=ImeQueryContext(
            current_input=query,
            app=_text(request.get("app"), 120),
            project=_text(request.get("project"), 200),
            top_k=top_k,
            source_budget_ms=max(20, min(2_000, int(request.get("sourceBudgetMs") or 400))),
            allow_cold_knowledge=True,
            allow_raw_event_candidates=False,
        )
    )
    provider_id = "wisdom-weasel-rag-ime"
    items = []
    for raw in result.get("candidates", []):
        if not isinstance(raw, dict):
            continue
        item = _candidate(provider_id, raw)
        if item:
            items.append(item)
        if len(items) >= top_k:
            break
    latency_ms = round((time.perf_counter() - started) * 1_000, 2)
    return {
        "ok": True,
        "envelope": {
            "schemaVersion": "scoutpi.context.candidates.v1",
            "providerId": provider_id,
            "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "items": items,
        },
        "diagnostics": {
            "latencyMs": latency_ms,
            "candidateCount": len(items),
            "rawHistoryReturned": False,
        },
    }


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        response = _fail("IME_CORE_REQUEST_TOO_LARGE", "request exceeds 256 KB")
    else:
        try:
            request = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(request, dict) or request.get("schemaVersion") != "scoutpi.context-provider.request.v1":
                response = _fail("IME_CORE_REQUEST_INVALID", "request contract is invalid")
            elif request.get("op") != "query":
                response = _fail("IME_CORE_OPERATION_BLOCKED", "only query is supported")
            else:
                response = _query(request)
        except Exception:
            response = _fail("IME_CORE_PROVIDER_FAILED", "provider query failed")
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0 if response.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
