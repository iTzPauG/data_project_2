"""FastAPI REST API for Location & Zone Ingestion + Persistence."""

import json
import os
from datetime import datetime
from typing import Optional, Union, List

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import pubsub_v1
from pydantic import BaseModel, field_validator

# --- NUEVO: IMPORTS DE BASE DE DATOS ---
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

from fastapi import Response

app = FastAPI(title="Location & Zone Ingestion API")

@app.options("/{path:path}")
async def options_handler(path: str, response: Response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return {}

# --- CORS (Permitir conexión desde React) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURACIÓN GOOGLE CLOUD ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")
PUBSUB_USER_TOPIC = os.environ.get("PUBSUB_USER_TOPIC", "user-data")
PUBSUB_KIDS_TOPIC = os.environ.get("PUBSUB_KIDS_TOPIC", "kids-data")

# --- CONFIGURACIÓN BASE DE DATOS ---
# Usamos SQLite en local para que no te falle si no tienes Cloud SQL Proxy activo
# En Cloud Run, esta variable vendrá configurada para PostgreSQL
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./local_zones.db")

# Ajuste necesario para SQLite
connect_args = {"check_same_thread": False} if "sqlite" in DATABASE_URL else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- MODELO DB (La tabla que guardará las zonas) ---
class ZoneDB(Base):
    __tablename__ = "zones"
    tag_id = Column(String, primary_key=True)
    latitude = Column(Float)
    longitude = Column(Float)
    radius = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow, primary_key=True)

# Crea la tabla automáticamente si no existe
Base.metadata.create_all(bind=engine)

# Dependencia para obtener la DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- CLIENTE PUBSUB ---
_publisher = None
def get_publisher():
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher

# --- WEBSOCKETS (Se mantienen por si acaso, aunque uses Firestore) ---
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

# --- MODELOS PYDANTIC (Validación) ---
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

# --- ENDPOINTS ---
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


# --- Endpoints ---

# 1. PUBLICAR UBICACIÓN (Sigue siendo vital para enviar datos a Dataflow)
@app.post("/location")
async def publish_location(data: LocationRequest):
    message_dict = {
        "tag_id": str(data.tag_id),
        "latitude": data.latitude,
        "longitude": data.longitude,
        "timestamp": data.timestamp or datetime.now().isoformat(),
    }

    # A) ENVIAR A PUB/SUB (Para Dataflow -> Firestore)
    if GCP_PROJECT_ID:
        try:
            topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_LOCATION_TOPIC)
            get_publisher().publish(topic_path, json.dumps(message_dict).encode("utf-8"))
        except Exception as e:
            print(f"Error PubSub Location: {e}")
    
    # B) WEBSOCKET (Opcional, ya que el frontend lee de Firestore)
    await manager.broadcast(message_dict)

    return {"status": "published"}

# 2. CREAR ZONA (Admin) - Solo publica a Pub/Sub, la Cloud Function escribe en SQL
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

# 3. LEER ZONAS (NUEVO - Esto es lo que busca tu Frontend)
@app.get("/zones")
def get_zones(db: Session = Depends(get_db)):
    zones = db.query(ZoneDB).all()
    return [
        {
            "id": f"{z.tag_id}-{z.timestamp}", # Generamos un ID inventado para que React sea feliz
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


@app.post("/users")
def register_user(data: UserRequest):
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


@app.post("/tags")
def register_kid(data: KidRequest):
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
