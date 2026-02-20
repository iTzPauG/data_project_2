import os
import psycopg2
import json
import base64
from google.cloud import secretmanager

def kids_data_to_sql(event, context):
    # Cloud SQL connection details (use env vars or Secret Manager for prod)
    db_user = os.environ.get("DB_USER", "appuser")
    db_pass = os.environ.get("DB_PASS", "your-secure-password")
    db_name = os.environ.get("DB_NAME", "appdb")
    db_host = os.environ.get("DB_HOST", "/cloudsql/main-cloudsql-instance")

    # Ensure kids table exists
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
            CREATE TABLE IF NOT EXISTS kids (
                tag_id VARCHAR(255) PRIMARY KEY,
                nombre VARCHAR(255),
                user_id VARCHAR(255),
                timestamp TIMESTAMP
            );
        """)
        conn.commit()
        print("tabla kids creada")
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating table kids: {e}")

    # Decode Pub/Sub message (nativo)
    try:
        if 'data' in event:
            pubsub_message = base64.b64decode(event['data']).decode('utf-8')
            message_json = json.loads(pubsub_message)
            print(f"Mensaje decodificado: {message_json}")
            tag_id = message_json.get('tag_id')
            nombre = message_json.get('nombre')
            user_id = message_json.get('user_id')
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
                INSERT INTO kids (tag_id, nombre, user_id, timestamp)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (tag_id) DO UPDATE SET
                    nombre = EXCLUDED.nombre,
                    user_id = EXCLUDED.user_id,
                    timestamp = EXCLUDED.timestamp
            """
        cursor.execute(insert_query, (tag_id, nombre, user_id, timestamp))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Inserted kid: tag_id={tag_id}, nombre={nombre}, user_id={user_id}")
    except Exception as e:
        print(f"Error inserting into Cloud SQL: {e}")
