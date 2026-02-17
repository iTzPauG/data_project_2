#!/usr/bin/env python3
"""
Location Data Streaming Pipeline

Reads location data from Pub/Sub, checks zone matches,
saves last location per user to Firestore, and publishes to output topics.
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
from apache_beam.io.gcp.bigquery import WriteToBigQuery, BigQueryDisposition
from google.cloud import firestore

logging.basicConfig(level=logging.INFO)


class LocationData:
    """Represents a location data point."""

    def __init__(self, user_id: str, latitude: float, longitude: float,
                 timestamp: Optional[str] = None, **extra_fields):
        self.user_id = str(user_id)
        self.latitude = latitude
        self.longitude = longitude
        self.timestamp = timestamp or datetime.now().isoformat()
        self.extra_fields = extra_fields

    @staticmethod
    def from_json(json_str: str) -> 'LocationData':
        try:
            data = json.loads(json_str)
            return LocationData(
                user_id=data['user_id'],
                latitude=float(data['latitude']),
                longitude=float(data['longitude']),
                timestamp=data.get('timestamp')
            )
        except (json.JSONDecodeError, ValueError, TypeError, KeyError) as e:
            logging.getLogger(__name__).error(f"Error parsing JSON: {e}")
            raise ValueError(f"Invalid location data: {json_str}")

    def to_dict(self) -> Dict[str, Any]:
        result = {
            'user_id': self.user_id,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'timestamp': self.timestamp,
        }
        result.update({k: v for k, v in self.extra_fields.items() if v is not None})
        return result

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    def __repr__(self) -> str:
        return f"LocationData(user={self.user_id}, lat={self.latitude}, lon={self.longitude})"


class ParseLocationDataFn(beam.DoFn):
    """Parse JSON bytes into LocationData objects."""

    def process(self, element: bytes):
        try:
            location = LocationData.from_json(element.decode('utf-8'))
            if -90 <= location.latitude <= 90 and -180 <= location.longitude <= 180:
                yield location
            else:
                logging.getLogger(__name__).warning(
                    f"Invalid coordinates: lat={location.latitude}, lon={location.longitude}"
                )
        except Exception as e:
            logging.getLogger(__name__).error(f"Error parsing location data: {e}")


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two GPS points."""
    R = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = (math.sin(delta_phi / 2) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


class CheckZoneMatchFn(beam.DoFn):
    """Check if a location matches any restricted zone.

    Outputs to two tagged outputs:
    - 'match': zone violation notifications
    - 'no_match': no violation notifications
    """

    LAT_OFFSET = 0.00045
    DEFAULT_RADIUS = 50

    def __init__(self, firestore_project: str, firestore_database: str,
                 zones_collection: str):
        self.firestore_project = firestore_project
        self.firestore_database = firestore_database
        self.zones_collection = zones_collection
        self._db = None

    def setup(self):
        from google.cloud import firestore
        self._db = firestore.Client(
            project=self.firestore_project, database=self.firestore_database
        )

    def _query_nearby_zones(self, latitude: float, longitude: float) -> Optional[Dict]:
        min_lat = latitude - self.LAT_OFFSET
        max_lat = latitude + self.LAT_OFFSET
        lon_offset = self.LAT_OFFSET / math.cos(math.radians(latitude))
        min_lon = longitude - lon_offset
        max_lon = longitude + lon_offset

        query = (
            self._db.collection(self.zones_collection)
            .where('latitude', '>=', min_lat)
            .where('latitude', '<=', max_lat)
        )

        for doc in query.stream():
            zone = doc.to_dict()
            zone['id'] = doc.id
            zone_lon = zone.get('longitude')
            if zone_lon is None or zone_lon < min_lon or zone_lon > max_lon:
                continue
            zone_radius = zone.get('radius', self.DEFAULT_RADIUS)
            distance = haversine_distance(latitude, longitude, zone['latitude'], zone_lon)
            if distance <= zone_radius:
                return zone
        return None

    def process(self, location: LocationData):
        try:
            violated_zone = self._query_nearby_zones(location.latitude, location.longitude)

            if violated_zone:
                distance = haversine_distance(
                    location.latitude, location.longitude,
                    violated_zone['latitude'], violated_zone['longitude']
                )
                notification = json.dumps({
                    'status': 'zone_violation',
                    'user_id': location.user_id,
                    'latitude': location.latitude,
                    'longitude': location.longitude,
                    'timestamp': location.timestamp,
                    'zone_radius': violated_zone.get('radius', 50),
                    'distance_meters': round(distance, 2),
                })
                yield beam.pvalue.TaggedOutput('match', notification)
            else:
                notification = json.dumps({
                    'status': 'no_match',
                    'user_id': location.user_id,
                    'latitude': location.latitude,
                    'longitude': location.longitude,
                    'timestamp': location.timestamp,
                })
                yield beam.pvalue.TaggedOutput('no_match', notification)

        except Exception as e:
            logging.getLogger(__name__).error(f"Error checking zone match: {e}")

    def teardown(self):
        if self._db:
            logging.getLogger(__name__).info("Firestore connection closed")


class SaveLastLocationToFirestoreFn(beam.DoFn):
    """Save/overwrite the last location per user_id in Firestore."""

    def __init__(self, project: str, database: str, collection: str):
        self.project = project
        self.database = database
        self.collection = collection
        self._db = None

    def setup(self):
        from google.cloud import firestore
        self._db = firestore.Client(project=self.project, database=self.database)

    def process(self, location: LocationData):
        try:
            doc_data = location.to_dict()
            doc_data['updated_at'] = datetime.now().isoformat()

            # Use user_id as document ID so only last location is kept
            doc_ref = self._db.collection(self.collection).document(location.user_id)
            doc_ref.set(doc_data)

            logging.getLogger(__name__).info(
                f"Saved last location for user {location.user_id}"
            )
            yield location
        except Exception as e:
            logging.getLogger(__name__).error(f"Error saving to Firestore: {e}")

    def teardown(self):
        if self._db:
            logging.getLogger(__name__).info("Firestore connection closed")


def run(argv=None):
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument('--db_user', required=True, help='Cloud SQL user')
    parser.add_argument('--db_pass', required=True, help='Cloud SQL password')
    parser.add_argument('--db_name', required=True, help='Cloud SQL database name')
    parser.add_argument('--db_host', required=True, help='Cloud SQL host')
    parser.add_argument('--input_subscription', required=True)
    parser.add_argument('--output_notifications_topic', required=True)
    parser.add_argument('--project_id', required=True, help='GCP project ID')
    parser.add_argument('--firestore_database', required=True)
    parser.add_argument('--firestore_collection', required=True)
    parser.add_argument('--zones_sql', help='SQL table for checking zones')
    parser.add_argument('--bq_dataset', required=True, help='BigQuery dataset ID')
    parser.add_argument('--bq_table', required=True, help='BigQuery table name')

    known_args, pipeline_args = parser.parse_known_args(argv)

    options = PipelineOptions(pipeline_args, save_main_session=True)
    options.view_as(StandardOptions).streaming = True

    pipeline = beam.Pipeline(options=options)

    # 1. Read from Pub/Sub and parse
    locations = (
        pipeline
        | 'Read from Pub/Sub' >> ReadFromPubSub(subscription=known_args.input_subscription)
        | 'Parse Location Data' >> beam.ParDo(ParseLocationDataFn())
    )

    # 2. Branch A: Save last location to Firestore
    (
        locations
        | 'Save Last Location to Firestore' >> beam.ParDo(
            SaveLastLocationToFirestoreFn(
                project=known_args.project_id,
                database=known_args.firestore_database,
                collection=known_args.firestore_collection
            )
        )
        | 'Format Location JSON' >> beam.Map(lambda loc: loc.to_json())
    )

    # 2b. Guardar historial de ubicaciones en BigQuery
    (
        locations
        | 'LocationData to Dict' >> beam.Map(lambda loc: loc.to_dict())
        | 'Write to BigQuery' >> WriteToBigQuery(
            table=f"{known_args.project_id}:{known_args.bq_dataset}.{known_args.bq_table}",
            schema='timestamp:TIMESTAMP,user_id:STRING,latitude:FLOAT,longitude:FLOAT',
            write_disposition=BigQueryDisposition.WRITE_APPEND,
            create_disposition=BigQueryDisposition.CREATE_NEVER
        )
    )

    # 3. Branch B: Check zone match and publish notifications
    zone_results = (
        locations
        | 'Check Zone Match' >> beam.ParDo(
            CheckZoneMatchFn(
                firestore_project=known_args.project_id,
                firestore_database=known_args.firestore_database,
                zones_collection=known_args.zones_sql
            )
        ).with_outputs('match', 'no_match')
    )

    # Publish zone violations to notifications topic
    (
        zone_results.match
        | 'Publish Match Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    # Publish no-match results to notifications topic too
    (
        zone_results.no_match
        | 'Publish No-Match Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    pipeline.run()


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.INFO)
    run()