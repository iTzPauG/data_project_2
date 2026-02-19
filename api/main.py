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

app = FastAPI(title="Location & Zone Ingestion API")

# --- CORS (Permitir conexión desde React) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURACIÓN GOOGLE CLOUD ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")

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
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    radius = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)
    node_id = Column(String, nullable=True)

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
    user_id: Union[str, int]
    latitude: float
    longitude: float
    timestamp: Optional[str] = None

class ZoneRequest(BaseModel):
    user_id: Union[str, int]
    latitude: float
    longitude: float
    radius: float
    timestamp: Optional[str] = None
    node_id: Optional[str] = None

# --- ENDPOINTS ---

# 1. PUBLICAR UBICACIÓN (Sigue siendo vital para enviar datos a Dataflow)
@app.post("/location")
async def publish_location(data: LocationRequest):
    message_dict = {
        "user_id": str(data.user_id),
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

# 2. CREAR ZONA (Admin) - AHORA GUARDA EN BD + PUBSUB
@app.post("/zone")
async def create_zone(zone: ZoneRequest, db: Session = Depends(get_db)):
    
    # A) Guardar en Base de Datos (Cloud SQL / SQLite)
    try:
        db_zone = ZoneDB(
            user_id=str(zone.user_id),
            latitude=zone.latitude,
            longitude=zone.longitude,
            radius=zone.radius,
            timestamp=datetime.utcnow(),
            node_id=zone.node_id
        )
        db.add(db_zone)
        db.commit()
        db.refresh(db_zone) # Obtenemos el ID generado
    except Exception as e:
        print(f"Error BD: {e}")
        raise HTTPException(status_code=500, detail="Error guardando en base de datos")

    # B) Enviar a Pub/Sub (Para que Dataflow se entere)
    message_dict = {
        "id": db_zone.id,
        "user_id": str(zone.user_id),
        "latitude": zone.latitude,
        "longitude": zone.longitude,
        "radius": zone.radius,
        "timestamp": str(db_zone.timestamp)
    }

    if GCP_PROJECT_ID:
        try:
            topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_ZONE_TOPIC)
            get_publisher().publish(topic_path, json.dumps(message_dict).encode("utf-8"))
        except Exception as e:
            print(f"Error PubSub Zone: {e}")

    return {"status": "ok", "db_id": db_zone.id}

# 3. LEER ZONAS (NUEVO - Esto es lo que busca tu Frontend)
@app.get("/zones")
def get_zones(db: Session = Depends(get_db)):
    # 1. Obtenemos todas las zonas de la base de datos
    zones = db.query(ZoneDB).all()
    
    # 2. Las convertimos a un formato limpio que React entienda a la primera (JSON)
    return [
        {
            "id": z.id,
            "latitude": z.latitude, 
            "longitude": z.longitude, 
            "radius": z.radius,
            "user_id": z.user_id
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