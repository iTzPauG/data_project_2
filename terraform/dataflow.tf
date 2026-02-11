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

# Upload pipeline files to GCS staging bucket
resource "google_storage_bucket_object" "pipeline_file" {
  name   = "templates/location_pipeline.py"
  source = "${path.module}/../dataflow-pipeline/location_pipeline.py"
  bucket = google_storage_bucket.dataflow_bucket.name
}

resource "google_storage_bucket_object" "pipeline_requirements" {
  name   = "templates/requirements.txt"
  source = "${path.module}/../dataflow-pipeline/requirements.txt"
  bucket = google_storage_bucket.dataflow_bucket.name
}

# Dataflow Flex Template job (streaming)
resource "google_dataflow_flex_template_job" "location_pipeline" {
  provider                = google-beta
  name                    = var.dataflow_job_name
  region                  = var.gcp_region
  container_spec_gcs_path = "gs://dataflow-templates-${var.gcp_region}/latest/flex/Python_Dataflow_Streaming"
  on_delete               = "cancel"
  service_account_email   = google_service_account.dataflow_runner.email

  parameters = {
    staging_location               = "gs://${google_storage_bucket.dataflow_bucket.name}/staging"
    temp_location                  = "gs://${google_storage_bucket.dataflow_temp.name}"
    input_topic                    = "projects/${var.gcp_project_id}/topics/${var.incoming_topic_name}"
    output_notifications_topic     = "projects/${var.gcp_project_id}/topics/${var.notifications_topic_name}"
    output_location_topic          = "projects/${var.gcp_project_id}/topics/${var.location_data_topic_name}"
    firestore_project              = var.gcp_project_id
    firestore_database             = var.firestore_database_name
    firestore_collection           = var.firestore_locations_collection
    max_num_workers                = tostring(var.dataflow_max_workers)
    requirements_file              = "gs://${google_storage_bucket.dataflow_bucket.name}/templates/requirements.txt"
    py_file                        = "gs://${google_storage_bucket.dataflow_bucket.name}/templates/location_pipeline.py"
  }

  depends_on = [
    google_storage_bucket_object.pipeline_file,
    google_storage_bucket_object.pipeline_requirements,
    google_project_iam_member.dataflow_worker,
    google_project_iam_member.dataflow_worker_pubsub,
    google_pubsub_topic.incoming_location_data,
    google_pubsub_topic.notifications,
    google_pubsub_topic.processed_location_data,
  ]
}

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
