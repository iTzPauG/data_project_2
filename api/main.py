"""FastAPI REST API for Location & Zone Ingestion + Persistence."""

import json
import os
from datetime import datetime
from typing import Optional, Union, List

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import pubsub_v1
from google.cloud import bigquery # <-- NUEVO: Importamos BigQuery
from pydantic import BaseModel, field_validator

# --- IMPORTS DE BASE DE DATOS ---
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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURACIÓN GOOGLE CLOUD ---
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")
PUBSUB_USER_TOPIC = os.environ.get("PUBSUB_USER_TOPIC", "user-data")
PUBSUB_KIDS_TOPIC = os.environ.get("PUBSUB_KIDS_TOPIC", "kids-data")

# Inicializamos el cliente de BigQuery
bq_client = bigquery.Client(project=GCP_PROJECT_ID) if GCP_PROJECT_ID else None

# --- CONFIGURACIÓN BASE DE DATOS ---
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

# --- WEBSOCKETS ---
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


# --- ENDPOINTS ---

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

# 2. CREAR ZONA (Admin)
@app.post("/zone")
async def create_zone(zone: ZoneRequest, db: Session = Depends(get_db)):
    try:
        db_zone = ZoneDB(
            tag_id=str(zone.tag_id),
            latitude=zone.latitude,
            longitude=zone.longitude,
            radius=zone.radius,
            timestamp=datetime.utcnow(),
        )
        db.add(db_zone)
        db.commit()
        db.refresh(db_zone) 
    except Exception as e:
        print(f"Error BD: {e}")
        raise HTTPException(status_code=500, detail="Error guardando en base de datos")

    # CORREGIDO: Evitamos usar db_zone.id porque la tabla usa tag_id y timestamp como llaves primarias
    fake_id = f"{db_zone.tag_id}-{db_zone.timestamp.isoformat()}"

    message_dict = {
        "id": fake_id,
        "tag_id": str(zone.tag_id),
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

    return {"status": "ok", "db_id": fake_id}

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

# 4. WEBSOCKET (Legacy)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 5. REGISTRAR USUARIO
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

# 6. REGISTRAR NIÑO (TAG)
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


# --- NUEVO: ENDPOINT DE HISTORIAL (BIGQUERY) ---
@app.get("/history/{tag_id}")
def get_history(
    tag_id: str,
    start_time: str = Query(...), 
    end_time: str = Query(...)
):
    if not bq_client:
        raise HTTPException(status_code=500, detail="BigQuery no está configurado (Falta GCP_PROJECT_ID)")

    try:
        # Consulta parametrizada para evitar inyecciones SQL
        query = """
            SELECT latitude, longitude, timestamp
            FROM `data-project-2-kids.dataset_kids.my_table`
            WHERE tag_id = @tag_id
              AND timestamp >= @start_time
              AND timestamp <= @end_time
            ORDER BY timestamp ASC
        """
        
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("tag_id", "STRING", tag_id),
                bigquery.ScalarQueryParameter("start_time", "TIMESTAMP", start_time),
                bigquery.ScalarQueryParameter("end_time", "TIMESTAMP", end_time),
            ]
        )
        
        query_job = bq_client.query(query, job_config=job_config)
        results = query_job.result()
        
        # Formateamos para DeckGL: [ [lon1, lat1], [lon2, lat2], ... ]
        path_coordinates = []
        for row in results:
            path_coordinates.append([row.longitude, row.latitude])
            
        if not path_coordinates:
            return {"path": [], "mensaje": "No hay datos en ese rango"}
            
        return {"path": path_coordinates}
        
    except Exception as e:
        print(f"Error BigQuery: {e}")
        raise HTTPException(status_code=500, detail="Error consultando el historial en BigQuery")