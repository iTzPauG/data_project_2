# Enable Cloud Run API
resource "google_project_service" "cloudrun" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

# Service account for Cloud Run
resource "google_service_account" "cloud_run_sa" {
  account_id   = "cloud-run-api"
  display_name = "Cloud Run API Service Account"
  description  = "Service account for the Cloud Run API service"
}

# Grant Pub/Sub publisher role to Cloud Run SA
resource "google_project_iam_member" "cloud_run_pubsub_publisher" {
  project = var.gcp_project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# Cloud Run service
resource "google_cloud_run_v2_service" "api" {
  name                = var.cloud_run_service_name
  location            = var.gcp_region
  deletion_protection = false

  template {
    service_account = google_service_account.cloud_run_sa.email

    containers {
      image = "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/api:latest"

      env {
        name  = "GCP_PROJECT_ID"
        value = var.gcp_project_id
      }
      env {
        name  = "PUBSUB_LOCATION_TOPIC"
        value = google_pubsub_topic.incoming_location_data.name
      }
      env {
        name  = "PUBSUB_ZONE_TOPIC"
        value = google_pubsub_topic.incoming_zone_data.name
      }
    }
  }

  depends_on = [
    google_project_service.cloudrun,
    terraform_data.api_image_build,
  ]
}

# Allow unauthenticated access (public API)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count    = var.cloud_run_allow_unauthenticated ? 1 : 0
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
