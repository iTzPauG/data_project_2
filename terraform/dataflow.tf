# GCS bucket for Dataflow staging and templates
resource "google_storage_bucket" "dataflow_bucket" {
  name          = "${var.gcp_project_id}-dataflow-staging"
  location      = var.gcp_region
  force_destroy = true

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

# Package pipeline source code into a zip
data "archive_file" "pipeline_source" {
  type        = "zip"
  source_dir  = "${path.module}/../dataflow-pipeline"
  output_path = "${path.module}/../pipeline-source.zip"
}

# Upload pipeline source zip to GCS
resource "google_storage_bucket_object" "pipeline_source" {
  name   = "pipeline-source-${data.archive_file.pipeline_source.output_md5}.zip"
  bucket = google_storage_bucket.dataflow_bucket.name
  source = data.archive_file.pipeline_source.output_path
}

# Build the Flex Template Docker image via Cloud Build (same pattern as the API)
resource "terraform_data" "dataflow_image_build" {
  triggers_replace = [
    data.archive_file.pipeline_source.output_md5
  ]

  # Descomentar para Windows
  provisioner "local-exec" {
    # Igual aquí, quitamos las comillas escapadas
    command = "gcloud builds submit ../dataflow-pipeline --tag europe-west6-docker.pkg.dev/data-project-2-kids/docker-repo/location-pipeline:latest --project data-project-2-kids --quiet"
  }

  # Descomentar para Linux y Mac
  # provisioner "local-exec" {
  #   command = <<-EOT
  #     gcloud builds submit \
  #       "${path.module}/../dataflow-pipeline" \
  #       --tag "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/location-pipeline:latest" \
  #       --project "${var.gcp_project_id}" \
  #       --quiet
  #   EOT
  # }

  depends_on = [
    google_storage_bucket_object.pipeline_source,
    google_artifact_registry_repository.docker_repo,
    google_project_service.cloudbuild,
  ]
}

# Flex Template spec JSON — points Dataflow at the Docker image we just built.
# This replaces `gcloud dataflow flex-template build`; no local-exec needed.
resource "google_storage_bucket_object" "flex_template_spec" {
  name   = "templates/location-pipeline.json"
  bucket = google_storage_bucket.dataflow_bucket.name
  content = jsonencode({
    image    = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/location-pipeline:latest"
    metadata = jsondecode(file("${path.module}/../dataflow-pipeline/metadata.json"))
    sdkInfo = {
      language = "PYTHON"
    }
  })

  depends_on = [terraform_data.dataflow_image_build]
}

# Dataflow Flex Template job (streaming)
resource "google_dataflow_flex_template_job" "location_pipeline" {
  provider                = google-beta
  name                    = var.dataflow_job_name
  region                  = var.gcp_region
  container_spec_gcs_path = "gs://${google_storage_bucket.dataflow_bucket.name}/templates/location-pipeline.json"
  on_delete               = "cancel"
  service_account_email   = google_service_account.dataflow_runner.email

  parameters = {
    input_subscription         = "projects/${var.gcp_project_id}/subscriptions/${google_pubsub_subscription.incoming_location_subscription.name}"
    output_notifications_topic = "projects/${var.gcp_project_id}/topics/${var.notifications_topic_name}"
    project_id                 = var.gcp_project_id
    firestore_database         = var.firestore_database_name
    firestore_collection       = var.firestore_locations_collection
    zones_sql                  = var.firestore_locations_collection
    db_host                    = google_sql_database_instance.main.public_ip_address
    db_name                    = var.cloudsql_db_name
    db_user                    = var.cloudsql_user
    db_pass                    = random_password.cloudsql_password.result
    bq_dataset                 = google_bigquery_dataset.bqdataset.dataset_id
    bq_table                   = google_bigquery_table.table.table_id
    temp_location              = "gs://${google_storage_bucket.dataflow_temp.name}/tmp"
    staging_location           = "gs://${google_storage_bucket.dataflow_bucket.name}/staging"
  }

  depends_on = [
    google_storage_bucket_object.flex_template_spec,
    google_project_iam_member.dataflow_worker,
    google_project_iam_member.dataflow_developer,
    google_project_iam_member.dataflow_worker_pubsub,
    google_project_iam_member.dataflow_worker_bigquery,
    google_project_iam_member.dataflow_cloudsql_client,
    google_sql_database_instance.main,
    google_pubsub_topic.incoming_location_data,
    google_pubsub_subscription.incoming_location_subscription,
    google_pubsub_topic.notifications,
    google_bigquery_dataset.bqdataset,
    google_bigquery_table.table,
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