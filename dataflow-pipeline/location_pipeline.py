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
import psycopg2
from psycopg2 import pool

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
        logger = logging.getLogger(__name__)
        try:
            logger.info(f"Parsing location data from Pub/Sub message")
            location = LocationData.from_json(element.decode('utf-8'))
            logger.debug(f"Parsed location: {location}")

            if -90 <= location.latitude <= 90 and -180 <= location.longitude <= 180:
                logger.info(f"Valid location data for user {location.user_id}: lat={location.latitude}, lon={location.longitude}")
                yield location
            else:
                logger.warning(
                    f"Invalid coordinates for user {location.user_id}: lat={location.latitude}, lon={location.longitude}"
                )
        except Exception as e:
            logger.error(f"Error parsing location data: {e}, raw data: {element[:200]}")


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

    Outputs to two tagged outputs:
    - 'match': zone violation notifications
    - 'no_match': no violation notifications
    """

    LAT_OFFSET = 0.00045
    DEFAULT_RADIUS = 50

    def __init__(self, db_host: str, db_name: str, db_user: str, db_pass: str):
        self.db_host = db_host
        self.db_name = db_name
        self.db_user = db_user
        self.db_pass = db_pass
        self._connection_pool = None

    def setup(self):
        logger = logging.getLogger(__name__)
        logger.info(f"Setting up CloudSQL connection pool: host={self.db_host}, database={self.db_name}")
        try:
            self._connection_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=1,
                maxconn=3,  # Conservative limit for db-f1-micro (25 connection limit)
                host=self.db_host,
                database=self.db_name,
                user=self.db_user,
                password=self.db_pass,
                connect_timeout=10
            )
            logger.info("CloudSQL connection pool established successfully")
        except Exception as e:
            logger.error(f"Failed to create CloudSQL connection pool: {e}", exc_info=True)
            raise

    def _query_nearby_zones(self, user_id: str, latitude: float, longitude: float) -> Optional[Dict]:
        logger = logging.getLogger(__name__)
        logger.debug(f"Querying nearby zones for user {user_id} at location: lat={latitude}, lon={longitude}")

        min_lat = latitude - self.LAT_OFFSET
        max_lat = latitude + self.LAT_OFFSET

        conn = None
        cursor = None
        try:
            conn = self._connection_pool.getconn()
            cursor = conn.cursor()

            # Query zones by user_id and latitude range
            query = """
                SELECT user_id, latitude, longitude, radius, timestamp
                FROM zones
                WHERE user_id = %s
                  AND latitude >= %s
                  AND latitude <= %s
                ORDER BY timestamp DESC
            """
            cursor.execute(query, (user_id, min_lat, max_lat))
            zones = cursor.fetchall()

            logger.debug(f"Found {len(zones)} potential zones for user {user_id}")

            # Calculate longitude offset based on latitude
            lon_offset = self.LAT_OFFSET / math.cos(math.radians(latitude))
            min_lon = longitude - lon_offset
            max_lon = longitude + lon_offset

            zones_checked = 0
            for zone_row in zones:
                zones_checked += 1
                zone_user_id, zone_lat, zone_lon, zone_radius, zone_timestamp = zone_row

                # Filter by longitude bounds (not indexed)
                if zone_lon is None or zone_lon < min_lon or zone_lon > max_lon:
                    logger.debug(f"Zone filtered out by longitude bounds")
                    continue

                # Use default radius if not specified
                if zone_radius is None:
                    zone_radius = self.DEFAULT_RADIUS

                # Calculate distance using haversine
                distance = haversine_distance(latitude, longitude, zone_lat, zone_lon)
                logger.debug(f"Zone: distance={distance:.2f}m, radius={zone_radius}m")

                if distance <= zone_radius:
                    logger.info(f"Zone match found for user {user_id}: distance={distance:.2f}m")
                    return {
                        'user_id': zone_user_id,
                        'latitude': zone_lat,
                        'longitude': zone_lon,
                        'radius': zone_radius,
                        'timestamp': zone_timestamp.isoformat() if zone_timestamp else None,
                    }

            logger.info(f"No zone violations found for user {user_id} after checking {zones_checked} zones")
            return None

        except Exception as e:
            logger.error(f"Error querying CloudSQL for zones: {e}", exc_info=True)
            return None
        finally:
            if cursor:
                cursor.close()
            if conn:
                self._connection_pool.putconn(conn)

    def process(self, location: LocationData):
        logger = logging.getLogger(__name__)
        try:
            logger.info(f"Checking zone match for user {location.user_id} at ({location.latitude}, {location.longitude})")
            violated_zone = self._query_nearby_zones(location.user_id, location.latitude, location.longitude)

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
                logger.warning(f"ZONE VIOLATION: User {location.user_id} entered restricted zone, distance={distance:.2f}m")
                yield beam.pvalue.TaggedOutput('match', notification)
            else:
                notification = json.dumps({
                    'status': 'no_match',
                    'user_id': location.user_id,
                    'latitude': location.latitude,
                    'longitude': location.longitude,
                    'timestamp': location.timestamp,
                })
                logger.info(f"No zone violation for user {location.user_id}")
                yield beam.pvalue.TaggedOutput('no_match', notification)

        except Exception as e:
            logger.error(f"Error checking zone match for user {location.user_id}: {e}", exc_info=True)

    def teardown(self):
        if self._connection_pool:
            logger = logging.getLogger(__name__)
            logger.info("Closing CloudSQL connection pool")
            self._connection_pool.closeall()
            logger.info("CloudSQL connection pool closed")


class SaveLastLocationToFirestoreFn(beam.DoFn):
    """Save/overwrite the last location per user_id in Firestore."""

    def __init__(self, project: str, database: str, collection: str):
        self.project = project
        self.database = database
        self.collection = collection
        self._db = None

    def setup(self):
        from google.cloud import firestore
        logger = logging.getLogger(__name__)
        logger.info(f"Setting up Firestore connection for saving locations: project={self.project}, database={self.database}, collection={self.collection}")
        self._db = firestore.Client(project=self.project, database=self.database)
        logger.info("Firestore connection for location saving established successfully")

    def process(self, location: LocationData):
        logger = logging.getLogger(__name__)
        try:
            logger.info(f"Saving last location to Firestore for user {location.user_id}")
            doc_data = location.to_dict()
            doc_data['updated_at'] = datetime.now().isoformat()

            # Use user_id as document ID so only last location is kept
            doc_ref = self._db.collection(self.collection).document(location.user_id)
            doc_ref.set(doc_data)

            logger.info(
                f"Successfully saved last location for user {location.user_id} at ({location.latitude}, {location.longitude})"
            )
            yield location
        except Exception as e:
            logger.error(f"Error saving to Firestore for user {location.user_id}: {e}", exc_info=True)

    def teardown(self):
        if self._db:
            logging.getLogger(__name__).info("Firestore connection closed")


def run(argv=None):
    logger = logging.getLogger(__name__)
    logger.info("Starting Location Data Streaming Pipeline")

    parser = argparse.ArgumentParser()
    parser.add_argument('--input_topic', required=False, help='(Deprecated) Pub/Sub topic to read from')
    parser.add_argument('--input_subscription', required=False, help='Pub/Sub subscription to read from')
    parser.add_argument('--output_notifications_topic', required=True)
    parser.add_argument('--firestore_project', required=True)
    parser.add_argument('--firestore_database', required=True)
    parser.add_argument('--firestore_collection', required=True,
                        help='Firestore collection for last user locations')
    parser.add_argument('--db_host', required=True, help='CloudSQL instance IP address')
    parser.add_argument('--db_name', required=True, help='CloudSQL database name')
    parser.add_argument('--db_user', required=True, help='CloudSQL user name')
    parser.add_argument('--db_pass', required=True, help='CloudSQL user password')
    parser.add_argument('--bq_project', required=True, help='BigQuery project ID')
    parser.add_argument('--bq_dataset', required=True, help='BigQuery dataset ID')
    parser.add_argument('--bq_table', required=True, help='BigQuery table name')

    known_args, pipeline_args = parser.parse_known_args(argv)

    logger.info(f"Pipeline configuration: firestore_project={known_args.firestore_project}, "
                f"firestore_db={known_args.firestore_database}, "
                f"bq_table={known_args.bq_project}:{known_args.bq_dataset}.{known_args.bq_table}")

    # Validate that either subscription or topic is provided
    if not known_args.input_subscription and not known_args.input_topic:
        raise ValueError("Either --input_subscription or --input_topic must be provided")

    options = PipelineOptions(pipeline_args, save_main_session=True)
    options.view_as(StandardOptions).streaming = True

    logger.info("Creating Apache Beam pipeline in streaming mode")
    pipeline = beam.Pipeline(options=options)

    # 1. Read from Pub/Sub and parse (prefer subscription over topic)
    logger.info("Step 1: Configuring Pub/Sub input source")
    pubsub_read_kwargs = {}
    if known_args.input_subscription:
        pubsub_read_kwargs['subscription'] = known_args.input_subscription
        logger.info(f"Reading from subscription: {known_args.input_subscription}")
    else:
        pubsub_read_kwargs['topic'] = known_args.input_topic
        logger.warning(
            f"Reading from topic: {known_args.input_topic} (creates temporary subscription)"
        )

    logger.info("Building pipeline step: Read and Parse location data")
    locations = (
        pipeline
        | 'Read from Pub/Sub' >> ReadFromPubSub(**pubsub_read_kwargs)
        | 'Parse Location Data' >> beam.ParDo(ParseLocationDataFn())
    )

    # 2. Branch A: Save last location to Firestore
    logger.info(f"Step 2A: Configuring Firestore save")
    (
        locations
        | 'Save Last Location to Firestore' >> beam.ParDo(
            SaveLastLocationToFirestoreFn(
                project=known_args.firestore_project,
                database=known_args.firestore_database,
                collection=known_args.firestore_collection
            )
        )
    )

    # 2b. Guardar historial de ubicaciones en BigQuery
    logger.info(f"Step 2B: Configuring BigQuery write to {known_args.bq_project}:{known_args.bq_dataset}.{known_args.bq_table}")
    (
        locations
        # Main problem of inserting into Bigquery was here: was to_json instead of to_dict
        | 'LocationData to Dict' >> beam.Map(lambda loc: loc.to_dict())
        | 'Write to BigQuery' >> WriteToBigQuery(
            table=f"{known_args.bq_project}:{known_args.bq_dataset}.{known_args.bq_table}",
            schema='timestamp:TIMESTAMP,user_id:STRING,latitude:FLOAT,longitude:FLOAT',
            write_disposition=BigQueryDisposition.WRITE_APPEND,
            create_disposition=BigQueryDisposition.CREATE_NEVER
        )
    )

    # 3. Branch B: Check zone match and publish notifications
    logger.info(f"Step 3: Configuring zone matching against CloudSQL database '{known_args.db_name}'")
    zone_results = (
        locations
        | 'Check Zone Match' >> beam.ParDo(
            CheckZoneMatchFn(
                db_host=known_args.db_host,
                db_name=known_args.db_name,
                db_user=known_args.db_user,
                db_pass=known_args.db_pass
            )
        ).with_outputs('match', 'no_match')
    )

    # Publish zone violations to notifications topic
    logger.info(f"Step 4: Publishing zone violations to notifications topic: {known_args.output_notifications_topic}")
    (
        zone_results.match
        | 'Publish Match Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    # Publish no-match results to notifications topic too
    logger.info(f"Step 5: Publishing no-match results to notifications topic: {known_args.output_notifications_topic}")
    (
        zone_results.no_match
        | 'Publish No-Match Notifications' >> WriteStringsToPubSub(
            topic=known_args.output_notifications_topic
        )
    )

    logger.info("Pipeline construction complete. Starting pipeline execution...")
    pipeline.run()
    logger.info("Pipeline started successfully")


if __name__ == '__main__':
    logging.getLogger().setLevel(logging.INFO)
    run()