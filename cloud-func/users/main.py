import os
import psycopg2
import json
import base64
from google.cloud import secretmanager

def user_data_to_sql(event, context):
    # Cloud SQL connection details (use env vars or Secret Manager for prod)
    db_user = os.environ.get("DB_USER", "appuser")
    db_pass = os.environ.get("DB_PASS", "your-secure-password")
    db_name = os.environ.get("DB_NAME", "appdb")
    db_host = os.environ.get("DB_HOST", "/cloudsql/main-cloudsql-instance")

    # Ensure users table exists
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
            CREATE TABLE IF NOT EXISTS users (
                user_id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE,
                nombre VARCHAR(255),
                apellidos VARCHAR(255),
                password VARCHAR(255),
                correo VARCHAR(255),
                telefono VARCHAR(50),
                timestamp TIMESTAMP
            );
        """)
        conn.commit()
        print("tabla users creada")
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating table users: {e}")

    # Decode Pub/Sub message (nativo)
    try:
        if 'data' in event:
            pubsub_message = base64.b64decode(event['data']).decode('utf-8')
            message_json = json.loads(pubsub_message)
            print(f"Mensaje decodificado: {message_json}")
            user_id = message_json.get('user_id')
            username = message_json.get('username')
            nombre = message_json.get('nombre')
            apellidos = message_json.get('apellidos')
            password = message_json.get('password')
            correo = message_json.get('correo')
            telefono = message_json.get('telefono')
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
                INSERT INTO users (user_id, username, nombre, apellidos, password, correo, telefono, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id) DO UPDATE SET
                    username = EXCLUDED.username,
                    nombre = EXCLUDED.nombre,
                    apellidos = EXCLUDED.apellidos,
                    password = EXCLUDED.password,
                    correo = EXCLUDED.correo,
                    telefono = EXCLUDED.telefono,
                    timestamp = EXCLUDED.timestamp
            """
        cursor.execute(insert_query, (user_id, username, nombre, apellidos, password, correo, telefono, timestamp))
        conn.commit()
        cursor.close()
        conn.close()
        print(f"Inserted user: user_id={user_id}, username={username}, nombre={nombre}, apellidos={apellidos}")
    except Exception as e:
        print(f"Error inserting into Cloud SQL: {e}")
