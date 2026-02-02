# Terraform Infrastructure - Location Data Pipeline

Infrastructure as Code for Google Cloud Dataflow, Pub/Sub, and Firestore using Terraform.

## Overview

This Terraform configuration creates and manages all cloud infrastructure needed for the location data streaming pipeline:

```
┌─────────────────────────────────────────────────────┐
│              GCP Infrastructure                     │
│                                                     │
│  Pub/Sub Topics & Subscriptions                    │
│  ├─ incoming-location-data (7-day retention)       │
│  ├─ notifications                                   │
│  └─ processed-location-data                        │
│           ↓                                         │
│  Service Account: dataflow-runner                  │
│  ├─ roles/dataflow.worker                          │
│  ├─ roles/pubsub.editor                            │
│  └─ roles/datastore.user                           │
│           ↓                                         │
│  Storage (GCS)                                     │
│  ├─ {project-id}-dataflow-staging                  │
│  └─ {project-id}-dataflow-temp                     │
│           ↓                                         │
│  Firestore                                          │
│  └─ location-db (FIRESTORE_NATIVE)                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Architecture Components

### Pub/Sub
- **Topics**: 3 topics for incoming data, notifications, and processed locations
- **Subscriptions**: Push subscriptions for each topic with 60-second ack deadline
- **Message Retention**: 7 days for incoming data, default for others
- **Use Case**: Message broker between data sources and Dataflow pipeline

### Firestore
- **Database**: FIRESTORE_NATIVE mode (native Firestore, not Datastore)
- **Region**: europe-southwest1
- **Collections**: locations (auto-created on first write), metadata
- **Scaling**: Automatic horizontal and vertical scaling
- **Pricing**: Pay per operation (read/write/delete)
- **Advantages**: Serverless, schema-less, real-time capable

### Dataflow
- **Service Account**: Dedicated service account with minimal permissions
- **GCS Buckets**: Staging (templates) and temporary (processing)
- **Runner**: Google Cloud Dataflow managed service
- **Region**: europe-southwest1
- **Auto-scaling**: Enabled with configurable max workers

### IAM & Security
- Service account with principle of least privilege
- Minimal required IAM roles:
  - `roles/dataflow.worker` - Run Dataflow jobs
  - `roles/pubsub.editor` - Read/write Pub/Sub
  - `roles/datastore.user` - Access Firestore
  - `roles/storage.objectCreator/Viewer` - GCS operations

## File Structure

```
terraform/
├── main.tf              # Provider configuration and Terraform settings
├── variables.tf         # Input variable definitions
├── terraform.tfvars     # Variable values (YOUR CONFIGURATION)
├── firestore.tf         # Firestore database
├── pubsub.tf            # Pub/Sub topics and subscriptions
├── dataflow.tf          # Dataflow staging buckets and configuration
├── iam.tf               # Service accounts and IAM roles
├── outputs.tf           # Output values for reference
└── README.md            # This file
```

## Prerequisites

- **Terraform**: v1.0 or later
- **Google Cloud SDK**: `gcloud` CLI installed and configured
- **GCP Account**: Active project with billing enabled
- **Permissions**: Project Editor role or equivalent

### Enable Required APIs

Before deploying, ensure these APIs are enabled:

```bash
gcloud services enable dataflow.googleapis.com
gcloud services enable pubsub.googleapis.com
gcloud services enable firestore.googleapis.com
gcloud services enable compute.googleapis.com
gcloud services enable storage-api.googleapis.com
```

Or Terraform will enable them automatically via the `iam.tf` configuration.

## Quick Start

### Step 1: Update Configuration Files

#### Edit `terraform.tfvars`

```hcl
gcp_project_id = "your-actual-project-id"  # REQUIRED: Change this
gcp_region     = "europe-southwest1"
environment    = "prod"

# Firestore Configuration
firestore_database_name        = "location-db"
firestore_locations_collection = "locations"
firestore_metadata_collection  = "metadata"

