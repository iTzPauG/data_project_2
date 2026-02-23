import os
import psycopg2
import json
import base64


def zone_data_to_sql(event, context):
    # Cloud SQL connection details (use env vars or Secret Manager for prod)
    db_user = os.environ.get("DB_USER", "appuser")
    db_pass = os.environ.get("DB_PASS", "your-secure-password")
    db_name = os.environ.get("DB_NAME", "appdb")
    db_host = os.environ.get("DB_HOST", "/cloudsql/main-cloudsql-instance")

    try:
        conn = psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_pass,
            host=db_host
        )
        cursor = conn.cursor()
        print("conectado a la base de datos")
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS zones (
                tag_id VARCHAR(255),
                latitude FLOAT,
                longitude FLOAT,
                timestamp TIMESTAMP,
                radius FLOAT
            );
        """)
        conn.commit()
        print("tabla creada")
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating table zones: {e}")

    try:
        if 'data' in event:
            pubsub_message = base64.b64decode(event['data']).decode('utf-8')
            message_json = json.loads(pubsub_message)
            print(f"Mensaje decodificado: {message_json}")
            latitude = message_json.get('latitude')
            longitude = message_json.get('longitude')
            radius = message_json.get('radius')
            tag_id = message_json.get('tag_id')
            timestamp = message_json.get('timestamp')
            if timestamp is None:
                from datetime import datetime
                timestamp = datetime.now().isoformat()
        else:
            print("No 'data' field in Pub/Sub event.")
            return
    except Exception as e:
        print(f"Error decoding message: {e}")
        return

    try:
        conn = psycopg2.connect(
            dbname=db_name,
            user=db_user,
            password=db_pass,
            host=db_host
        )
        cursor = conn.cursor()
        insert_query = """
                INSERT INTO zones (tag_id, latitude, longitude, timestamp, radius)
                VALUES (%s, %s, %s, %s, %s)
            """
        cursor.execute(insert_query, (tag_id, latitude, longitude, timestamp, radius))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Inserted: tag_id={tag_id}, lat={latitude}, lon={longitude}, ts={timestamp}, radius={radius}")
    except Exception as e:
        print(f"Error inserting into Cloud SQL: {e}")