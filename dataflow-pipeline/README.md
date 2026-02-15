# Location Dataflow Pipeline - Python

Apache Beam streaming pipeline (Python) for processing location data from Google Cloud Pub/Sub and storing in Firestore.

## Architecture

```
Pub/Sub (incoming-location-data)
           ↓
    [Parse JSON]
           ↓
    [Process Locations]
           ↓
    ┌──────────────┬──────────────────────┐
    ↓              ↓
Firestore      Pub/Sub
(save data)    (notifications)
                (processed-locations)
```

## Prerequisites

- Python 3.8+
- pip (Python package manager)
- Google Cloud SDK (gcloud CLI)
- Active GCP Project with Dataflow, Pub/Sub, and Firestore APIs enabled

## Installation

### 1. Create Virtual Environment

```bash
cd dataflow-pipeline
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Authenticate with GCP

```bash
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

## Project Structure

```
dataflow-pipeline/
├── location_pipeline.py       # Main pipeline code
├── requirements.txt           # Python dependencies
├── setup.py                   # Package configuration
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## Code Overview

### location_pipeline.py

**Classes:**

- **LocationData**: Data model for latitude/longitude pairs
  - `from_json()`: Parse from JSON string
  - `to_json()`: Serialize to JSON
  - `to_dict()`: Convert to dictionary

- **ParseLocationDataFn**: DoFn to parse JSON into LocationData
  - Validates coordinates (lat: -90 to 90, lon: -180 to 180)
  - Filters invalid data

- **ProcessLocationFn**: DoFn to process location data
  - Prepares notification messages
  - Returns tuple of (location, notification)

- **SaveToFirestoreFn**: DoFn to save data to Firestore
  - Writes documents to Firestore collection
  - Auto-generates document IDs

**Pipeline Stages:**

1. Read from Pub/Sub topic
2. Parse JSON strings to LocationData objects
3. Validate coordinates
4. Process locations and prepare notifications
5. Save to Firestore
6. Publish notifications
7. Publish processed locations

## Running Locally

### Development with DirectRunner

Test your pipeline locally without deploying to Dataflow:

```bash
python location_pipeline.py \
  --input_topic=projects/YOUR_PROJECT_ID/topics/incoming-location-data \
  --output_notifications_topic=projects/YOUR_PROJECT_ID/topics/notifications \
  --firestore_project=YOUR_PROJECT_ID \
  --firestore_database=location-db \
  --firestore_collection=locations \
  --runner=DirectRunner
```

### Send Test Data

```bash
# From another terminal
gcloud pubsub topics publish incoming-location-data \
  --message '{"latitude": 40.7128, "longitude": -74.0060}'
```

## Deployment to Google Cloud Dataflow

### 1. Package the Pipeline

**Option A: Using setup.py**

```bash
python setup.py sdist
```

**Option B: Create a staging package**

```bash
mkdir -p staging
cp location_pipeline.py staging/
cp requirements.txt staging/
```

### 2. Upload to GCS

```bash
STAGING_BUCKET="$(gcloud config get-value project)-dataflow-staging"
gsutil cp location_pipeline.py gs://$STAGING_BUCKET/templates/
gsutil cp requirements.txt gs://$STAGING_BUCKET/templates/
```

### 3. Deploy Dataflow Job

**Using gcloud CLI:**

```bash
PROJECT_ID=$(gcloud config get-value project)
STAGING_BUCKET="${PROJECT_ID}-dataflow-staging"
TEMP_BUCKET="${PROJECT_ID}-dataflow-temp"
SERVICE_ACCOUNT=$(gcloud iam service-accounts list --format="value(email)" --filter="displayName:dataflow-runner")

