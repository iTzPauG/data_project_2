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

    def __init__(self, tag_id: str, latitude: float, longitude: float,
                 timestamp: Optional[str] = None, **extra_fields):
        self.tag_id = str(tag_id)
        self.latitude = latitude
        self.longitude = longitude
        self.timestamp = timestamp or datetime.now().isoformat()
        self.extra_fields = extra_fields

    @staticmethod
    def from_json(json_str: str) -> 'LocationData':
        try:
            data = json.loads(json_str)
            return LocationData(
                tag_id=data['tag_id'],
                latitude=float(data['latitude']),
                longitude=float(data['longitude']),
                timestamp=data.get('timestamp')
            )
        except (json.JSONDecodeError, ValueError, TypeError, KeyError) as e:
            logging.getLogger(__name__).error(f"Error parsing JSON: {e}")
            raise ValueError(f"Invalid location data: {json_str}")

    def to_dict(self) -> Dict[str, Any]:
        result = {
            'tag_id': self.tag_id,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'timestamp': self.timestamp,
        }
        result.update({k: v for k, v in self.extra_fields.items() if v is not None})
        return result

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    def __repr__(self) -> str:
        return f"LocationData(tag={self.tag_id}, lat={self.latitude}, lon={self.longitude})"


class ParseLocationDataFn(beam.DoFn):
    """Parse JSON bytes into location dicts."""

    def process(self, element: bytes):
        try:
            location = LocationData.from_json(element.decode('utf-8'))
            if -90 <= location.latitude <= 90 and -180 <= location.longitude <= 180:
                yield location.to_dict()
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
    """Check if a location matches any restricted zone using CloudSQL.

    Queries the zones table in CloudSQL (PostgreSQL) with a bounding-box
    pre-filter followed by an exact haversine distance check.

    Outputs to two tagged outputs:
    - 'match': zone violation notifications
    - 'no_match': no violation notifications
    """

    LAT_OFFSET = 0.00045

    def __init__(self, db_host: str, db_user: str, db_pass: str,
                 db_name: str, zones_table: str):
        self.db_host = db_host
        self.db_user = db_user
        self.db_pass = db_pass
        self.db_name = db_name
        self.zones_table = zones_table
        self._conn = None

    def _ensure_connection(self):
        import psycopg2
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(
                host=self.db_host,
                user=self.db_user,
                password=self.db_pass,
                dbname=self.db_name
            )

    def setup(self):
        self._ensure_connection()

    def _query_nearby_zones(self, tag_id: str, latitude: float, longitude: float) -> Optional[Dict]:
        min_lat = latitude - self.LAT_OFFSET
        max_lat = latitude + self.LAT_OFFSET
        lon_offset = self.LAT_OFFSET / math.cos(math.radians(latitude))
        min_lon = longitude - lon_offset
        max_lon = longitude + lon_offset

        try:
            self._ensure_connection()
            cursor = self._conn.cursor()
            cursor.execute(
                f"""
                SELECT tag_id, latitude, longitude, radius, zone_type, zone_name
                FROM {self.zones_table}
                WHERE tag_id   = %s
                  AND latitude  BETWEEN %s AND %s
                  AND longitude BETWEEN %s AND %s
                """,
                (tag_id, min_lat, max_lat, min_lon, max_lon)
            )
            rows = cursor.fetchall()
            cursor.close()
        except Exception as e:
            logging.getLogger(__name__).error(f"Error querying zones from CloudSQL: {e}")
            try:
                self._conn.rollback()
            except Exception:
                self._conn = None
            return None

        for zone_tag_id, zone_lat, zone_lon, zone_radius, zone_type, zone_name in rows:
            if zone_radius is None:
                continue
            distance = haversine_distance(latitude, longitude, zone_lat, zone_lon)
            if distance <= zone_radius:
                return {
                    'zone_id': zone_tag_id,
                    'latitude': zone_lat,
                    'longitude': zone_lon,
                    'radius': zone_radius,
                    'zone_type': zone_type or 'aviso',
                    'zone_name': zone_name or '',
                }
        return None


    def _get_user_info(self, tag_id: str):
        """Get the name of the child and the phone number of the user associated with the tag_id."""
        try:
            self._ensure_connection()
            cursor = self._conn.cursor()
            cursor.execute(
                """
                SELECT t.nombre, u.telefono
                FROM tags t
                JOIN users u ON t.user_id = u.user_id
                WHERE t.tag_id = %s
                """,
                (tag_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            if row:
                return row[0], row[1]
            return None, None
        except Exception as e:
            logging.getLogger(__name__).error(f"Error querying user info: {e}")
            try:
                self._conn.rollback()
            except Exception:
                self._conn = None
            return None, None

    def _generate_message(self, zone_type: str, zone_name: str, nombre: str, telefono: str) -> str:
        zone_display = zone_name if zone_name else 'zona'
        nombre_display = nombre if nombre else 'desconocido'
        telefono_display = telefono if telefono else 'desconocido'
        if zone_type == 'emergencia':
            return f"AVISO: el niño {nombre_display} ha entrado en la zona {zone_display}. Llamando a {telefono_display}"
        else:
            return f"{zone_type}: el niño {nombre_display} ha entrado en la zona {zone_display}"


    def process(self, location: dict):
        try:
            violated_zone = self._query_nearby_zones(location['tag_id'], location['latitude'], location['longitude'])

            if violated_zone:
                distance = haversine_distance(
                    location['latitude'], location['longitude'],
                    violated_zone['latitude'], violated_zone['longitude']
                )
                zone_type = violated_zone.get('zone_type', 'aviso')
                zone_name = violated_zone.get('zone_name', '')
                nombre, telefono = self._get_user_info(location['tag_id'])
                message = self._generate_message(zone_type, zone_name, nombre, telefono)
                yield json.dumps({
                    'message': message,
                    'tag_id': location['tag_id'],
                    'zone_id': violated_zone['zone_id'],
                    'latitude': location['latitude'],
                    'longitude': location['longitude'],
                    'timestamp': location['timestamp'],
                    'zone_radius': violated_zone['radius'],
                    'distance_meters': round(distance, 2),
                    'zone_type': zone_type,
                    'zone_name': zone_name,
                    'nombre': nombre,
                    'telefono': telefono,
                })

        except Exception as e:
            logging.getLogger(__name__).error(f"Error checking zone match: {e}")

    def teardown(self):
        if self._conn and not self._conn.closed:
            self._conn.close()
            logging.getLogger(__name__).info("CloudSQL connection closed")


class SaveLastLocationToFirestoreFn(beam.DoFn):
    """Save/overwrite the last location per tag_id in Firestore."""

    def __init__(self, project: str, database: str, collection: str):
        self.project = project
        self.database = database
        self.collection = collection
        self._db = None

    def setup(self):
        from google.cloud import firestore
        self._db = firestore.Client(project=self.project, database=self.database)

    def process(self, location: dict):
        try:
            doc_data = dict(location)
            doc_data['updated_at'] = datetime.now().isoformat()

            # Use tag_id as document ID so only last location is kept
            doc_ref = self._db.collection(self.collection).document(location['tag_id'])
            doc_ref.set(doc_data)

            logging.getLogger(__name__).info(
                f"Saved last location for tag {location['tag_id']}"
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
    parser.add_argument('--zones_sql', default='zones', help='CloudSQL table name for zones')
    parser.add_argument('--bq_dataset', required=True, help='BigQuery dataset ID')
    parser.add_argument('--bq_table', required=True, help='BigQuery table name')
    parser.add_argument('--bq_notifications_table', default='notifications', help='BigQuery table name for notifications')

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
        | 'Format Location JSON' >> beam.Map(lambda loc: json.dumps(loc))
    )

    # 2b. Guardar historial de ubicaciones en BigQuery
    (
        locations
        | 'LocationData to Dict' >> beam.Map(lambda loc: loc)
        | 'Write to BigQuery' >> WriteToBigQuery(
            table=f"{known_args.project_id}:{known_args.bq_dataset}.{known_args.bq_table}",
            schema='timestamp:TIMESTAMP,tag_id:STRING,latitude:FLOAT,longitude:FLOAT',
            write_disposition=BigQueryDisposition.WRITE_APPEND,
            create_disposition=BigQueryDisposition.CREATE_NEVER
        )
    )

    # 3. Branch B: Check zone match and publish violations only
    notifications = (
        locations
        | 'Check Zone Match' >> beam.ParDo(
            CheckZoneMatchFn(
                db_host=known_args.db_host,
                db_user=known_args.db_user,
                db_pass=known_args.db_pass,
                db_name=known_args.db_name,
                zones_table=known_args.zones_sql
            )
        )
    )

    # 3a. Publish notifications to Pub/Sub
    (
        notifications
        | 'Publish Violation Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    # 3b. Save notifications to BigQuery
    (
        notifications
        | 'Parse Notification JSON' >> beam.Map(lambda x: json.loads(x))
        | 'Write Notifications to BigQuery' >> WriteToBigQuery(
            table=f"{known_args.project_id}:{known_args.bq_dataset}.{known_args.bq_notifications_table}",
            schema='message:STRING,tag_id:STRING,zone_id:STRING,latitude:FLOAT,longitude:FLOAT,timestamp:TIMESTAMP,zone_radius:FLOAT,distance_meters:FLOAT,zone_type:STRING,zone_name:STRING',
            write_disposition=BigQueryDisposition.WRITE_APPEND,
            create_disposition=BigQueryDisposition.CREATE_NEVER
        )
    )

    pipeline.run()


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.INFO)
    run()