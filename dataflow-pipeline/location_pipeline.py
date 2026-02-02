#!/usr/bin/env python3
"""
Location Data Streaming Pipeline

Reads location data (latitude, longitude) from Pub/Sub, processes it,
saves to Firestore, and publishes to output topics.
"""

import argparse
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any

import apache_beam as beam
from apache_beam.options.pipeline_options import PipelineOptions
from apache_beam.options.pipeline_options import StandardOptions
from apache_beam.io.gcp.pubsub import ReadFromPubSub, WriteStringsToPubSub
from google.cloud import firestore

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
            logger.error(f"Error parsing JSON: {e}")
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

    def process(self, element: str):
        try:
            location = LocationData.from_json(element)

            # Validate coordinates
            if self._is_valid_coordinate(location.latitude, location.longitude):
                yield location
            else:
                logger.warning(
                    f"Invalid coordinates: lat={location.latitude}, lon={location.longitude}"
                )
        except Exception as e:
            logger.error(f"Error parsing location data: {e}")

    @staticmethod
    def _is_valid_coordinate(latitude: float, longitude: float) -> bool:
        """Validate latitude and longitude values."""
        return -90 <= latitude <= 90 and -180 <= longitude <= 180


class ProcessLocationFn(beam.DoFn):
    """Process location data and prepare notifications."""

    def __init__(self, firestore_project: str, firestore_database: str,
                 firestore_collection: str):
        self.firestore_project = firestore_project
        self.firestore_database = firestore_database
        self.firestore_collection = firestore_collection
        self._db = None

    def setup(self):
        """Initialize Firestore client."""
        try:
            logger.info(
                f"Setting up Firestore connection to {self.firestore_project}/{self.firestore_database}"
            )
            self._db = firestore.Client(project=self.firestore_project, database=self.firestore_database)
        except Exception as e:
            logger.error(f"Error setting up Firestore connection: {e}")

    def teardown(self):
        """Close Firestore client."""
        try:
            if self._db:
                logger.info("Firestore connection closed")
        except Exception as e:
            logger.error(f"Error closing Firestore connection: {e}")

    def process(self, element: LocationData):
        try:
            logger.info(f"Processing location: {element}")

            # Save to Firestore (actual saving happens in SaveToFirestoreFn)
            # This function just creates notifications
            notification = json.dumps({
                'status': 'processed',
                'latitude': element.latitude,
                'longitude': element.longitude,
                'timestamp': element.timestamp
            })

            yield (element, notification)

        except Exception as e:
            logger.error(f"Error processing location: {e}")


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
            logger.info(f"Initializing Firestore connection to {self.project}/{self.database}")
            self._db = firestore.Client(project=self.project, database=self.database)
        except Exception as e:
            logger.error(f"Error initializing Firestore connection: {e}")
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

            logger.info(f"Saved location to Firestore: {doc_ref.id}")
            yield element

        except Exception as e:
            logger.error(f"Error saving to Firestore: {e}")

    def teardown(self):
        """Close Firestore client."""
        try:
            if self._db:
                logger.info("Firestore connection closed")
        except Exception as e:
            logger.error(f"Error closing Firestore connection: {e}")


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
        '--window_duration',
        type=int,
        default=300,
        help='Window duration in seconds'
    )

    known_args, pipeline_args = parser.parse_known_args(argv)

    # Configure pipeline options
    options = PipelineOptions(pipeline_args)
    options.view_as(StandardOptions).streaming = True

    with beam.Pipeline(options=options) as pipeline:
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
                    firestore_collection=known_args.firestore_collection
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


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.INFO)
    run()
