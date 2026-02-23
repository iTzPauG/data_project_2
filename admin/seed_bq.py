"""
Seed BigQuery table with one year of fake location messages.

Usage:
    python seed_bq.py

Requires:
    pip install google-cloud-bigquery
    GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC set up
"""

import os
import random
from datetime import datetime, timedelta, timezone

from google.cloud import bigquery

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT  = os.environ.get("BQ_PROJECT",  "data-project-2-kids")
DATASET  = os.environ.get("BQ_DATASET",  "dataset_kids")
TABLE    = os.environ.get("BQ_TABLE",    "my_table")
TABLE_ID = f"{PROJECT}.{DATASET}.{TABLE}"

# Fake tag IDs (kids being tracked)
TAG_IDS = ["tag_001", "tag_002", "tag_003", "tag_004", "tag_005",
           "tag_006", "tag_007", "tag_008"]

# Rough bounding box for Valencia, Spain
LAT_MIN, LAT_MAX = 39.40, 39.55
LON_MIN, LON_MAX = -0.45, -0.30

DAYS_BACK = 365

# Messages per day follow a rough weekly pattern:
# weekdays busier, weekends slightly quieter, with random noise
def messages_for_day(day: datetime) -> int:
    base = 60 if day.weekday() < 5 else 35   # weekday vs weekend
    return max(5, int(base + random.gauss(0, 15)))


def main() -> None:
    client = bigquery.Client(project=PROJECT)

    now   = datetime.now(timezone.utc)
    start = now - timedelta(days=DAYS_BACK)

    rows: list[dict] = []

    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while current < now:
        count = messages_for_day(current)
        # Spread messages across the waking hours (7 h → 22 h)
        for _ in range(count):
            offset_seconds = random.randint(7 * 3600, 22 * 3600)
            ts = current + timedelta(seconds=offset_seconds)
            if ts > now:
                continue
            rows.append({
                "timestamp": ts.isoformat(),
                "tag_id":    random.choice(TAG_IDS),
                "latitude":  round(random.uniform(LAT_MIN, LAT_MAX), 6),
                "longitude": round(random.uniform(LON_MIN, LON_MAX), 6),
            })
        current += timedelta(days=1)

    print(f"Inserting {len(rows):,} rows into {TABLE_ID} …")

    # Insert in batches of 500 (BQ streaming insert limit per request)
    batch_size = 500
    errors_total = 0
    for i in range(0, len(rows), batch_size):
        batch  = rows[i : i + batch_size]
        errors = client.insert_rows_json(TABLE_ID, batch)
        if errors:
            print(f"  Batch {i // batch_size + 1} errors: {errors}")
            errors_total += len(errors)
        else:
            pct = min(100, int((i + len(batch)) / len(rows) * 100))
            print(f"  {pct:3d}% — inserted rows {i + 1}–{i + len(batch)}")

    if errors_total == 0:
        print(f"\nDone. {len(rows):,} rows inserted successfully.")
    else:
        print(f"\nDone with {errors_total} error(s).")


if __name__ == "__main__":
    main()
