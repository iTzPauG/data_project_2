"""
Cloud Function to process Pub/Sub messages and insert into Cloud SQL.

1. Triggered by a Pub/Sub message (forbidden-relevant-location-data topic).
2. Reads the message fields: latitude, longitude, timestamp, radius.
3. Inserts the data into a table in Cloud SQL (Postgres).

EDEM. Master Big Data & Cloud 2025/2026
"""

import base64
import json
import os
import psycopg2
from google.cloud import secretmanager

def get_secret(secret_id, project_id):
    client = secretmanager.SecretManagerServiceClient()
    name = f"projects/{project_id}/secrets/{secret_id}/versions/latest"
    response = client.access_secret_version(request={"name": name})
    return response.payload.data.decode("UTF-8")

def forbidden_location_to_sql(event, context):
    # Cloud SQL connection details (use env vars or Secret Manager for prod)
    db_user = os.environ.get("DB_USER", "appuser")
    db_pass = os.environ.get("DB_PASS", "your-secure-password")
    db_name = os.environ.get("DB_NAME", "appdb")
    db_host = os.environ.get("DB_HOST", "/cloudsql/INSTANCE_CONNECTION_NAME")  # Use Cloud SQL Proxy or Unix socket
    project_id = os.environ.get("GCP_PROJECT", "data-project-2-kids")
    # Optionally, fetch password from Secret Manager
    # db_pass = get_secret("cloudsql_password", project_id)

    # Decode Pub/Sub message
    if 'data' in event:
        pubsub_message = base64.b64decode(event['data']).decode('utf-8')
        try:
            message_json = json.loads(pubsub_message)
        except Exception as e:
            print(f"Error decoding message: {e}")
            return
        latitude = message_json.get('latitude')
        longitude = message_json.get('longitude')
        timestamp = message_json.get('timestamp')
        radius = message_json.get('radius')
    else:
        print("No 'data' field in Pub/Sub event.")
        return

    # Insert into Cloud SQL
    try:
        conn = psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_pass,
            host=db_host
        )
        cursor = conn.cursor()
        insert_query = """
            INSERT INTO forbidden_locations (latitude, longitude, timestamp, radius)
            VALUES (%s, %s, %s, %s)
        """
        cursor.execute(insert_query, (latitude, longitude, timestamp, radius))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Inserted: lat={latitude}, lon={longitude}, ts={timestamp}, radius={radius}")
    except Exception as e:
        print(f"Error inserting into Cloud SQL: {e}")
