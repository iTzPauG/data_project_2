#!/usr/bin/env python3
"""
Location Data Streaming Pipeline

Reads location data (latitude, longitude) from Pub/Sub, processes it,
saves to Firestore, and publishes to output topics.
"""

import argparse
import json
import logging
import math
from datetime import datetime
from typing import Optional, Dict, Any

import apache_beam as beam
from apache_beam.options.pipeline_options import PipelineOptions
from apache_beam.options.pipeline_options import StandardOptions
from apache_beam.io.gcp.pubsub import ReadFromPubSub, WriteStringsToPubSub
from google.cloud import firestore

# Configure logging
logging.basicConfig(level=logging.INFO)


class LocationData:
    """Represents a location data point with latitude and longitude."""

    def __init__(self, latitude: float, longitude: float, timestamp: Optional[int] = None):
        self.latitude = latitude
        self.longitude = longitude
        self.timestamp = timestamp or int(datetime.now().timestamp() * 1000)

    @staticmethod
    def from_json(json_str: str) -> 'LocationData':
        """Parse LocationData from JSON string."""
        try:
            data = json.loads(json_str)
            return LocationData(
                latitude=float(data.get('latitude', 0)),
                longitude=float(data.get('longitude', 0)),
                timestamp=data.get('timestamp')
            )
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            logging.getLogger(__name__).error(f"Error parsing JSON: {e}")
            raise ValueError(f"Invalid location data: {json_str}")

    def to_json(self) -> str:
        """Convert LocationData to JSON string."""
        return json.dumps({
            'latitude': self.latitude,
            'longitude': self.longitude,
            'timestamp': self.timestamp
        })

    def to_dict(self) -> Dict[str, Any]:
        """Convert LocationData to dictionary."""
        return {
            'latitude': self.latitude,
            'longitude': self.longitude,
            'timestamp': self.timestamp
        }

    def __repr__(self) -> str:
        return f"LocationData(lat={self.latitude}, lon={self.longitude}, ts={self.timestamp})"


