# Location Data Pipeline - GCP Project

Complete streaming data pipeline for processing location data using Google Cloud Platform, Apache Beam, Pub/Sub, and Firestore.

## Project Overview

This project implements a real-time location data processing pipeline that:
- Receives location data (latitude/longitude) via Pub/Sub
- Processes streaming data using Apache Beam on Cloud Dataflow
- Stores results in Firestore (NoSQL database)
- Publishes notifications and processed data to separate Pub/Sub topics

```
┌─────────────────────────────────────────────────────────┐
│                   LOCATION DATA PIPELINE                │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  Pub/Sub Topic                                          │
│  (incoming-location-data)                               │
│           ↓                                              │
│  ┌───────────────────────────────────────┐             │
│  │  Cloud Dataflow                       │             │
│  │  (Python Apache Beam Pipeline)        │             │
│  └───────────────────────────────────────┘             │
│       ↓ ↓ ↓                                              │
│  ┌─────────────┐  ┌──────────────────────┐             │
│  │ Firestore   │  │  Pub/Sub Topics      │             │
│  │ (NoSQL DB)  │  │ - notifications      │             │
│  │ locations   │  │ - processed-data     │             │
│  └─────────────┘  └──────────────────────┘             │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

- **Infrastructure as Code**: Terraform
- **Message Queue**: Google Cloud Pub/Sub
- **Streaming Processing**: Apache Beam + Cloud Dataflow
- **Database**: Firestore (NoSQL)
- **Language**: Python 3.8+
- **Region**: europe-southwest1

## Project Structure

```
data_project_2/
├── README.md                    # This file - Project overview
├── SETUP.md                     # Detailed setup instructions
├── QUICKREF.md                  # Quick command reference
├── .gitignore                   # Git ignore rules
├── deploy.sh                    # Automated deployment script
│
├── terraform/                   # Infrastructure as Code
│   ├── README.md               # Terraform documentation
│   ├── main.tf                 # Provider & backend configuration
│   ├── variables.tf            # Variable definitions
│   ├── terraform.tfvars        # Configuration values (UPDATE THIS)
│   ├── firestore.tf            # Firestore database
│   ├── pubsub.tf               # Pub/Sub topics & subscriptions
│   ├── dataflow.tf             # Dataflow staging & config
│   ├── iam.tf                  # Service accounts & IAM roles
│   └── outputs.tf              # Output values
│
├── dataflow-pipeline/          # Apache Beam Pipeline
│   ├── README.md               # Pipeline documentation
│   ├── location_pipeline.py    # Main pipeline code
│   ├── requirements.txt        # Python dependencies
│   └── setup.py                # Package configuration
│
└── randomtracker/              # Existing project
```

## Quick Start

### 1. Prerequisites

Ensure you have:
- **Google Cloud SDK** (`gcloud` CLI)
- **Terraform** v1.0+
- **Python** 3.8+
- **Active GCP project** with billing enabled

### 2. Clone and Navigate

```bash
cd data_project_2
```

### 3. Configure Terraform

Edit `terraform/terraform.tfvars`:
```hcl
gcp_project_id = "your-actual-project-id"  # IMPORTANT: Change this
gcp_region     = "europe-southwest1"
```

Also update `terraform/main.tf` backend:
```hcl
backend "gcs" {
  bucket = "your-actual-project-id-terraform-state"
  prefix = "dataflow-pubsub"
}
```

### 4. Deploy Infrastructure

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

Save outputs:
```bash
terraform output > outputs.txt
```

### 5. Deploy Dataflow Pipeline

```bash
cd ../dataflow-pipeline
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Upload to GCS
BUCKET=$(gcloud config get-value project)-dataflow-staging
gsutil cp location_pipeline.py gs://$BUCKET/templates/
gsutil cp requirements.txt gs://$BUCKET/templates/