# Pub/Sub Configuration
incoming_topic_name      = "incoming-location-data"
message_retention_days   = 7
notifications_topic_name = "notifications"
location_data_topic_name = "processed-location-data"

# Dataflow Configuration
dataflow_max_workers = 10
```

#### Edit `main.tf` Backend

Update the GCS backend bucket name:

```hcl
backend "gcs" {
  bucket = "your-actual-project-id-terraform-state"  # Change this
  prefix = "dataflow-pubsub"
}
```

### Step 2: Initialize Terraform

```bash
terraform init
```

This will:
- Download required providers (Google provider v6.0+)
- Create the backend GCS bucket (if using `-reconfigure`)
- Set up Terraform state management

### Step 3: Verify Configuration

```bash
# Validate syntax
terraform validate

# Show what will be created
terraform plan
```

Review the plan carefully. It should show approximately:
- 1 Firestore database
- 3 Pub/Sub topics + 3 subscriptions
- 1 Service account + 5 IAM role bindings
- 2 GCS buckets
- 5 Google Cloud API enablements

### Step 4: Deploy Infrastructure

```bash
# Apply the configuration
terraform apply
```

Type `yes` when prompted. Deployment typically takes 3-5 minutes.

### Step 5: Save Outputs

```bash
# View all outputs
terraform output

# Save to file for reference
terraform output > outputs.txt

# Get specific values
terraform output firestore_database_name
terraform output dataflow_service_account_email
```

**Important Outputs:**
- `firestore_database_name` - Firestore database name
- `dataflow_service_account_email` - Service account email for pipeline deployment
- `dataflow_staging_bucket` - GCS bucket for pipeline files
- `pubsub_topics` - All topic and subscription names

## Configuration Variables

### Main Variables (`terraform.tfvars`)

| Variable | Default | Description |
|----------|---------|-------------|
| `gcp_project_id` | `your-project-id` | Your GCP project ID (REQUIRED) |
| `gcp_region` | `europe-southwest1` | GCP region for all resources |
| `environment` | `prod` | Environment label (prod/staging/dev) |

### Pub/Sub Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `incoming_topic_name` | `incoming-location-data` | Topic for incoming location data |
| `message_retention_days` | `7` | Message retention period in days |
| `notifications_topic_name` | `notifications` | Topic for processing notifications |
| `location_data_topic_name` | `processed-location-data` | Topic for processed locations |

### Firestore Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `firestore_database_name` | `location-db` | Firestore database name |
| `firestore_locations_collection` | `locations` | Collection for location data |
| `firestore_metadata_collection` | `metadata` | Collection for metadata |

### Dataflow Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `dataflow_max_workers` | `10` | Maximum number of Dataflow workers |
| `dataflow_service_account_name` | `dataflow-runner` | Service account name |

## Deployed Resources

### Pub/Sub
- **Topic**: `incoming-location-data` (7-day message retention)
- **Topic**: `notifications`
- **Topic**: `processed-location-data`
- **Subscriptions**: One per topic with 60-second ack deadline

### Firestore
- **Database ID**: `location-db` in region `europe-southwest1`
- **Type**: FIRESTORE_NATIVE
- **Collections**: `locations`, `metadata` (auto-created on first write)

### Service Account
- **Email**: `dataflow-runner@{project-id}.iam.gserviceaccount.com`
- **Roles**:
  - `roles/dataflow.worker` - Run Dataflow jobs
  - `roles/pubsub.editor` - Pub/Sub read/write
  - `roles/datastore.user` - Firestore access
  - `roles/storage.objectCreator` - Create GCS objects
  - `roles/storage.objectViewer` - Read GCS objects

### Cloud Storage
- **Staging Bucket**: `{project-id}-dataflow-staging`
  - Purpose: Store pipeline code and templates
  - Versioning: Enabled

- **Temp Bucket**: `{project-id}-dataflow-temp`
  - Purpose: Temporary files during processing
  - Lifecycle: Auto-delete after 7 days

## Common Tasks

### View Current State

```bash
# List all managed resources
terraform state list

