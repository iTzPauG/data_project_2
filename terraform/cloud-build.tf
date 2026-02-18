# Enable Cloud Build API
resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

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