class ParseLocationDataFn(beam.DoFn):
    """Parse JSON strings into LocationData objects."""

    def process(self, element: bytes):
        try:
            location = LocationData.from_json(element.decode('utf-8'))

            # Validate coordinates
            if self._is_valid_coordinate(location.latitude, location.longitude):
                yield location
            else:
                logging.getLogger(__name__).warning(
                    f"Invalid coordinates: lat={location.latitude}, lon={location.longitude}"
                )
        except Exception as e:
            logging.getLogger(__name__).error(f"Error parsing location data: {e}")

    @staticmethod
    def _is_valid_coordinate(latitude: float, longitude: float) -> bool:
        """Validate latitude and longitude values."""
        return -90 <= latitude <= 90 and -180 <= longitude <= 180


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two GPS points using the Haversine formula."""
    R = 6371000  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


class ProcessLocationFn(beam.DoFn):
    """Process location data, check against restricted zones using bounding box queries."""

    # Approximate degrees for 50m bounding box
    LAT_OFFSET = 0.00045  # ~50m in latitude
    DEFAULT_RADIUS = 50  # meters

    def __init__(self, firestore_project: str, firestore_database: str,
                 firestore_collection: str, zones_collection: str):
        self.firestore_project = firestore_project
        self.firestore_database = firestore_database
        self.firestore_collection = firestore_collection
        self.zones_collection = zones_collection
        self._db = None

    def setup(self):
        """Initialize Firestore client."""
        try:
            from google.cloud import firestore
            logging.getLogger(__name__).info(
                f"Setting up Firestore connection to {self.firestore_project}/{self.firestore_database}"
            )
            self._db = firestore.Client(project=self.firestore_project, database=self.firestore_database)
        except Exception as e:
            logging.getLogger(__name__).error(f"Error setting up Firestore connection: {e}")

    def _query_nearby_zones(self, latitude: float, longitude: float) -> Optional[Dict]:
        """Query Firestore for zones within a bounding box, then do precise haversine check."""
        min_lat = latitude - self.LAT_OFFSET
        max_lat = latitude + self.LAT_OFFSET
        lon_offset = self.LAT_OFFSET / math.cos(math.radians(latitude))
        min_lon = longitude - lon_offset
        max_lon = longitude + lon_offset

        # Firestore range query on latitude
        query = (
            self._db.collection(self.zones_collection)
            .where('latitude', '>=', min_lat)
            .where('latitude', '<=', max_lat)
        )

        for doc in query.stream():
            zone = doc.to_dict()
            zone['id'] = doc.id
            zone_lon = zone.get('longitude')
            if zone_lon is None:
                continue
            # Filter by longitude in Python
            if zone_lon < min_lon or zone_lon > max_lon:
                continue
            # Precise haversine check
            zone_radius = zone.get('radius', self.DEFAULT_RADIUS)
            distance = haversine_distance(latitude, longitude, zone['latitude'], zone_lon)
            if distance <= zone_radius:
                return zone
        return None

    def teardown(self):
        """Close Firestore client."""
        try:
            if self._db:
                logging.getLogger(__name__).info("Firestore connection closed")
        except Exception as e:
            logging.getLogger(__name__).error(f"Error closing Firestore connection: {e}")

    def process(self, element: LocationData):
        try:
            logging.getLogger(__name__).info(f"Processing location: {element}")

            # Query nearby zones using bounding box
            violated_zone = self._query_nearby_zones(element.latitude, element.longitude)

            if violated_zone:
                distance = haversine_distance(
                    element.latitude, element.longitude,
                    violated_zone['latitude'], violated_zone['longitude']
                )
                notification = json.dumps({
                    'status': 'zone_violation',
                    'latitude': element.latitude,
                    'longitude': element.longitude,
                    'timestamp': element.timestamp,
                    'zone_id': violated_zone.get('id', ''),
                    'zone_latitude': violated_zone['latitude'],
                    'zone_longitude': violated_zone['longitude'],
                    'zone_radius': violated_zone.get('radius', 50),
                    'distance_meters': round(distance, 2),
                })
                logging.getLogger(__name__).warning(
                    f"ZONE VIOLATION: device at ({element.latitude}, {element.longitude}) "
                    f"is {distance:.1f}m from zone {violated_zone.get('id', '')} "
                    f"(limit: {violated_zone.get('radius', 50)}m)"
                )
            else:
                notification = json.dumps({
                    'status': 'processed',
                    'latitude': element.latitude,
                    'longitude': element.longitude,
                    'timestamp': element.timestamp
                })

            yield (element, notification)

        except Exception as e:
            logging.getLogger(__name__).error(f"Error processing location: {e}")


class SaveToFirestoreFn(beam.DoFn):
    """Save location data to Firestore database."""

    def __init__(self, project: str, database: str, collection: str):
        self.project = project
        self.database = database
        self.collection = collection
        self._db = None

    def setup(self):
        """Initialize Firestore client."""
        try:
            from google.cloud import firestore
            logging.getLogger(__name__).info(f"Initializing Firestore connection to {self.project}/{self.database}")
            self._db = firestore.Client(project=self.project, database=self.database)
        except Exception as e:
            logging.getLogger(__name__).error(f"Error initializing Firestore connection: {e}")
            raise

    def process(self, element: LocationData):
        try:
            # Save location data to Firestore
            doc_data = {
                'latitude': element.latitude,
                'longitude': element.longitude,
                'timestamp': element.timestamp,
                'created_at': datetime.now()
            }

            # Add document with auto-generated ID
            doc_ref = self._db.collection(self.collection).document()
            doc_ref.set(doc_data)

            logging.getLogger(__name__).info(f"Saved location to Firestore: {doc_ref.id}")
            yield element

        except Exception as e:
            logging.getLogger(__name__).error(f"Error saving to Firestore: {e}")

    def teardown(self):
        """Close Firestore client."""
        try:
            if self._db:
                logging.getLogger(__name__).info("Firestore connection closed")
        except Exception as e:
            logging.getLogger(__name__).error(f"Error closing Firestore connection: {e}")


def run(argv=None):
    """Main pipeline function."""

    # Parse command-line arguments
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--input_topic',
        required=True,
        help='Pub/Sub topic to read from'
    )
    parser.add_argument(
        '--output_notifications_topic',
        required=True,
        help='Pub/Sub topic for notifications'
    )
    parser.add_argument(
        '--output_location_topic',
        required=True,
        help='Pub/Sub topic for processed locations'
    )
    parser.add_argument(
        '--firestore_project',
        required=True,
        help='GCP project ID for Firestore'
    )
    parser.add_argument(
        '--firestore_database',
        required=True,
        help='Firestore database name'
    )
    parser.add_argument(
        '--firestore_collection',
        required=True,
        help='Firestore collection name for locations'
    )
    parser.add_argument(
        '--zones_collection',
        default='zones',
        help='Firestore collection name for restricted zones'
    )
    parser.add_argument(
        '--window_duration',
        type=int,
        default=300,
        help='Window duration in seconds'
    )

    known_args, pipeline_args = parser.parse_known_args(argv)

    # Configure pipeline options
    options = PipelineOptions(pipeline_args, save_main_session=True)
    options.view_as(StandardOptions).streaming = True

    pipeline = beam.Pipeline(options=options)

    # Read from Pub/Sub
    messages = (
        pipeline
        | 'Read from Pub/Sub' >> ReadFromPubSub(topic=known_args.input_topic)
    )

    # Parse JSON to LocationData
    locations = (
        messages
        | 'Parse Location Data' >> beam.ParDo(ParseLocationDataFn())
    )

    # Process locations and prepare notifications
    processed = (
        locations
        | 'Process Locations' >> beam.ParDo(
            ProcessLocationFn(
                firestore_project=known_args.firestore_project,
                firestore_database=known_args.firestore_database,
                firestore_collection=known_args.firestore_collection,
                zones_collection=known_args.zones_collection
            )
        )
    )

    # Extract locations and notifications from processed tuple
    location_and_notification = (
        processed
        | 'Extract Location & Notification' >> beam.Map(lambda x: x)
    )

    # Save to Firestore
    (
        location_and_notification
        | 'Extract Location' >> beam.Map(lambda x: x[0])
        | 'Save to Firestore' >> beam.ParDo(
            SaveToFirestoreFn(
                project=known_args.firestore_project,
                database=known_args.firestore_database,
                collection=known_args.firestore_collection
            )
        )
        | 'Discard Firestore results' >> beam.Map(lambda x: None)
    )

    # Publish notifications
    (
        location_and_notification
        | 'Extract Notification' >> beam.Map(lambda x: x[1])
        | 'Publish Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    # Publish processed locations
    (
        location_and_notification
        | 'Extract Location for output' >> beam.Map(lambda x: x[0])
        | 'Format for output' >> beam.Map(lambda loc: loc.to_json())
        | 'Publish Locations' >> WriteStringsToPubSub(
            topic=known_args.output_location_topic
        )
    )

    # Submit the job and return immediately (don't wait for streaming job)
    pipeline.run()


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.INFO)
    run()
