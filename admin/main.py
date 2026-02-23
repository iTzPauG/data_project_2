"""Admin Panel Backend — FastAPI."""

import asyncio
import json
import os
import time as _time
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Optional

import bcrypt
import psycopg2
from fastapi import FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from google.cloud import bigquery
from google.cloud import firestore as gcp_firestore
from google.cloud import pubsub_v1
from jose import JWTError, jwt

app = FastAPI(title="Admin Panel")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def init_db():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admins (
                    id            SERIAL PRIMARY KEY,
                    username      VARCHAR(50)  UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_login    TIMESTAMP WITH TIME ZONE
                )
            """)
            conn.commit()
    except Exception as e:
        print(f"[ADMIN] DB init error: {e}")


@app.on_event("startup")
async def start_pubsub_listener():
    asyncio.create_task(_pubsub_pull_loop())


# ── Auth ───────────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("ADMIN_SECRET_KEY", "ADMIN_SECRET_KEY")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60

# ── Database ───────────────────────────────────────────────────────────────────
DB_HOST = os.environ.get("DB_HOST", "")
DB_USER = os.environ.get("DB_USER", "")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "appdb")

# ── Firestore ──────────────────────────────────────────────────────────────────
FIRESTORE_DATABASE   = os.environ.get("FIRESTORE_DATABASE", "location-db")
FIRESTORE_COLLECTION = os.environ.get("FIRESTORE_COLLECTION", "locations")

# ── BigQuery ───────────────────────────────────────────────────────────────────
BQ_PROJECT = os.environ.get("BQ_PROJECT", "")
BQ_DATASET = os.environ.get("BQ_DATASET", "")
BQ_TABLE   = os.environ.get("BQ_TABLE", "")

# ── Pub/Sub ────────────────────────────────────────────────────────────────────
NOTIFICATIONS_SUBSCRIPTION = os.environ.get("NOTIFICATIONS_SUBSCRIPTION", "")

# Rolling buffer of the last 50 zone violations (populated by background task)
violations_buffer: deque = deque(maxlen=50)

_chart_cache: dict = {"data": None, "expires": 0.0}

_firestore_client: Optional[gcp_firestore.Client] = None
_bq_client: Optional[bigquery.Client] = None


def get_firestore() -> gcp_firestore.Client:
    global _firestore_client
    if _firestore_client is None:
        _firestore_client = gcp_firestore.Client(database=FIRESTORE_DATABASE)
    return _firestore_client


def get_bq() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        _bq_client = bigquery.Client(project=BQ_PROJECT)
    return _bq_client


@contextmanager
def get_db():
    conn = psycopg2.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME
    )
    try:
        yield conn
    finally:
        conn.close()


# ── Haversine ─────────────────────────────────────────────────────────────────
def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two lat/lon points."""
    R = 6_371_000  # Earth radius in metres
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(a))


# ── Auth helpers ───────────────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def _decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def get_current_user(request: Request) -> Optional[str]:
    token = request.cookies.get("admin_token")
    if not token:
        return None
    return _decode_token(token)


