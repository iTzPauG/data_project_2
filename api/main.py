"""FastAPI REST API for Location & Zone Ingestion + Persistence."""

import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, Union, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import pubsub_v1
from google.cloud import bigquery
from pydantic import BaseModel, field_validator
from sqlalchemy import create_engine, Column, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from fastapi import Response

# --- CONFIGURACIÓN GOOGLE CLOUD ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")
PUBSUB_USER_TOPIC = os.environ.get("PUBSUB_USER_TOPIC", "user-data")
PUBSUB_KIDS_TOPIC = os.environ.get("PUBSUB_KIDS_TOPIC", "kids-data")

# BigQuery client
bq_client = bigquery.Client(project=GCP_PROJECT_ID) if GCP_PROJECT_ID else None

# --- CONFIGURACIÓN BASE DE DATOS ---
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./local_zones.db")
connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# =====================================================================
# --- MODELOS DE BASE DE DATOS (SQLAlchemy) ---
# =====================================================================

class ZoneDB(Base):
    __tablename__ = "zones"
    tag_id = Column(String, primary_key=True)
    latitude = Column(Float)
    longitude = Column(Float)
    radius = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow, primary_key=True)

class KidDB(Base):
    __tablename__ = "tags"
    tag_id = Column(String, primary_key=True)
    nombre = Column(String)
    user_id = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

class UserDB(Base):
    __tablename__ = "users"
    user_id = Column(String, primary_key=True)
    username = Column(String)
    nombre = Column(String)
    apellidos = Column(String)
    correo = Column(String)
    telefono = Column(String)
    password = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

# =====================================================================
# --- LIFESPAN: crea tablas al arrancar, sin crashear si DB no lista ---
# =====================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"WARNING: No se pudieron crear las tablas al arrancar: {e}")
    yield

app = FastAPI(title="Location & Zone Ingestion API", lifespan=lifespan)

# --- OPTIONS handler para CORS preflight ---
@app.options("/{path:path}")
async def options_handler(path: str, response: Response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return {}

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Dependencia DB ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =====================================================================
# --- CLIENTES Y MANAGERS ---
# =====================================================================

_publisher = None
def get_publisher():
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Error WS: {e}")

manager = ConnectionManager()

# =====================================================================
# --- MODELOS DE VALIDACIÓN (Pydantic) ---
# =====================================================================

class LocationRequest(BaseModel):
    tag_id: Union[str, int]
    latitude: float
    longitude: float
    timestamp: Optional[str] = None

class ZoneRequest(BaseModel):
    tag_id: Union[str, int]
    latitude: float
    longitude: float
    radius: float
    timestamp: Optional[str] = None
    node_id: Optional[str] = None

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v):
        if not -90 <= v <= 90:
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            raise ValueError("Longitude must be between -180 and 180")
        return v

    @field_validator("radius")
    @classmethod
    def validate_radius(cls, v):
        if v <= 0:
            raise ValueError("Radius must be positive")
        return v

class UserRequest(BaseModel):
    user_id: Union[str, int]
    username: str
    nombre: str
    apellidos: str
    password: str
    correo: str
    telefono: str

class KidRequest(BaseModel):
    tag_id: Union[str, int]
    nombre: str
    user_id: Union[str, int]

# NUEVO MODELO PARA EL LOGIN
class LoginRequest(BaseModel):
    correo: str
    password: str

# =====================================================================
# --- ENDPOINTS ---
# =====================================================================

# 1. PUBLICAR UBICACIÓN
@app.post("/location")
async def publish_location(data: LocationRequest):
    message_dict = {
        "tag_id": str(data.tag_id),
        "latitude": data.latitude,
        "longitude": data.longitude,
        "timestamp": data.timestamp or datetime.now().isoformat(),
    }

    if GCP_PROJECT_ID:
        try:
            topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_LOCATION_TOPIC)
            get_publisher().publish(topic_path, json.dumps(message_dict).encode("utf-8"))
        except Exception as e:
            print(f"Error PubSub Location: {e}")
    
    await manager.broadcast(message_dict)

    return {"status": "published"}

# 2. CREAR ZONA (Solo publica a Pub/Sub)
@app.post("/zone")
async def create_zone(zone: ZoneRequest):
    timestamp = datetime.utcnow()
    zone_id = f"{zone.tag_id}-{timestamp}"
    message_dict = {
        "id": zone_id,
        "tag_id": str(zone.tag_id),
        "latitude": zone.latitude,
        "longitude": zone.longitude,
        "radius": zone.radius,
        "timestamp": str(timestamp)
    }

    if GCP_PROJECT_ID:
        try:
            topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_ZONE_TOPIC)
            get_publisher().publish(topic_path, json.dumps(message_dict).encode("utf-8"))
        except Exception as e:
            print(f"Error PubSub Zone: {e}")
            raise HTTPException(status_code=500, detail="Error publishing zone to Pub/Sub")

    return {"status": "ok", "zone_id": zone_id}