gcloud dataflow jobs run location-streaming-pipeline \
  --region=europe-southwest1 \
  --staging-location=gs://$STAGING_BUCKET/staging \
  --temp-location=gs://$TEMP_BUCKET \
  --service-account-email=$SERVICE_ACCOUNT \
  --python-requirements=gs://$STAGING_BUCKET/templates/requirements.txt \
  gs://$STAGING_BUCKET/templates/location_pipeline.py \
  --input_topic=projects/$PROJECT_ID/topics/incoming-location-data \
  --output_notifications_topic=projects/$PROJECT_ID/topics/notifications \
  --firestore_project=$PROJECT_ID \
  --firestore_database=location-db \
  --firestore_collection=locations
```

**Using Cloud Console:**

1. Go to Google Cloud Console → Dataflow
2. Create new job → Python
3. Upload `location_pipeline.py`
4. Set Python requirements file
5. Configure parameters
6. Submit

## Configuration Parameters

When deploying, provide these parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `input_topic` | Input Pub/Sub topic | `projects/proj-id/topics/incoming-location-data` |
| `output_notifications_topic` | Notifications output topic | `projects/proj-id/topics/notifications` |
| `firestore_project` | GCP project ID | `my-project-id` |
| `firestore_database` | Firestore database name | `location-db` |
| `firestore_collection` | Firestore collection name | `locations` |
| `window_duration` | Window duration in seconds | `300` (default) |

## Monitoring

### View Job Status

```bash
# List jobs
gcloud dataflow jobs list --region=europe-southwest1

# Get job ID
JOB_ID=$(gcloud dataflow jobs list --region=europe-southwest1 \
  --format="value(id)" --limit=1)

# View details
gcloud dataflow jobs describe $JOB_ID --region=europe-southwest1

# Stream logs
gcloud dataflow jobs log-messages $JOB_ID --region=europe-southwest1 | tail -50
```

### Check Output

```bash
# Notifications
gcloud pubsub subscriptions pull notifications-subscription \
  --limit=5 --auto-ack

# Processed locations
gcloud pubsub subscriptions pull processed-location-data-subscription \
  --limit=5 --auto-ack
```

### View Firestore Data

```bash
# Using Cloud Console:
# 1. Go to Firestore
# 2. Select database: location-db
# 3. View collection: locations

# Or using Firebase CLI:
firebase firestore:inspect locations --project=YOUR_PROJECT_ID
```

## Firestore Integration

### Firestore Structure

The pipeline stores location data in Firestore with this structure:

```
Database: location-db
  ↓
Collection: locations
  ↓
Document: {auto-generated ID}
  ├─ latitude: number
  ├─ longitude: number
  ├─ timestamp: number (milliseconds)
  └─ created_at: timestamp
```

### Example Firestore Document

```json
{
  "latitude": 40.7128,
  "longitude": -74.0060,
  "timestamp": 1706812800000,
  "created_at": "2024-02-01T10:00:00Z"
}
```

### Query Firestore Data (Client Code)

```python
from google.cloud import firestore

db = firestore.Client(database='location-db')

# Get recent locations
docs = db.collection('locations')\
  .order_by('timestamp', direction=firestore.Query.DESCENDING)\
  .limit(10)\
  .stream()

for doc in docs:
    location = doc.to_dict()
    print(f"Lat: {location['latitude']}, Lon: {location['longitude']}")

# Get locations by coordinate range
docs = db.collection('locations')\
  .where('latitude', '>=', 40)\
  .where('latitude', '<=', 41)\
  .where('longitude', '>=', -74)\
  .where('longitude', '<=', -73)\
  .stream()
```

## Testing

### Unit Tests

```bash
python -m pytest tests/ -v
```

### Integration Tests

```bash
# Start local Pub/Sub emulator (optional)
gcloud beta emulators pubsub start

# In another terminal, set environment
$(gcloud beta emulators pubsub env-init)

# Run pipeline with DirectRunner
python location_pipeline.py \
  --input_topic=projects/test-project/topics/incoming-location-data \
  --output_notifications_topic=projects/test-project/topics/notifications \
  --firestore_project=test-project \
  --firestore_database=location-db \
  --firestore_collection=locations \
  --runner=DirectRunner
