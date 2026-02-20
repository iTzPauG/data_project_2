# Enable Cloud Build API
resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

# Enable Secret Manager API (for storing sensitive substitutions)
resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# =============================================================================
# CLOUD BUILD SERVICE ACCOUNT PERMISSIONS
# =============================================================================

# Get Cloud Build service account
data "google_project" "project" {
  project_id = var.gcp_project_id
}

# Grant Cloud Build SA permissions to deploy to Cloud Run
resource "google_project_iam_member" "cloudbuild_run_admin" {
  project = var.gcp_project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# Grant Cloud Build SA permissions to act as service account
resource "google_project_iam_member" "cloudbuild_sa_user" {
  project = var.gcp_project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# Grant Cloud Build SA permissions to push to Artifact Registry
resource "google_project_iam_member" "cloudbuild_artifact_registry" {
  project = var.gcp_project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# Grant Cloud Build SA permissions to run Dataflow jobs
resource "google_project_iam_member" "cloudbuild_dataflow_admin" {
  project = var.gcp_project_id
  role    = "roles/dataflow.admin"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# Grant Cloud Build SA permissions to access GCS buckets
resource "google_project_iam_member" "cloudbuild_storage_admin" {
  project = var.gcp_project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}

# =============================================================================
# GITHUB CONNECTION (Cloud Build v2 / 2nd Gen)
# =============================================================================

# GitHub connection - creates the OAuth connection to GitHub
# After terraform apply, you need to authorize the connection once via the link in outputs
resource "google_cloudbuildv2_connection" "github" {
  project  = var.gcp_project_id
  location = var.gcp_region
  name     = "github-connection"

  github_config {
    app_installation_id = var.github_app_installation_id
    authorizer_credential {
      oauth_token_secret_version = "projects/${var.gcp_project_id}/secrets/github-oauth-token/versions/latest"
    }
  }

  depends_on = [
    google_project_service.cloudbuild,
    google_secret_manager_secret_iam_member.cloudbuild_github_token_access,
  ]
}

# Link the specific repository to Cloud Build
resource "google_cloudbuildv2_repository" "main" {
  project           = var.gcp_project_id
  location          = var.gcp_region
  name              = var.github_repo_name
  parent_connection = google_cloudbuildv2_connection.github.name
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo_name}.git"
}

# =============================================================================
# CLOUD BUILD TRIGGER (2nd Gen with repository_event_config)
# =============================================================================

# Cloud Build trigger for GitHub pushes to main branch
resource "google_cloudbuild_trigger" "github_main" {
  name            = "github-main-trigger"
  description     = "Trigger on push to main branch - deploys API, Dataflow, and Cloud Functions"
  location        = var.gcp_region
  project         = var.gcp_project_id
  service_account = "projects/${var.gcp_project_id}/serviceAccounts/${data.google_project.project.number}@cloudbuild.gserviceaccount.com"

  repository_event_config {
    repository = google_cloudbuildv2_repository.main.id
    push {
      branch = "^main$"
    }
  }

  filename = "cloudbuild.yaml"

  substitutions = {
    _REGION                   = var.gcp_region
    _ARTIFACT_REGISTRY_REPO   = google_artifact_registry_repository.docker_repo.repository_id
    _DATAFLOW_BUCKET          = google_storage_bucket.dataflow_bucket.name
    _DATAFLOW_JOB_NAME        = var.dataflow_job_name
    _MAX_WORKERS              = tostring(var.dataflow_max_workers)
    _DATAFLOW_SERVICE_ACCOUNT = google_service_account.dataflow_runner.email
    _INPUT_SUBSCRIPTION       = google_pubsub_subscription.incoming_location_subscription.name
    _NOTIFICATIONS_TOPIC      = var.notifications_topic_name
    _FIRESTORE_DATABASE       = var.firestore_database_name
    _FIRESTORE_COLLECTION     = var.firestore_locations_collection
    _DB_HOST                  = google_sql_database_instance.main.public_ip_address
    _DB_NAME                  = var.cloudsql_db_name
    _DB_USER                  = var.cloudsql_user
    _DB_PASS                  = random_password.cloudsql_password.result
    _BQ_DATASET               = google_bigquery_dataset.bqdataset.dataset_id
    _BQ_TABLE                 = google_bigquery_table.table.table_id
    _CLOUDRUN_SERVICE_NAME    = "location-api"
    _LOCATION_TOPIC           = var.incoming_topic_name
    _ZONE_TOPIC               = var.zone_data_topic_name
    _USER_TOPIC               = var.user_data_topic_name
    _KIDS_TOPIC               = var.kids_data_topic_name
  }

  depends_on = [
    google_project_service.cloudbuild,
    google_artifact_registry_repository.docker_repo,
    google_storage_bucket.dataflow_bucket,
    google_cloudbuildv2_repository.main,
  ]
}

# =============================================================================
# API SOURCE CODE (for manual builds via Terraform)
# =============================================================================

# GCS bucket to store API source code
resource "google_storage_bucket" "api_source" {
  name          = "${var.gcp_project_id}-api-source"
  location      = var.gcp_region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = {
    environment = var.environment
    purpose     = "api-source"
  }

  depends_on = [google_project_service.storage]
}

# Package API source code into a zip
data "archive_file" "api_source" {
  type        = "zip"
  source_dir  = "${path.module}/../api"
  output_path = "${path.module}/../api-source.zip"
}

# Upload API source zip to GCS (new object on every code change via content hash in name)
resource "google_storage_bucket_object" "api_source" {
  name   = "api-source-${data.archive_file.api_source.output_md5}.zip"
  bucket = google_storage_bucket.api_source.name
  source = data.archive_file.api_source.output_path
}

# Submit Cloud Build job from the GCS source
resource "terraform_data" "api_image_build" {
  triggers_replace = [
    data.archive_file.api_source.output_md5
  ]

  # Descomentar para Windows
  provisioner "local-exec" {
    # Hemos quitado todas las \" porque en Windows confunden a gcloud si no hay espacios
    command = "gcloud builds submit gs://${google_storage_bucket.api_source.name}/${google_storage_bucket_object.api_source.name} --tag ${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/api:latest --project ${var.gcp_project_id} --quiet"
  }

  # Descomentar para Linux y Mac
  # provisioner "local-exec" {
  #   command = <<-EOT
  #     gcloud builds submit \
  #       "gs://${google_storage_bucket.api_source.name}/${google_storage_bucket_object.api_source.name}" \
  #       --tag "${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/api:latest" \
  #       --project "${var.gcp_project_id}" \
  #       --quiet
  #   EOT
  # }

  depends_on = [
    google_storage_bucket_object.api_source,
    google_artifact_registry_repository.docker_repo,
    google_project_service.cloudbuild,
  ]
}

# =============================================================================
# FRONTEND SOURCE CODE (for manual builds via Terraform)
# =============================================================================

# Package frontend source code into a zip
data "archive_file" "frontend_source" {
  type        = "zip"
  source_dir  = "${path.module}/../frontend"
  output_path = "${path.module}/../frontend-source.zip"
}

# Upload frontend source zip to GCS (new object on every code change via content hash in name)
resource "google_storage_bucket_object" "frontend_source" {
  name   = "frontend-source-${data.archive_file.frontend_source.output_md5}.zip"
  bucket = google_storage_bucket.api_source.name
  source = data.archive_file.frontend_source.output_path
}

# Submit Cloud Build job from the GCS source
resource "terraform_data" "frontend_image_build" {
  triggers_replace = [
    data.archive_file.frontend_source.output_md5
  ]

  provisioner "local-exec" {
    command = "gcloud builds submit gs://${google_storage_bucket.api_source.name}/${google_storage_bucket_object.frontend_source.name} --config=${path.module}/../frontend/cloudbuild.yaml --substitutions=_VITE_API_URL=${google_cloud_run_v2_service.api.uri},_VITE_MAPBOX_TOKEN=${var.mapbox_token},_VITE_WS_URL=${var.vite_ws_url},_IMAGE_TAG=${var.gcp_region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/frontend:latest --project ${var.gcp_project_id} --quiet"
  }

  depends_on = [
    google_storage_bucket_object.frontend_source,
    google_artifact_registry_repository.docker_repo,
    google_project_service.cloudbuild,
    google_cloud_run_v2_service.api,
  ]
}

resource "google_secret_manager_secret" "github_oauth_token" {
  secret_id = "github-oauth-token"
  replication {
    auto {}
  }
}

data "google_secret_manager_secret_version" "github_oauth_token" {
  secret  = google_secret_manager_secret.github_oauth_token.id
  version = "latest"
}

resource "google_secret_manager_secret_version" "github_oauth_token_version" {
  secret      = google_secret_manager_secret.github_oauth_token.id
  secret_data = data.google_secret_manager_secret_version.github_oauth_token.secret_data

  lifecycle {
    ignore_changes = [secret_data]
  }
}

resource "google_secret_manager_secret_iam_member" "cloudbuild_github_token_access" {
  secret_id = "github-oauth-token"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-787549761080@gcp-sa-cloudbuild.iam.gserviceaccount.com"
  depends_on = [
    google_secret_manager_secret.github_oauth_token
  ]
}