# ── Stats collection (sync — called from HTTP and WebSocket) ───────────────────
def _collect_stats() -> dict:
    # ── Cloud SQL ──────────────────────────────────────────────────────────────
    zone_count = 0
    users_with_zones = 0
    user_count = 0
    kid_count = 0
    new_users_week = 0
    users_no_zones = 0
    unprotected_users = 0
    zones_by_user: dict = {}

    try:
        with get_db() as conn:
            cur = conn.cursor()

            cur.execute("SELECT COUNT(*) FROM zones")
            zone_count = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(DISTINCT t.user_id) FROM tags t
                WHERE t.tag_id IN (SELECT DISTINCT tag_id FROM zones)
            """)
            users_with_zones = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM users")
            user_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM tags")
            kid_count = cur.fetchone()[0]

            cur.execute(
                "SELECT COUNT(*) FROM users WHERE timestamp > NOW() - INTERVAL '7 days'"
            )
            new_users_week = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*) FROM users
                WHERE user_id NOT IN (
                    SELECT DISTINCT t.user_id FROM tags t
                    WHERE t.tag_id IN (SELECT DISTINCT tag_id FROM zones)
                )
            """)
            users_no_zones = cur.fetchone()[0]

            cur.execute("""
                SELECT COUNT(*) FROM users u
                WHERE EXISTS     (SELECT 1 FROM tags t WHERE t.user_id = u.user_id)
                  AND NOT EXISTS (
                      SELECT 1 FROM tags t
                      WHERE t.user_id = u.user_id
                        AND t.tag_id IN (SELECT tag_id FROM zones)
                  )
            """)
            unprotected_users = cur.fetchone()[0]

            # Load zone geometry for Haversine cross-check
            cur.execute("SELECT tag_id, latitude, longitude, radius FROM zones")
            for row in cur.fetchall():
                tag_id, lat, lon, radius = row
                zones_by_user.setdefault(tag_id, []).append((lat, lon, radius))

    except Exception as e:
        print(f"[ADMIN] Cloud SQL error: {e}")

    # ── Firestore + haversine cross-check ─────────────────────────────────────
    active_24h = 0
    kids_outside_zones = 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    try:
        db = get_firestore()
        docs = list(db.collection(FIRESTORE_COLLECTION).stream())

        for doc in docs:
            data = doc.to_dict()

            # Active users in last 24 h
            updated_at_raw = data.get("updated_at", "")
            if updated_at_raw:
                try:
                    dt = datetime.fromisoformat(
                        updated_at_raw.replace("Z", "+00:00")
                    )
                    if dt > cutoff:
                        active_24h += 1
                except Exception:
                    pass

            # Kids outside all zones
            uid = data.get("tag_id") or doc.id
            lat = data.get("latitude") or data.get("lat")
            lon = data.get("longitude") or data.get("lon")
            if lat is not None and lon is not None:
                user_zones = zones_by_user.get(uid, [])
                if user_zones:
                    outside_all = all(
                        haversine(lat, lon, zlat, zlon) > zradius
                        for zlat, zlon, zradius in user_zones
                    )
                    if outside_all:
                        kids_outside_zones += 1

    except Exception as e:
        print(f"[ADMIN] Firestore error: {e}")

    # ── BigQuery ───────────────────────────────────────────────────────────────
    events_today = 0
    if BQ_PROJECT and BQ_DATASET and BQ_TABLE:
        try:
            client = get_bq()
            query = (
                f"SELECT COUNT(*) AS cnt "
                f"FROM `{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}` "
                f"WHERE DATE(timestamp) = CURRENT_DATE()"
            )
            for row in client.query(query).result():
                events_today = row.cnt
        except Exception as e:
            print(f"[ADMIN] BigQuery error: {e}")

    return {
        "user_count":        user_count,
        "zone_count":        zone_count,
        "active_users_24h":  active_24h,
        "users_with_zones":  users_with_zones,
        "kid_count":         kid_count,
        "kids_outside_zones": kids_outside_zones,
        "unprotected_users": unprotected_users,
        "new_users_week":    new_users_week,
        "users_no_zones":    users_no_zones,
        "events_today":      events_today,
    }


def _get_chart_data() -> dict:
    now = _time.monotonic()
    if _chart_cache["data"] is not None and now < _chart_cache["expires"]:
        return _chart_cache["data"]

    messages_per_day: list = []
    messages_per_month: list = []

    if BQ_PROJECT and BQ_DATASET and BQ_TABLE:
        try:
            client = get_bq()
            day_q = f"""
                SELECT DATE(timestamp) AS day, COUNT(*) AS cnt
                FROM `{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`
                WHERE DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                GROUP BY day ORDER BY day
            """
            for row in client.query(day_q).result():
                messages_per_day.append({"date": str(row.day), "count": row.cnt})

            month_q = f"""
                SELECT FORMAT_DATE('%Y-%m', DATE(timestamp)) AS month, COUNT(*) AS cnt
                FROM `{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}`
                WHERE DATE(timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
                GROUP BY month ORDER BY month
            """
            for row in client.query(month_q).result():
                messages_per_month.append({"month": row.month, "count": row.cnt})
        except Exception as e:
            print(f"[ADMIN] BigQuery chart error: {e}")

    result = {"messages_per_day": messages_per_day, "messages_per_month": messages_per_month}
    _chart_cache["data"] = result
    _chart_cache["expires"] = now + 300  # cache for 5 minutes
    return result