```

## Development

### Add Custom Processing

Edit `location_pipeline.py` to add custom DoFn classes:

```python
class EnrichLocationFn(beam.DoFn):
    """Add additional data to locations."""

    def process(self, element: LocationData):
        # Add country lookup, distance calculation, etc.
        element.country = self._get_country(element.latitude, element.longitude)
        yield element

    def _get_country(self, lat: float, lon: float) -> str:
        # TODO: Implement reverse geocoding
        return "Unknown"
```

Then add to pipeline:

```python
locations = (
    locations
    | 'Enrich Location' >> beam.ParDo(EnrichLocationFn())
)
```

### Add Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /locations/{document=**} {
      // Only allow Dataflow service account to write
      allow create, update: if request.auth.uid == 'dataflow-runner';
      // Allow reading for authenticated users
      allow read: if request.auth != null;
    }
  }
}
```

## Performance Tuning

### Adjust Window Size

In pipeline arguments, change `window_duration`:

```bash
--window_duration=600  # 10 minutes instead of 5
```

### Autoscaling

```bash
gcloud dataflow jobs run location-streaming-pipeline \
  ... \
  --autoscaling_algorithm=THROUGHPUT_BASED \
  --max_num_workers=20
```

### Worker Type

```bash
--worker_machine_type=n1-standard-4  # More powerful workers
```

## Troubleshooting

### Import Errors

```bash
# Reinstall dependencies
pip install --upgrade -r requirements.txt

# Verify installation
python -c "import apache_beam; print(apache_beam.__version__)"
python -c "import google.cloud.firestore; print('Firestore OK')"
```

### Pub/Sub Connection Issues

```bash
# Verify topic exists
gcloud pubsub topics describe incoming-location-data

# Test publishing
gcloud pubsub topics publish incoming-location-data \
  --message '{"latitude": 0, "longitude": 0}'
```

### Firestore Connection Issues

```bash
# Check database status
gcloud firestore databases list

# Check IAM permissions
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --flatten="bindings[].members" \
  --filter="bindings.members:dataflow-runner"
```

### Dataflow Job Failures

```bash
# View detailed logs
gcloud dataflow jobs log-messages JOB_ID --region=europe-southwest1

# Common issues:
# - Missing IAM permissions
# - Incorrect Pub/Sub topic names
# - Firestore database not initialized
# - Invalid Python syntax
```

## Logging

Logs are sent to Cloud Logging. View them:

```bash
gcloud logging read "resource.type=dataflow_step" \
  --limit=50 \
  --format=json
```

## Cost Estimation

**Monthly cost for small deployments (streaming ~100k locations/day):**

- Dataflow: ~$30-50 (depends on workers)
- Pub/Sub: ~$15 (ingress/egress)
- Firestore: ~$5-20 (operations)
- **Total: ~$50-85/month**

**Note**: Firestore is significantly cheaper than Cloud SQL for write-heavy workloads!

## Advantages of Firestore

✅ **Simpler**: No schema management, automatic scaling
✅ **Cheaper**: Pay only for operations used
✅ **Faster**: Automatic indexing, real-time updates
✅ **More flexible**: Schema-less documents
✅ **Less ops**: Fully managed, no maintenance

## References

- [Apache Beam Python SDK](https://beam.apache.org/documentation/sdks/pydoc/current/)
- [Dataflow Python Documentation](https://cloud.google.com/dataflow/docs/concepts/unified-model/programming-your-pipeline)
- [Pub/Sub Python Client](https://cloud.google.com/python/docs/reference/pubsub/latest)
- [Firestore Python Client](https://cloud.google.com/python/docs/reference/firestore/latest)
- [Firestore Documentation](https://cloud.google.com/firestore/docs)

## License

Apache 2.0
