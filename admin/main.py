"""Admin Panel Backend — FastAPI."""

import asyncio
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import psycopg2
from fastapi import FastAPI, Form, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from google.cloud import firestore as gcp_firestore
from jose import JWTError, jwt

app = FastAPI(title="Admin Panel")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
def init_db():
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS admin_users (
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

_firestore_client: Optional[gcp_firestore.Client] = None


def get_firestore() -> gcp_firestore.Client:
    global _firestore_client
    if _firestore_client is None:
        _firestore_client = gcp_firestore.Client(database=FIRESTORE_DATABASE)
    return _firestore_client


@contextmanager
def get_db():
    conn = psycopg2.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME
    )
    try:
        yield conn
    finally:
        conn.close()


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
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM zones")
            zone_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(DISTINCT user_id) FROM zones")
            users_with_zones = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM users")
            user_count = cur.fetchone()[0]
    except Exception as e:
        print(f"[ADMIN] Cloud SQL error: {e}")

    # ── Firestore ──────────────────────────────────────────────────────────────
    active_24h = 0
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    try:
        db = get_firestore()
        docs = list(db.collection(FIRESTORE_COLLECTION).stream())

        for doc in docs:
            data = doc.to_dict()
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
    except Exception as e:
        print(f"[ADMIN] Firestore error: {e}")

    return {
        "user_count": user_count,
        "zone_count": zone_count,
        "active_users_24h": active_24h,
        "users_with_zones": users_with_zones,
    }


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
                "SELECT password_hash FROM admin_users WHERE username = %s",
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
                "UPDATE admin_users SET last_login = NOW() WHERE username = %s",
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
            # Run sync DB/Firestore calls in a thread so we don't block the event loop
            stats = await loop.run_in_executor(None, _collect_stats)
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
    return JSONResponse(_collect_stats())


@app.get("/health")
def health():
    return {"status": "ok"}
