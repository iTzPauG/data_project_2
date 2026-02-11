import os
import psycopg2
import json
import base64
from google.cloud import secretmanager

def zone_data_to_sql(event, context):
    # Cloud SQL connection details (use env vars or Secret Manager for prod)
    db_user = os.environ.get("DB_USER", "appuser")
    db_pass = os.environ.get("DB_PASS", "your-secure-password")
    db_name = os.environ.get("DB_NAME", "appdb")
    db_host = os.environ.get("DB_HOST", "/cloudsql/main-cloudsql-instance")
    project_id = os.environ.get("GCP_PROJECT", "data-project-2-kids")

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
        user_id = message_json.get('user_id')
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
            INSERT INTO forbidden_locations (user_id, latitude, longitude, timestamp, radius)
            VALUES (%s, %s, %s, %s, %s)
        """
        cursor.execute(insert_query, (user_id, latitude, longitude, timestamp, radius))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Inserted: user_id={user_id}, lat={latitude}, lon={longitude}, ts={timestamp}, radius={radius}")
    except Exception as e:
        print(f"Error inserting into Cloud SQL: {e}")