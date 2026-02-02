# GCS bucket for Dataflow staging and templates
resource "google_storage_bucket" "dataflow_bucket" {
  name          = "${var.gcp_project_id}-dataflow-staging"
  location      = var.gcp_region
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = {
    environment = var.environment
    purpose     = "dataflow-staging"
  }

  depends_on = [google_project_service.storage]
}

# Temp bucket for Dataflow processing
resource "google_storage_bucket" "dataflow_temp" {
  name          = "${var.gcp_project_id}-dataflow-temp"
  location      = var.gcp_region
  force_destroy = true

  uniform_bucket_level_access = true

  # Auto-delete objects older than 7 days
  lifecycle_rule {
    condition {
      num_newer_versions = 3
      age                = 7
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    purpose     = "dataflow-temp"
  }

  depends_on = [google_project_service.storage]
}

# Grant service account access to staging bucket
resource "google_storage_bucket_iam_member" "dataflow_staging_access" {
  bucket = google_storage_bucket.dataflow_bucket.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.dataflow_runner.email}"
}

# Grant service account access to temp bucket
resource "google_storage_bucket_iam_member" "dataflow_temp_access" {
  bucket = google_storage_bucket.dataflow_temp.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.dataflow_runner.email}"
}

# Note: The actual Dataflow job deployment requires:
# 1. Python Apache Beam pipeline files (location_pipeline.py)
# 2. Python requirements file (requirements.txt)
# 3. Upload both to the staging bucket
# 4. Then use gcloud CLI to deploy
#
# This can be done manually or through CI/CD pipeline
#
# Example deployment command:
# gcloud dataflow jobs run location-streaming-pipeline \
#   --region europe-southwest1 \
#   --staging-location gs://${gcp_project_id}-dataflow-staging/staging \
#   --temp-location gs://${gcp_project_id}-dataflow-temp \
#   --service-account-email ${dataflow_service_account_email} \
#   --python-requirements gs://${gcp_project_id}-dataflow-staging/templates/requirements.txt \
#   gs://${gcp_project_id}-dataflow-staging/templates/location_pipeline.py \
#   --input_topic projects/${gcp_project_id}/topics/incoming-location-data \
#   --output_notifications_topic projects/${gcp_project_id}/topics/notifications \
#   --output_location_topic projects/${gcp_project_id}/topics/processed-location-data \
#   --firestore_project ${gcp_project_id} \
#   --firestore_database ${firestore_database_name} \
#   --firestore_collection locations

# Outputs
output "dataflow_staging_bucket" {
  description = "GCS bucket for Dataflow staging"
  value       = google_storage_bucket.dataflow_bucket.name
}

output "dataflow_temp_bucket" {
  description = "GCS bucket for Dataflow temporary files"
  value       = google_storage_bucket.dataflow_temp.name
}

output "dataflow_region" {
  description = "Region for Dataflow jobs"
  value       = var.gcp_region
}

output "dataflow_config" {
  description = "Configuration values for Dataflow job deployment"
  value = {
    staging_location           = "gs://${google_storage_bucket.dataflow_bucket.name}/staging"
    temp_location              = "gs://${google_storage_bucket.dataflow_temp.name}"
    service_account_email      = google_service_account.dataflow_runner.email
    input_topic                = "projects/${var.gcp_project_id}/topics/${var.incoming_topic_name}"
    output_notifications_topic = "projects/${var.gcp_project_id}/topics/${var.notifications_topic_name}"
    output_location_topic      = "projects/${var.gcp_project_id}/topics/${var.location_data_topic_name}"
    firestore_project          = var.gcp_project_id
    firestore_database         = var.firestore_database_name
    firestore_collection       = var.firestore_locations_collection
    max_workers                = var.dataflow_max_workers
  }

  depends_on = [
    google_storage_bucket.dataflow_bucket,
    google_storage_bucket.dataflow_temp,
    google_service_account.dataflow_runner
  ]
}
