"""FastAPI REST API for Location & Zone Ingestion."""

import json
import logging
import os
from datetime import datetime
from typing import Optional, Union

from fastapi import FastAPI, HTTPException, Request
from google.cloud import pubsub_v1
from pydantic import BaseModel, field_validator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Location & Zone Ingestion API")

# Configuration
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
PUBSUB_LOCATION_TOPIC = os.environ.get("PUBSUB_LOCATION_TOPIC", "incoming-location-data")
PUBSUB_ZONE_TOPIC = os.environ.get("PUBSUB_ZONE_TOPIC", "zone-data")

# Lazy-initialized client
_publisher = None


def get_publisher():
    global _publisher
    if _publisher is None:
        logger.info("Initializing Pub/Sub publisher client")
        _publisher = pubsub_v1.PublisherClient()
        logger.info("Pub/Sub publisher client initialized successfully")
    return _publisher


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
            logger.warning(f"Invalid latitude value received: {v}")
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            logger.warning(f"Invalid longitude value received: {v}")
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
            logger.warning(f"Invalid zone latitude value received: {v}")
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v):
        if not -180 <= v <= 180:
            logger.warning(f"Invalid zone longitude value received: {v}")
            raise ValueError("Longitude must be between -180 and 180")
        return v

    @field_validator("radius")
    @classmethod
    def validate_radius(cls, v):
        if v <= 0:
            logger.warning(f"Invalid zone radius value received: {v}")
            raise ValueError("Radius must be positive")
        return v


# --- Startup Event ---

@app.on_event("startup")
async def startup_event():
    logger.info("=" * 60)
    logger.info("Starting Location & Zone Ingestion API")
    logger.info(f"GCP_PROJECT_ID: {GCP_PROJECT_ID}")
    logger.info(f"PUBSUB_LOCATION_TOPIC: {PUBSUB_LOCATION_TOPIC}")
    logger.info(f"PUBSUB_ZONE_TOPIC: {PUBSUB_ZONE_TOPIC}")
    logger.info("=" * 60)


# --- Endpoints ---

@app.post("/location")
def publish_location(data: LocationRequest):
    if not GCP_PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not configured")

    message = {
        "user_id": str(data.user_id),
        "latitude": data.latitude,
        "longitude": data.longitude,
        "timestamp": data.timestamp or datetime.now().isoformat(),
    }

    topic_path = get_publisher().topic_path(GCP_PROJECT_ID, PUBSUB_LOCATION_TOPIC)
    future = get_publisher().publish(topic_path, json.dumps(message).encode("utf-8"))
    message_id = future.result()

    return {"status": "ok", "message_id": message_id}


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
