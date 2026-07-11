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
MAX_WRITEBACK_ITEMS = 24
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


def _canonical_sha256(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _writeback_candidate(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError("writeback candidate must be an object")
    candidate_id = _text(raw.get("candidateId"), 240)
    kind = _text(raw.get("kind"), 80)
    text = _text(raw.get("text"), 1_000)
    if not candidate_id or kind not in {"procedure", "project_state", "failure_pattern", "workflow"}:
        raise ValueError("writeback candidate identity is invalid")
    if not text or SECRET_PATTERN.search(text):
        raise ValueError("writeback candidate text is empty or sensitive")
    tags = []
    for item in raw.get("tags", []):
        tag = _text(item, 80).lower()
        if tag and tag not in tags:
            tags.append(tag)
        if len(tags) >= 24:
            break
    return {"candidateId": candidate_id, "kind": kind, "text": text, "tags": tags}


def _writeback(request: dict[str, Any]) -> dict[str, object]:
    core_root = _safe_path(request.get("coreRoot"), directory=True)
    db_path = _safe_path(request.get("dbPath"), directory=False)
    writeback = request.get("writeback")
    delivery = request.get("delivery")
    if not isinstance(writeback, dict) or not isinstance(delivery, dict):
        return _fail("IME_CORE_WRITEBACK_INVALID", "writeback and delivery are required")
    if writeback.get("schemaVersion") != "scoutpi.context.writeback.v1" or delivery.get("schemaVersion") != "scoutpi.context.writeback-delivery.v1":
        return _fail("IME_CORE_WRITEBACK_INVALID", "writeback contract is invalid")
    if writeback.get("state") != "approved" or writeback.get("approvedBy") != "user":
        return _fail("IME_CORE_WRITEBACK_NOT_APPROVED", "direct user approval is required")
    approval_id = _text(writeback.get("approvalId"), 240)
    writeback_id = _text(writeback.get("writebackId"), 240)
    delivery_id = _text(delivery.get("deliveryId"), 240)
    provider_id = _text(delivery.get("providerId"), 120)
    if not approval_id or not writeback_id or not delivery_id or provider_id != "wisdom-weasel-rag-ime":
        return _fail("IME_CORE_WRITEBACK_INVALID", "writeback identity is invalid")
    if delivery.get("writebackId") != writeback_id or delivery.get("approvalId") != approval_id:
        return _fail("IME_CORE_WRITEBACK_MISMATCH", "delivery is not bound to the approved writeback")
    raw_candidates = writeback.get("candidates")
    if not isinstance(raw_candidates, list) or not 1 <= len(raw_candidates) <= MAX_WRITEBACK_ITEMS:
        return _fail("IME_CORE_WRITEBACK_INVALID", "writeback candidate count is invalid")
    payload_sha256 = _text(writeback.get("payloadSha256"), 64)
    if writeback.get("payloadHashAlgorithm") != "sha256-canonical-json-v1" or _canonical_sha256(raw_candidates) != payload_sha256 or delivery.get("payloadSha256") != payload_sha256:
        return _fail("IME_CORE_WRITEBACK_INTEGRITY_FAILED", "writeback payload integrity check failed")
    candidates = [_writeback_candidate(item) for item in raw_candidates]
    if not (core_root / "rag_ime" / "adapter.py").is_file():
        return _fail("IME_CORE_WRITEBACK_API_MISSING", "RAG Core adapter is missing")
    sys.path.insert(0, str(core_root))
    from rag_ime.adapter import InputMethodAdapter
    from rag_ime.local_sqlite_core import LocalSqliteCoreClient

    started = time.perf_counter()
    core = LocalSqliteCoreClient(db_path)
    adapter = InputMethodAdapter(core, project=_text(request.get("project"), 200) or "scoutpi-workbench")
    receipts = []
    duplicate_count = 0
    for candidate in candidates:
        candidate_id = str(candidate["candidateId"])
        idempotency_tag = "scoutpi-writeback:" + hashlib.sha256(f"{writeback_id}:{candidate_id}".encode("utf-8")).hexdigest()
        if core.has_event_tag(idempotency_tag):
            duplicate_count += 1
            receipts.append({"candidateId": candidate_id, "state": "duplicate", "eventId": "existing"})
            continue
        event_id = adapter.commit_text(
            str(candidate["text"]),
            recent_context=f"ScoutPi approved context writeback {writeback_id}",
            project=_text(request.get("project"), 200) or "scoutpi-workbench",
            app="ScoutPi",
            privacy_disposition="allowed",
            field_is_sensitive=False,
            source="scoutpi_context_writeback",
            provider_name="scoutpi-context",
            tags=tuple(dict.fromkeys(("scoutpi", "context-writeback", str(candidate["kind"]), idempotency_tag, *candidate["tags"]))),
        )
        if not isinstance(event_id, str) or not event_id or event_id.startswith("skipped:"):
            raise RuntimeError("RAG Core rejected an approved writeback item")
        receipts.append({"candidateId": candidate_id, "state": "delivered", "eventId": event_id})
    return {
        "ok": True,
        "receipt": {
            "schemaVersion": "scoutpi.context-provider.receipt.v1",
            "providerId": provider_id,
            "deliveryId": delivery_id,
            "deliveredAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "itemCount": len(receipts),
            "duplicateCount": duplicate_count,
            "items": receipts,
            "latencyMs": round((time.perf_counter() - started) * 1_000, 2),
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
            elif request.get("op") == "query":
                response = _query(request)
            elif request.get("op") == "writeback":
                response = _writeback(request)
            else:
                response = _fail("IME_CORE_OPERATION_BLOCKED", "operation is not supported")
        except Exception:
            response = _fail("IME_CORE_PROVIDER_FAILED", "provider query failed")
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    return 0 if response.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
