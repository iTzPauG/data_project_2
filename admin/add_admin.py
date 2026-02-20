"""
CLI script to add an admin user to Cloud SQL.

Usage:
    python add_admin.py

Set env vars before running:
    export DB_HOST=<cloud-sql-public-ip>
    export DB_USER=<db-user>
    export DB_PASS=<db-password>
    export DB_NAME=appdb   # optional, defaults to appdb
"""

import getpass
import os
import sys

import bcrypt
import psycopg2

DB_HOST = os.environ.get("DB_HOST", "")
DB_USER = os.environ.get("DB_USER", "")
DB_PASS = os.environ.get("DB_PASS", "")
DB_NAME = os.environ.get("DB_NAME", "appdb")


def main():
    if not all([DB_HOST, DB_USER, DB_PASS]):
        print("ERROR: Set DB_HOST, DB_USER, DB_PASS environment variables first.")
        sys.exit(1)

    username = input("New admin username: ").strip()
    if not username:
        print("ERROR: Username cannot be empty.")
        sys.exit(1)

    password = getpass.getpass("Password: ")
    if len(password.encode()) > 72:
        print("ERROR: Password must be 72 characters or fewer (bcrypt limit).")
        sys.exit(1)
    confirm  = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("ERROR: Passwords do not match.")
        sys.exit(1)

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = psycopg2.connect(
        host=DB_HOST, user=DB_USER, password=DB_PASS, dbname=DB_NAME
    )
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id            SERIAL PRIMARY KEY,
                username      VARCHAR(50)  UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                last_login    TIMESTAMP WITH TIME ZONE
            )
        """)
        conn.commit()
        cur.execute(
            "INSERT INTO admins (username, password_hash) VALUES (%s, %s)",
            (username, hashed),
        )
        conn.commit()
        print(f"Admin user '{username}' created successfully.")
    except psycopg2.errors.UniqueViolation:
        print(f"ERROR: Username '{username}' already exists.")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