# ── Pub/Sub violations pull loop (background task) ────────────────────────────
async def _pubsub_pull_loop() -> None:
    if not NOTIFICATIONS_SUBSCRIPTION or not BQ_PROJECT:
        print("[ADMIN] Pub/Sub listener disabled (NOTIFICATIONS_SUBSCRIPTION or BQ_PROJECT not set)")
        return

    subscription_path = (
        f"projects/{BQ_PROJECT}/subscriptions/{NOTIFICATIONS_SUBSCRIPTION}"
    )
    loop = asyncio.get_running_loop()
    subscriber = pubsub_v1.SubscriberClient()

    while True:
        try:
            response = await loop.run_in_executor(
                None,
                lambda: subscriber.pull(
                    request={
                        "subscription": subscription_path,
                        "max_messages": 10,
                    },
                    timeout=5,
                ),
            )
            ack_ids = []
            for received_msg in response.received_messages:
                try:
                    payload = json.loads(received_msg.message.data.decode("utf-8"))
                    violations_buffer.append({
                        "tag_id":          payload.get("tag_id", ""),
                        "latitude":        payload.get("latitude", 0.0),
                        "longitude":       payload.get("longitude", 0.0),
                        "distance_meters": payload.get("distance_meters", 0.0),
                        "timestamp":       payload.get(
                            "timestamp",
                            datetime.now(timezone.utc).isoformat(),
                        ),
                    })
                    ack_ids.append(received_msg.ack_id)
                except Exception as parse_err:
                    print(f"[ADMIN] Pub/Sub parse error: {parse_err}")

            if ack_ids:
                await loop.run_in_executor(
                    None,
                    lambda ids=ack_ids: subscriber.acknowledge(
                        request={
                            "subscription": subscription_path,
                            "ack_ids": ids,
                        }
                    ),
                )
        except Exception as pull_err:
            print(f"[ADMIN] Pub/Sub pull error: {pull_err}")

        await asyncio.sleep(5)


# ── Pages ──────────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
def root():
    return RedirectResponse("/admin/login")


@app.get("/admin/login", response_class=HTMLResponse)
def login_page(request: Request):
    if get_current_user(request):
        return RedirectResponse("/admin/dashboard")
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/admin/login", response_class=HTMLResponse)
def do_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    if len(password.encode()) > 72:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Password must be 72 characters or fewer"},
            status_code=400,
        )

    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT password_hash FROM admins WHERE username = %s",
                (username,),
            )
            row = cur.fetchone()
    except Exception as e:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": f"Database connection error: {e}"},
            status_code=500,
        )

    if not row or not verify_password(password, row[0]):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid username or password"},
            status_code=401,
        )

    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE admins SET last_login = NOW() WHERE username = %s",
                (username,),
            )
            conn.commit()
    except Exception:
        pass

    token = create_token(username)
    response = RedirectResponse("/admin/dashboard", status_code=302)
    response.set_cookie(
        "admin_token", token, httponly=True, max_age=3600, samesite="lax"
    )
    return response


@app.get("/admin/logout")
def logout():
    response = RedirectResponse("/admin/login", status_code=302)
    response.delete_cookie("admin_token")
    return response


@app.get("/admin/dashboard", response_class=HTMLResponse)
def dashboard(request: Request):
    user = get_current_user(request)
    if not user:
        return RedirectResponse("/admin/login")
    return templates.TemplateResponse(
        "dashboard.html", {"request": request, "admin_user": user}
    )


# ── WebSocket — real-time stats ────────────────────────────────────────────────
PUSH_INTERVAL_SECONDS = 5


@app.websocket("/admin/ws")
async def websocket_stats(websocket: WebSocket):
    # Auth: browsers send cookies on WS connections to same origin
    token = websocket.cookies.get("admin_token")
    if not token or not _decode_token(token):
        await websocket.close(code=1008)  # Policy Violation
        return

    await websocket.accept()
    loop = asyncio.get_running_loop()

    try:
        while True:
            # Run sync DB/Firestore/BQ calls in a thread so we don't block the event loop
            stats = await loop.run_in_executor(None, _collect_stats)
            stats["violations"] = list(violations_buffer)
            await websocket.send_json(stats)
            await asyncio.sleep(PUSH_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ADMIN] WebSocket error: {e}")


# ── HTTP stats fallback ────────────────────────────────────────────────────────
@app.get("/admin/api/stats")
def get_stats(request: Request):
    if not get_current_user(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
    stats = _collect_stats()
    stats["violations"] = list(violations_buffer)
    return JSONResponse(stats)


@app.get("/admin/api/chart")
def chart_data(request: Request):
    if not get_current_user(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return JSONResponse(_get_chart_data())


@app.get("/health")
def health():
    return {"status": "ok"}
