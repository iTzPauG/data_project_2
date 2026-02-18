"""Dashboard read-path service: BigQuery history + Pub/Sub live updates via WebSocket."""

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from google.cloud import bigquery, firestore, pubsub_v1

# ---------------------------------------------------------------------------
# Configuration — all required; exits on startup if any are missing
# ---------------------------------------------------------------------------

def _require(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        sys.exit(f"ERROR: required environment variable {key!r} is not set")
    return val


GCP_PROJECT_ID  = _require("GCP_PROJECT_ID")
BQ_DATASET      = _require("BQ_DATASET")
BQ_TABLE        = _require("BQ_TABLE")
PUBSUB_SUB_ID   = _require("PUBSUB_SUB_ID")
DEFAULT_HOURS        = int(os.environ.get("DEFAULT_HOURS", "24"))
FIRESTORE_DB         = os.environ.get("FIRESTORE_DB", "location-db")
FIRESTORE_COLLECTION = os.environ.get("FIRESTORE_COLLECTION", "locations")
PING_INTERVAL_S      = 30

_executor = ThreadPoolExecutor(max_workers=4)

# ---------------------------------------------------------------------------
# Lazy GCP clients
# ---------------------------------------------------------------------------

_bq_client = None
_sub_client = None
_fs_client  = None


def get_fs_client() -> firestore.Client:
    global _fs_client
    if _fs_client is None:
        _fs_client = firestore.Client(project=GCP_PROJECT_ID, database=FIRESTORE_DB)
    return _fs_client


def get_bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=GCP_PROJECT_ID)
    return _bq_client


def get_sub_client() -> pubsub_v1.SubscriberClient:
    global _sub_client
    if _sub_client is None:
        _sub_client = pubsub_v1.SubscriberClient()
    return _sub_client


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Location Dashboard")

FRONTEND_PATH = Path(__file__).parent.parent / "frontend" / "index.html"


@app.get("/")
async def serve_frontend():
    return HTMLResponse(FRONTEND_PATH.read_text())


# ---------------------------------------------------------------------------
# BigQuery helper
# ---------------------------------------------------------------------------

