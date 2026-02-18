"""FastAPI REST API for Location & Zone Ingestion."""

import json
import os
from datetime import datetime
from typing import Optional, Union, List

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect 
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import pubsub_v1
from pydantic import BaseModel, field_validator

app = FastAPI(title="Location & Zone Ingestion API")

# --- IMPORTANTE: CORS ---
# Permite que tu Frontend (localhost:5173 o Cloud Run) se conecte
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")

# Lazy-initialized client
_publisher = None


def get_publisher():
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher

# --- GESTOR DE WEBSOCKETS (NUEVO) ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"🔌 Cliente conectado. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Envía el mensaje a todos los Frontends conectados"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Error enviando WS: {e}")

manager = ConnectionManager()

# --- Models ---

class LocationRequest(BaseModel):
    user_id: Union[str, int]
    latitude: float
    longitude: float
    timestamp: Optional[str] = None

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


class ZoneRequest(BaseModel):
    user_id: Union[str, int]
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


# --- Endpoints ---

# 2. Endpoint que recibe los datos del script Python
@app.post("/location")
async def publish_location(data: LocationRequest):
    
    # Preparamos el mensaje
    message_dict = {
        "user_id": str(data.user_id),
        "latitude": data.latitude,
        "longitude": data.longitude,
        "timestamp": data.timestamp or datetime.now().isoformat(),
    }

    # A) ENVIAR A PUB/SUB (Para Dataflow/BBDD)
    if GCP_PROJECT_ID:
        try:
            topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_LOCATION_TOPIC)
            future = get_publisher().publish(topic_path, json.dumps(message_dict).encode("utf-8"))
            
            message_id = future.result()
            print(f"Mensaje enviado con ID: {message_id}")
        except Exception as e:
            print(f"ERROR CRÍTICO PUBSUB: {e}")
            # Esto devuelve un error 500 al cliente en lugar de un 200 OK falso
            raise HTTPException(status_code=500, detail=f"PubSub Error: {str(e)}")
    else:
        print("ERROR: GCP_PROJECT_ID no está configurado en las variables de entorno")
        raise HTTPException(status_code=500, detail="Configuration Error: GCP_PROJECT_ID missing")
    
    # B) ENVIAR A WEBSOCKET (Para React en Tiempo Real)
    await manager.broadcast(message_dict)

    return {"status": "published_and_broadcasted"}


@app.post("/zone")
async def create_zone(request: Request):
    if not GCP_PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not configured")

    body = await request.json()
    print(f"[API] body recibido: {body}")
    # Pydantic validación (opcional, pero forzamos user_id manualmente)
    user_id = body.get("user_id")
    latitude = body.get("latitude")
    longitude = body.get("longitude")
    radius = body.get("radius")
    timestamp = body.get("timestamp")
    node_id = body.get("node_id")
    message = {
        "user_id": str(user_id) if user_id is not None else None,
        "latitude": latitude,
        "longitude": longitude,
        "radius": radius,
        "timestamp": timestamp,
    }
    if node_id:
        message["node_id"] = node_id

    print(f"[API] mensaje publicado: {message}")
    topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_ZONE_TOPIC)
    future = get_publisher().publish(topic_path, json.dumps(message).encode("utf-8"))
    message_id = future.result()

    return {"status": "ok", "message_id": message_id}

# 1. Endpoint para que React se conecte (ws://...)
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Mantenemos la conexión abierta escuchando (aunque React no mande nada)
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