# Deploy to Dataflow
PROJECT_ID=$(gcloud config get-value project)
gcloud dataflow jobs run location-streaming-pipeline \
  --region=europe-southwest1 \
  --staging-location=gs://$BUCKET/staging \
  --temp-location=gs://$BUCKET-temp \
  --service-account-email=$(terraform output -raw dataflow_service_account_email) \
  --python-requirements=gs://$BUCKET/templates/requirements.txt \
  gs://$BUCKET/templates/location_pipeline.py \
  --input_topic=projects/$PROJECT_ID/topics/incoming-location-data \
  --output_notifications_topic=projects/$PROJECT_ID/topics/notifications \
  --output_location_topic=projects/$PROJECT_ID/topics/processed-location-data \
  --firestore_project=$PROJECT_ID \
  --firestore_database=location-db \
  --firestore_collection=locations
```

## Key Components

### Pub/Sub Topics

| Topic | Purpose | Retention |
|-------|---------|-----------|
| `incoming-location-data` | Input locations (lat/lon JSON) | 7 days |
| `notifications` | Processing notifications | Default |
| `processed-location-data` | Output processed locations | Default |

### Firestore Database

- **Database**: `location-db`
- **Collections**: `locations`, `metadata`
- **Document Structure**:
  ```json
  {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "timestamp": 1706812800000,
    "created_at": "2024-02-01T10:00:00Z"
  }
  ```

### Dataflow Pipeline

- **Language**: Python (Apache Beam)
- **Runner**: Cloud Dataflow
- **Region**: europe-southwest1
- **Auto-scaling**: Yes
- **Service Account**: `dataflow-runner@{project-id}.iam.gserviceaccount.com`

## Development

### Local Testing

Test pipeline locally with DirectRunner:

```bash
cd dataflow-pipeline
python location_pipeline.py \
  --input_topic=projects/YOUR_PROJECT/topics/incoming-location-data \
  --output_notifications_topic=projects/YOUR_PROJECT/topics/notifications \
  --output_location_topic=projects/YOUR_PROJECT/topics/processed-location-data \
  --firestore_project=YOUR_PROJECT \
  --firestore_database=location-db \
  --firestore_collection=locations \
  --runner=DirectRunner
```

### Send Test Data

```bash
gcloud pubsub topics publish incoming-location-data \
  --message '{"latitude": 40.7128, "longitude": -74.0060}'
```

### Monitor Pipeline

```bash
# List Dataflow jobs
gcloud dataflow jobs list --region=europe-southwest1

# Get logs
JOB_ID=$(gcloud dataflow jobs list --region=europe-southwest1 --format="value(id)" --limit=1)
gcloud dataflow jobs log-messages $JOB_ID --region=europe-southwest1 | tail -50
```

## Infrastructure Costs

**Estimated Monthly Costs** (100k locations/day):
- Dataflow: $30-50 (varies with workers)
- Pub/Sub: $15 (ingress/egress)
- Firestore: $5-20 (operations)
- **Total: ~$50-85/month**

**Cost Benefits**:
- ✅ Firestore: No fixed instance costs (vs Cloud SQL)
- ✅ Dataflow: Auto-scales based on throughput
- ✅ Pub/Sub: Simple, predictable pricing

## Key Features

### Firestore Advantages
- ✅ **Serverless**: No infrastructure management
- ✅ **Scalable**: Auto-scales with demand
- ✅ **Cost-effective**: Pay per operation
- ✅ **Real-time**: Built for streaming data
- ✅ **Flexible**: Schema-less documents

### Pipeline Features
- ✅ **Streaming Processing**: Real-time data handling
- ✅ **Data Validation**: Coordinate validation (lat/lon)
- ✅ **Auto-scaling**: Dataflow scales automatically
- ✅ **High Availability**: Managed by Google Cloud
- ✅ **Monitoring**: Cloud Logging integration

## Security

### Best Practices Implemented
- ✅ Service accounts with minimal permissions
- ✅ Sensitive variables in environment/tfvars
- ✅ IAM roles for Dataflow, Pub/Sub, Firestore
- ✅ State file in GCS with versioning
- ✅ No hardcoded credentials

### Before Production
- [ ] Enable Firestore security rules
- [ ] Restrict Pub/Sub authorized networks
- [ ] Enable VPC Service Controls
- [ ] Set up Cloud Monitoring alerts
- [ ] Enable audit logging

## Troubleshooting

### Terraform Issues
```bash
# Validate configuration
terraform validate