def _query_bq_sync(hours: int, user_ids: Optional[List[str]]) -> tuple:
    """Run BQ query synchronously (called inside run_in_executor)."""
    t0 = time.monotonic()
    client = get_bq_client()
    table_ref = f"`{GCP_PROJECT_ID}.{BQ_DATASET}.{BQ_TABLE}`"
    sql = f"""
        SELECT
            FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%S.%EZ', timestamp) AS timestamp,
            user_id, latitude, longitude
        FROM {table_ref}
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
        ORDER BY user_id, timestamp ASC
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("hours", "INT64", hours)]
    )
    rows = list(client.query(sql, job_config=job_config).result())
    duration_ms = (time.monotonic() - t0) * 1000
    result = [
        {
            "timestamp": row.timestamp,
            "user_id": row.user_id,
            "latitude": row.latitude,
            "longitude": row.longitude,
        }
        for row in rows
        if not user_ids or row.user_id in user_ids
    ]
    return result, duration_ms


# ---------------------------------------------------------------------------
# Firestore helper
# ---------------------------------------------------------------------------

def _fetch_firestore_sync() -> List[dict]:
    """Fetch all latest-position documents from Firestore (one doc per user_id)."""
    client = get_fs_client()
    docs = client.collection(FIRESTORE_COLLECTION).stream()
    result = []
    for doc in docs:
        data = doc.to_dict()
        if data.get("latitude") is None or data.get("longitude") is None:
            continue
        result.append({
            "user_id":    data.get("user_id", doc.id),
            "latitude":   data.get("latitude"),
            "longitude":  data.get("longitude"),
            "timestamp":  data.get("timestamp"),
            "updated_at": data.get("updated_at"),
        })
    return result


# ---------------------------------------------------------------------------
# WebSocket tasks
# ---------------------------------------------------------------------------

async def _ping_loop(ws: WebSocket) -> None:
    """Send keepalive pings every PING_INTERVAL_S seconds."""
    while True:
        await asyncio.sleep(PING_INTERVAL_S)
        try:
            await ws.send_json({"type": "ping", "ts": datetime.now(timezone.utc).isoformat()})
        except (WebSocketDisconnect, RuntimeError):
            return  # connection gone — let the task end cleanly


def _pull_pubsub_sync() -> List[dict]:
    """Pull up to 20 messages from Pub/Sub synchronously."""
    sub = get_sub_client()
    sub_path = sub.subscription_path(GCP_PROJECT_ID, PUBSUB_SUB_ID)
    response = sub.pull(request={"subscription": sub_path, "max_messages": 20})
    if not response.received_messages:
        return []
    ack_ids = [m.ack_id for m in response.received_messages]
    sub.acknowledge(request={"subscription": sub_path, "ack_ids": ack_ids})
    events = []
    for msg in response.received_messages:
        try:
            data = json.loads(msg.message.data.decode("utf-8"))
            events.append(data)
        except Exception:
            pass
    return events


async def _pubsub_live_loop(ws: WebSocket) -> None:
    """Poll Pub/Sub every 2s and forward messages as live_update events."""
    loop = asyncio.get_running_loop()
    while True:
        await asyncio.sleep(2)
        try:
            events = await loop.run_in_executor(_executor, _pull_pubsub_sync)
            for event in events:
                await ws.send_json({
                    "type": "live_update",
                    "timestamp": event.get("timestamp"),
                    "user_id": event.get("user_id"),
                    "latitude": event.get("latitude"),
                    "longitude": event.get("longitude"),
                })
        except (WebSocketDisconnect, RuntimeError):
            return  # connection gone — let the task end cleanly
        except Exception as exc:
            try:
                await ws.send_json({"type": "error", "message": str(exc), "code": "PUBSUB_ERROR"})
            except (WebSocketDisconnect, RuntimeError):
                return  # connection gone — let the task end cleanly


async def _firestore_live_loop(ws: WebSocket) -> None:
    """Real-time listener: pushes a live_update whenever a Firestore doc changes.

    on_snapshot fires in a background thread managed by the Firestore SDK.
    We bridge it to asyncio via a queue + loop.call_soon_threadsafe.
    The initial snapshot (all docs as ADDED on connect) is intentionally
    skipped because latest_positions is already sent at connection start.
    """
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()
    skip_initial = True

    def _on_snapshot(col_snapshot, changes, read_time):
        nonlocal skip_initial
        if skip_initial:
            skip_initial = False
            return  # discard the initial full-collection snapshot
        for change in changes:
            if change.type.name not in ("ADDED", "MODIFIED"):
                continue
            data = change.document.to_dict()
            if data.get("latitude") is None or data.get("longitude") is None:
                continue
            event = {
                "type":      "live_update",
                "user_id":   data.get("user_id", change.document.id),
                "latitude":  data.get("latitude"),
                "longitude": data.get("longitude"),
                "timestamp": data.get("updated_at") or data.get("timestamp"),
            }
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:
                pass  # event loop already closed

    client = get_fs_client()
    watch = client.collection(FIRESTORE_COLLECTION).on_snapshot(_on_snapshot)
    try:
        while True:
            event = await queue.get()
            try:
                await ws.send_json(event)
            except (WebSocketDisconnect, RuntimeError):
                return  # connection gone — let the task end cleanly
    finally:
        watch.unsubscribe()


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    loop = asyncio.get_running_loop()

    # 1. Wait up to 2s for an optional filter message
    hours = DEFAULT_HOURS
    user_ids: Optional[List[str]] = None
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=2.0)
        msg = json.loads(raw)
        if msg.get("type") == "filter":
            hours = int(msg.get("since_hours", DEFAULT_HOURS))
            user_ids = msg.get("user_ids") or None
    except (asyncio.TimeoutError, Exception):
        pass

    ping_task = None
    live_task = None
    try:
        # 2. Fetch Firestore latest positions — fast, gives immediate map feedback
        try:
            positions = await loop.run_in_executor(_executor, _fetch_firestore_sync)
            await ws.send_json({
                "type":      "latest_positions",
                "positions": positions,
                "count":     len(positions),
            })
        except WebSocketDisconnect:
            raise
        except Exception as exc:
            try:
                await ws.send_json({"type": "error", "message": str(exc), "code": "FIRESTORE_FAILED"})
            except (WebSocketDisconnect, RuntimeError):
                raise WebSocketDisconnect(code=1006)

        # 3. Query BigQuery
        try:
            rows, duration_ms = await loop.run_in_executor(
                _executor, lambda: _query_bq_sync(hours, user_ids)
            )
            await ws.send_json({
                "type": "historical_batch",
                "rows": rows,
                "count": len(rows),
                "query_duration_ms": round(duration_ms),
            })
        except WebSocketDisconnect:
            raise
        except Exception as exc:
            try:
                await ws.send_json({"type": "error", "message": str(exc), "code": "BQ_QUERY_FAILED"})
            except (WebSocketDisconnect, RuntimeError):
                raise WebSocketDisconnect(code=1006)

        # 4. Start background tasks
        ping_task = asyncio.create_task(_ping_loop(ws))
        live_task = asyncio.create_task(_firestore_live_loop(ws))

        # 5. Wait for disconnect — receive() raises WebSocketDisconnect on close
        while True:
            await ws.receive()

    except WebSocketDisconnect:
        pass
    finally:
        for task in (ping_task, live_task):
            if task and not task.done():
                task.cancel()
        print("[ws] connection closed — tasks cancelled")
