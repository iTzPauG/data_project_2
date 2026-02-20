# ── Service Account ────────────────────────────────────────────────────────────
resource "google_service_account" "admin_panel_sa" {
  account_id   = "admin-panel-sa"
  display_name = "Service Account for Admin Panel Cloud Run"
}

# Cloud SQL access
resource "google_project_iam_member" "admin_panel_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# Firestore read access
resource "google_project_iam_member" "admin_panel_firestore_viewer" {
  project = var.gcp_project_id
  role    = "roles/datastore.viewer"
  member  = "serviceAccount:${google_service_account.admin_panel_sa.email}"
}

# ── Cloud Build — package & push admin image ───────────────────────────────────
resource "google_storage_bucket" "admin_source" {
  name          = "${var.gcp_project_id}-admin-source"
  location      = var.gcp_region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  depends_on = [google_project_service.storage]
}

data "archive_file" "admin_source" {
  type        = "zip"
  source_dir  = "${path.module}/../admin"
  output_path = "${path.module}/../admin-source.zip"
  excludes    = [".env", ".env.example"]
}

resource "google_storage_bucket_object" "admin_source" {
  name   = "admin-source-${data.archive_file.admin_source.output_md5}.zip"
  bucket = google_storage_bucket.admin_source.name
  source = data.archive_file.admin_source.output_path
}

resource "terraform_data" "admin_image_build" {
  triggers_replace = [
    data.archive_file.admin_source.output_md5
  ]

  provisioner "local-exec" {
    command = <<-EOT
      gcloud builds submit \
        "gs://${google_storage_bucket.admin_source.name}/${google_storage_bucket_object.admin_source.name}" \
        --tag "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/admin:latest" \
        --project "${var.gcp_project_id}" \
        --quiet
    EOT
  }

  depends_on = [
    google_storage_bucket_object.admin_source,
    google_artifact_registry_repository.docker_repo,
    google_project_service.cloudbuild,
  ]
}

# ── Cloud Run Service ──────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "admin" {
  name                = var.admin_cloud_run_service_name
  location            = var.gcp_region
  deletion_protection = false

  template {
    service_account = google_service_account.admin_panel_sa.email

    containers {
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/admin:latest"

      env {
        name  = "DB_HOST"
        value = google_sql_database_instance.main.public_ip_address
      }
      env {
        name  = "DB_USER"
        value = var.cloudsql_user
      }
      env {
        name  = "DB_PASS"
        value = var.cloudsql_password
      }
      env {
        name  = "DB_NAME"
        value = var.cloudsql_db_name
      }
      env {
        name  = "ADMIN_SECRET_KEY"
        value = var.admin_secret_key
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = var.firestore_database_name
      }
      env {
        name  = "FIRESTORE_COLLECTION"
        value = var.firestore_locations_collection
      }
    }
  }

  depends_on = [
    google_project_service.cloudrun,
    google_sql_database_instance.main,
    terraform_data.admin_image_build,
  ]
}

# Allow unauthenticated access (admin panel has its own login)
resource "google_cloud_run_v2_service_iam_member" "admin_public_access" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.admin.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "admin_panel_url" {
  description = "URL of the Admin Panel Cloud Run service"
  value       = google_cloud_run_v2_service.admin.uri
}