# 3. LEER ZONAS
@app.get("/zones")
def get_zones(db: Session = Depends(get_db)):
    zones = db.query(ZoneDB).all()
    return [
        {
            "id": f"{z.tag_id}-{z.timestamp}",
            "latitude": z.latitude, 
            "longitude": z.longitude, 
            "radius": z.radius,
            "tag_id": z.tag_id
        } 
        for z in zones
    ]

# 4. WebSocket (Legacy)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 5. REGISTRAR USUARIO (Valida en BD, publica en Pub/Sub)
@app.post("/users")
def register_user(data: UserRequest, db: Session = Depends(get_db)):
    # Validación rápida: ¿Existe el correo?
    existing = db.query(UserDB).filter(UserDB.correo == data.correo).first()
    if existing:
        raise HTTPException(status_code=409, detail="El correo ya está registrado")

    if not GCP_PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not configured")

    message = {
        "user_id": str(data.user_id),
        "username": data.username,
        "nombre": data.nombre,
        "apellidos": data.apellidos,
        "password": data.password,
        "correo": data.correo,
        "telefono": data.telefono,
        "timestamp": datetime.now().isoformat(),
    }

    print(f"[API] User registration: {message}")
    topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_USER_TOPIC)
    future = get_publisher().publish(topic_path, json.dumps(message).encode("utf-8"))
    message_id = future.result()

    return {"status": "ok", "message_id": message_id}

# 6. REGISTRAR NIÑO (Valida en BD, publica en Pub/Sub)
@app.post("/tags")
def register_kid(data: KidRequest, db: Session = Depends(get_db)):
    # Validación rápida: ¿Existe el Tag ID?
    existing = db.query(KidDB).filter(KidDB.tag_id == str(data.tag_id)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Este Tag ID ya está registrado")

    if not GCP_PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not configured")

    message = {
        "tag_id": str(data.tag_id),
        "nombre": data.nombre,
        "user_id": str(data.user_id),
        "timestamp": datetime.now().isoformat(),
    }

    print(f"[API] tag registration: {message}")
    topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_KIDS_TOPIC)
    future = get_publisher().publish(topic_path, json.dumps(message).encode("utf-8"))
    message_id = future.result()

    return {"status": "ok", "message_id": message_id}

# 7. LOGIN (VITAL PARA EL FRONTEND)
@app.post("/login")
def login_user(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserDB).filter(UserDB.correo == data.correo).first()
    if not user or user.password != data.password:
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos")
    return {
        "status": "ok",
        "user_id": user.user_id,
        "nombre": user.nombre,
        "apellidos": user.apellidos,
    }

# 8. OBTENER NIÑOS DE UN PADRE (VITAL PARA EL FRONTEND)
@app.get("/kids/{user_id}")
def get_kids(user_id: str, db: Session = Depends(get_db)):
    kids = db.query(KidDB).filter(KidDB.user_id == user_id).all()
    return [{"tag_id": k.tag_id, "name": k.nombre} for k in kids]

# 9. HISTORIAL CON BIGQUERY (VITAL PARA EL FRONTEND)
@app.get("/history/{tag_id}")
def get_history(
    tag_id: str,
    # Volvemos a str para que Python no modifique la zona horaria
    start_time: str = Query(...),
    end_time: str = Query(...),
):
    if not bq_client:
        raise HTTPException(status_code=500, detail="BigQuery no está configurado")
    try:
        query = """
            SELECT latitude, longitude, timestamp
            FROM `data-project-2-kids.dataset_kids.my_table`
            WHERE tag_id = @tag_id
              /* Dejamos que BigQuery convierta el texto exacto a Timestamp */
              AND timestamp >= CAST(@start_time AS TIMESTAMP)
              AND timestamp <= CAST(@end_time AS TIMESTAMP)
            ORDER BY timestamp ASC
        """
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("tag_id", "STRING", tag_id),
                # Pasamos los parámetros como STRING a BigQuery
                bigquery.ScalarQueryParameter("start_time", "STRING", start_time),
                bigquery.ScalarQueryParameter("end_time", "STRING", end_time),
            ]
        )
        results = bq_client.query(query, job_config=job_config).result()
        path = [[row.longitude, row.latitude] for row in results]
        
        if not path:
            return {"path": [], "mensaje": "No hay datos en ese rango"}
        return {"path": path}
    except Exception as e:
        print(f"Error BigQuery: {e}")
        raise HTTPException(status_code=500, detail="Error consultando el historial")