# Show specific resource details
terraform state show google_firestore_database.location_db
terraform state show google_pubsub_topic.incoming_location_data
```

### Update Configuration

```bash
# Edit variables
nano terraform.tfvars

# Preview changes
terraform plan

# Apply changes
terraform apply
```

### Modify Resource Counts

```bash
# Scale Dataflow workers
terraform apply -var="dataflow_max_workers=20"

# Change message retention
terraform apply -var="message_retention_days=14"
```

### Destroy Resources

```bash
# Preview what will be deleted
terraform plan -destroy

# Destroy all resources
terraform destroy

# Destroy specific resource
terraform destroy -target=google_pubsub_topic.notifications
```

## Outputs

After successful `terraform apply`, save and review:

```bash
# All outputs
terraform output

# Formatted JSON
terraform output -json > outputs.json

# Specific outputs
terraform output firestore_database_name
terraform output dataflow_config
```

**Key Output Structure:**

```json
{
  "firestore_database_name": "location-db",
  "dataflow_service_account_email": "dataflow-runner@project-id.iam.gserviceaccount.com",
  "dataflow_staging_bucket": "project-id-dataflow-staging",
  "pubsub_topics": {
    "incoming_location": {
      "topic": "incoming-location-data",
      "subscription": "incoming-location-data-subscription"
    },
    "notifications": { ... },
    "processed_location": { ... }
  }
}
```

## Cost Optimization

### Development Environment

```hcl
# Minimal resources
environment           = "dev"
dataflow_max_workers  = 2          # Fewer workers
message_retention_days = 1         # Shorter retention
```

**Estimated Cost**: ~$30-40/month

### Production Environment

```hcl
# Optimized for reliability
environment            = "prod"
dataflow_max_workers   = 20        # More workers for throughput
message_retention_days = 7         # Full retention
```

**Estimated Cost**: ~$50-85/month

### Cost Breakdown (100k locations/day)

| Service | Monthly Cost |
|---------|--------------|
| Dataflow | $30-50 (varies with workers) |
| Pub/Sub | ~$15 (ingress/egress) |
| Firestore | $5-20 (operations) |
| Cloud Storage | ~$1-2 |
| **Total** | **~$50-85** |

**Firestore Advantages**: No fixed instance costs like Cloud SQL

## Troubleshooting

### Terraform Validation Fails

```bash
# Check syntax
terraform validate

# Format files correctly
terraform fmt -recursive

# Enable debug logging
TF_LOG=DEBUG terraform plan
```

### State Bucket Already Exists

```bash
# If bucket exists from previous deployment
terraform init -reconfigure

# Or use existing bucket with different prefix
# Edit main.tf and change prefix value
```

### Permission Denied Errors

```bash
# Verify your GCP user has required roles
gcloud projects get-iam-policy $(gcloud config get-value project)

# Check you have Editor role or:
# - Dataflow Admin
# - Pub/Sub Admin
# - Firestore Admin
# - Storage Admin
```

### API Not Enabled

```bash
# Terraform will enable APIs automatically
# If needed, manually enable:
gcloud services enable dataflow.googleapis.com
gcloud services enable firestore.googleapis.com
```

### Firestore Database Creation Issues

```bash
# Check existing databases
gcloud firestore databases list

# Verify region support
# europe-southwest1 is a valid region for Firestore
```

## Verification & Testing

### Verify Pub/Sub Topics

```bash
# List topics
gcloud pubsub topics list

# Check topic details
gcloud pubsub topics describe incoming-location-data
```

### Verify Firestore

```bash
# List databases
gcloud firestore databases list

# Describe database
gcloud firestore databases describe location-db
```

### Verify Service Account

```bash
# List service accounts
gcloud iam service-accounts list

# Check roles
gcloud projects get-iam-policy $(gcloud config get-value project) \
  --flatten="bindings[].members" \
  --filter="bindings.members:dataflow-runner*"
```

### Verify GCS Buckets

```bash
# List buckets
gsutil ls

