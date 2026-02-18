# Dashboard — Local Deployment Guide

Real-time location dashboard. Streams historical trails from **BigQuery** and live position updates from **Firestore** to a Leaflet.js map via WebSocket.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.10+ | |
| `gcloud` CLI | [Install guide](https://cloud.google.com/sdk/docs/install) |
| GCP project with the pipeline running | BigQuery table + Firestore `locations` collection must have data |

---

## 1. Authenticate with GCP

The dashboard uses Application Default Credentials — no key files needed.

```bash
gcloud auth application-default login
```

---

## 2. Configure environment variables

```bash
cp dashboard/backend/.env.example dashboard/backend/.env
```

Edit `dashboard/backend/.env` and fill in your real values:

```
GCP_PROJECT_ID=your-gcp-project-id       # GCP project ID
BQ_DATASET=your-bigquery-dataset          # e.g. dataset_kids
BQ_TABLE=your-bigquery-table              # e.g. my_table
PUBSUB_SUB_ID=your-pubsub-subscription-id # notifications subscription ID
DEFAULT_HOURS=24                           # default history window (optional)
FIRESTORE_DB=location-db                  # Firestore database name (optional)
FIRESTORE_COLLECTION=locations            # Firestore collection name (optional)
```

> **Never commit `.env`** — it is already listed in `.gitignore`.

---

## 3. Install dependencies

```bash
pip install -r dashboard/backend/requirements.txt
```

---

## 4. Run the server

```bash
cd dashboard/backend
export $(grep -v '^#' .env | xargs)
uvicorn main:app --reload --port 8081
```

Open **http://localhost:8081** in your browser.

---

## What you should see

1. The map centers on the users' current positions immediately (from Firestore).
2. Historical movement trails load within a few seconds (from BigQuery).
3. The status pill switches to **Live** and markers update in real time as new location data arrives.

---

## WebSocket message flow

```
browser connects
    │
    ├─ server: latest_positions   ← Firestore (current positions, instant)
    ├─ server: historical_batch   ← BigQuery  (full trail, seconds)
    ├─ server: live_update        ← Firestore on_snapshot (real-time, per update)
    └─ server: ping               ← keepalive every 30s
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ERROR: required environment variable 'GCP_PROJECT_ID' is not set` | `.env` not loaded | Run `export $(grep -v '^#' .env \| xargs)` before uvicorn |
| Map loads but no trails | BigQuery table empty or wrong dataset/table name | Check `BQ_DATASET` and `BQ_TABLE` in `.env` |
| Markers don't appear | Firestore collection empty or wrong name | Check `FIRESTORE_DB` and `FIRESTORE_COLLECTION` |
| `403 Forbidden` from GCP | ADC not set or missing IAM roles | Re-run `gcloud auth application-default login`; ensure your account has `roles/bigquery.dataViewer`, `roles/bigquery.jobUser`, `roles/datastore.user` |
| Port 8081 already in use | Another process on the port | Use `--port 8082` (or any free port) |