# Check state
terraform state list
terraform state show google_pubsub_topic.incoming_location_data

# Debug with logs
TF_LOG=DEBUG terraform plan
```

### Firestore Issues
```bash
# Check database status
gcloud firestore databases list
gcloud firestore databases describe location-db

# Check IAM permissions
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --filter="bindings.members:dataflow-runner"
```

### Dataflow Issues
```bash
# View job details
gcloud dataflow jobs describe JOB_ID --region=europe-southwest1

# View logs
gcloud logging read "resource.type=dataflow_step" --limit=50 --format=json

# Common issues:
# - Missing IAM permissions
# - Incorrect topic names
# - Firestore database not initialized
```

## Documentation

- **[SETUP.md](SETUP.md)** - Comprehensive setup guide with all options
- **[QUICKREF.md](QUICKREF.md)** - Quick command reference
- **[terraform/README.md](terraform/README.md)** - Terraform infrastructure documentation
- **[dataflow-pipeline/README.md](dataflow-pipeline/README.md)** - Apache Beam pipeline documentation

## Common Tasks

### Redeploy Pipeline
```bash
cd dataflow-pipeline
python location_pipeline.py ... --runner=DataflowRunner
```

### Query Firestore Data
```python
from google.cloud import firestore

db = firestore.Client(database='location-db')
docs = db.collection('locations')\
  .order_by('timestamp', direction=firestore.Query.DESCENDING)\
  .limit(10)\
  .stream()

for doc in docs:
    print(doc.to_dict())
```

### Destroy Infrastructure
```bash
cd terraform
terraform destroy
```

### Monitor Costs
```bash
# View Cloud Billing
gcloud billing accounts list
gcloud billing projects list

# Or check Google Cloud Console:
# Billing → My Projects → Select project → Overview
```

## Contributing

When modifying the pipeline:
1. Update `dataflow-pipeline/location_pipeline.py`
2. Test locally with DirectRunner
3. Update `requirements.txt` if adding dependencies
4. Bump version in `setup.py`
5. Deploy to Dataflow

When modifying infrastructure:
1. Update Terraform files
2. Run `terraform plan` to review changes
3. Run `terraform apply` to deploy
4. Update documentation

## Deployment Checklist

- [ ] GCP project created and APIs enabled
- [ ] gcloud authenticated: `gcloud auth login`
- [ ] Project configured: `gcloud config set project YOUR_PROJECT_ID`
- [ ] Terraform variables updated
- [ ] Terraform backend bucket created
- [ ] Infrastructure deployed: `terraform apply`
- [ ] Firestore database initialized
- [ ] Dataflow job deployed
- [ ] Test data published to Pub/Sub
- [ ] Data verified in Firestore
- [ ] Monitoring and alerts configured

## Support & Resources

### GCP Documentation
- [Cloud Dataflow](https://cloud.google.com/dataflow/docs)
- [Cloud Pub/Sub](https://cloud.google.com/pubsub/docs)
- [Cloud Firestore](https://cloud.google.com/firestore/docs)
- [Terraform Google Provider](https://registry.terraform.io/providers/hashicorp/google/)

### Apache Beam
- [Apache Beam Python SDK](https://beam.apache.org/documentation/sdks/pydoc/current/)
- [Beam Programming Guide](https://beam.apache.org/documentation/programming-guide/)

### Related Topics
- [Streaming Data with Google Cloud](https://cloud.google.com/architecture/build-a-streaming-analytics-system)
- [Real-time Data Processing Patterns](https://cloud.google.com/architecture/patterns)

## License

Apache 2.0

## Project Status

- ✅ Terraform Infrastructure (Firestore)
- ✅ Python Dataflow Pipeline
- ✅ Pub/Sub Integration
- ✅ Documentation
- ⏳ Production Hardening (security rules, monitoring)
- ⏳ CI/CD Pipeline (automated deployments)

---

**Last Updated**: February 2, 2024
**Region**: europe-southwest1
**Database**: Firestore (NoSQL)