# Check bucket contents
gsutil ls gs://{project-id}-dataflow-staging/
gsutil ls gs://{project-id}-dataflow-temp/
```

## Advanced Configuration

### Use Workspaces (Multiple Environments)

```bash
# Create workspaces
terraform workspace new staging
terraform workspace new prod

# List workspaces
terraform workspace list

# Switch and deploy different configs
terraform workspace select staging
terraform apply -var-file="staging.tfvars"

terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Custom Variables File

Create environment-specific files:

```bash
# development.tfvars
gcp_project_id = "my-dev-project"
environment = "dev"
dataflow_max_workers = 2

# production.tfvars
gcp_project_id = "my-prod-project"
environment = "prod"
dataflow_max_workers = 20
```

Deploy with:

```bash
terraform apply -var-file="development.tfvars"
```

### Remote State Management

State is automatically stored in GCS bucket. Backup:

```bash
# Backup state file
gsutil cp gs://your-project-id-terraform-state/dataflow-pubsub/default.tfstate ./backup.tfstate

# List state versions
gsutil versioning get gs://your-project-id-terraform-state/

# Restore from backup
gsutil cp ./backup.tfstate gs://your-project-id-terraform-state/dataflow-pubsub/default.tfstate
```

## Security Best Practices

### Sensitive Data

Never commit sensitive data to Git:

```bash
# Don't commit terraform.tfvars if it contains secrets
# Use environment variables instead:
export TF_VAR_firestore_database_name="location-db"

# Or use .tfvars.secret (add to .gitignore)
```

### State File Security

```bash
# Enable versioning on state bucket
gsutil versioning set on gs://your-project-id-terraform-state/

# Restrict bucket access
gsutil iam ch serviceAccount:terraform@project.iam.gserviceaccount.com:objectAdmin \
  gs://your-project-id-terraform-state/
```

### IAM Principle of Least Privilege

Service account has only required permissions:
- ✅ Dataflow operations
- ✅ Pub/Sub access
- ✅ Firestore operations
- ✅ GCS storage operations

### Audit Logging

Enable audit logs for compliance:

```bash
gcloud logging sinks create terraform-logs logging.googleapis.com/projects/PROJECT/logs \
  --log-filter='protoPayload.methodName=~"storage.buckets.*"'
```

## Maintenance

### Update Providers

```bash
# Check for updates
terraform init -upgrade

# Review changes
terraform plan

# Apply updates
terraform apply
```

### Refresh State

```bash
# Sync local state with cloud
terraform refresh

# Or just plan (which refreshes automatically)
terraform plan
```

### Backup State

```bash
# Automated daily backups in GCS versioning
# Manual backup
terraform state pull > terraform.state.backup

# Manual restore if needed
terraform state push terraform.state.backup
```

## Cleanup

### Destroy All Resources

```bash
# Preview destruction
terraform plan -destroy

# Destroy
terraform destroy

# Confirm by typing 'yes'
```

### Keep State, Remove Some Resources

```bash
# Remove specific resource from state
terraform state rm google_pubsub_topic.notifications

# Destroy specific resource
terraform destroy -target=google_pubsub_topic.notifications
```

## References

- [Terraform Documentation](https://www.terraform.io/docs)
- [Google Terraform Provider](https://registry.terraform.io/providers/hashicorp/google/latest)
- [Pub/Sub Terraform Resources](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic)
- [Firestore Terraform Resources](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firestore_database)
- [Cloud Dataflow Documentation](https://cloud.google.com/dataflow/docs)

## Support & Issues

For issues:
1. Check Terraform logs: `TF_LOG=DEBUG terraform plan`
2. Verify GCP permissions: `gcloud projects get-iam-policy YOUR_PROJECT_ID`
3. Check GCP quotas: Google Cloud Console → APIs & Services → Quotas
4. Review Terraform state: `terraform state list` and `terraform state show`

## License

Apache 2.0

---

**Last Updated**: February 2, 2024
**Terraform Version**: v1.0+
**Google Provider**: v6.0+
**Region**: europe-southwest1
