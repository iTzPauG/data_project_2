# Admin Panel

resource "google_service_account" "admin_panel_sa" {
  account_id   = "admin-panel"
  display_name = "Admin Panel Service Account"
}

# Firestore read access
resource "google_project_iam_member" "admin_panel_firestore_viewer" {
  project = var.gcp_project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# Cloud SQL access
resource "google_project_iam_member" "admin_panel_cloudsql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# BigQuery — read tables
resource "google_project_iam_member" "admin_panel_bq_data_viewer" {
  project = var.gcp_project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# BigQuery — run queries
resource "google_project_iam_member" "admin_panel_bq_job_user" {
  project = var.gcp_project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# Pub/Sub — pull from violations subscription
resource "google_project_iam_member" "admin_panel_pubsub_subscriber" {
  project = var.gcp_project_id
  role    = "roles/pubsub.subscriber"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# Pub/Sub subscription for admin zone violations feed
resource "google_pubsub_subscription" "admin_violations" {
  name  = "admin-violations-subscription"
  topic = google_pubsub_topic.notifications.name

  message_retention_duration = "86400s"
  ack_deadline_seconds       = 20
}

# Package admin source code
data "archive_file" "admin_source" {
  type        = "zip"
  source_dir  = "${path.module}/../admin"
  output_path = "${path.module}/../admin-source.zip"
}

# Upload admin source zip to GCS
resource "google_storage_bucket_object" "admin_source" {
  name   = "admin-source-${data.archive_file.admin_source.output_md5}.zip"
  bucket = google_storage_bucket.api_source.name
  source = data.archive_file.admin_source.output_path
}

# Build admin Docker image via Cloud Build
resource "terraform_data" "admin_image_build" {
  triggers_replace = [
    data.archive_file.admin_source.output_md5
  ]

  provisioner "local-exec" {
    command = "gcloud builds submit gs://${google_storage_bucket.api_source.name}/${google_storage_bucket_object.admin_source.name} --tag ${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/admin:latest --project ${var.gcp_project_id} --quiet"
  }

  depends_on = [
    google_storage_bucket_object.admin_source,
    google_artifact_registry_repository.docker_repo,
    google_project_service.cloudbuild,
  ]
}

# Cloud Run service for admin panel
resource "google_cloud_run_v2_service" "admin" {
  name                = "admin"
  location            = var.gcp_region
  deletion_protection = false

  template {
    annotations = {
      "force-update" = data.archive_file.admin_source.output_md5
    }

    service_account = google_service_account.admin_panel_sa.email

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = ["${var.gcp_project_id}:${var.gcp_region}:${var.cloudsql_instance_name}"]
      }
    }

    containers {
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/admin:latest"

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name  = "DB_HOST"
        value = "/cloudsql/${var.gcp_project_id}:${var.gcp_region}:${var.cloudsql_instance_name}"
      }
      env {
        name  = "DB_USER"
        value = var.cloudsql_user
      }
      env {
        name  = "DB_PASS"
        value = random_password.cloudsql_password.result
      }
      env {
        name  = "DB_NAME"
        value = var.cloudsql_db_name
      }
      env {
        name  = "ADMIN_SECRET_KEY"
        value = data.google_secret_manager_secret_version.admin_secret_key.secret_data
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = var.firestore_database_name
      }
      env {
        name  = "FIRESTORE_COLLECTION"
        value = var.firestore_locations_collection
      }
      env {
        name  = "BQ_PROJECT"
        value = var.gcp_project_id
      }
      env {
        name  = "BQ_DATASET"
        value = google_bigquery_dataset.bqdataset.dataset_id
      }
      env {
        name  = "BQ_TABLE"
        value = google_bigquery_table.table.table_id
      }
      env {
        name  = "NOTIFICATIONS_SUBSCRIPTION"
        value = google_pubsub_subscription.admin_violations.name
      }
    }
  }

  depends_on = [
    google_project_service.cloudrun,
    terraform_data.admin_image_build,
  ]
}

# Allow unauthenticated access to admin panel
resource "google_cloud_run_v2_service_iam_member" "admin_public_access" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.admin.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "admin_url" {
  description = "Admin panel URL"
  value       = google_cloud_run_v2_service.admin.uri
}
