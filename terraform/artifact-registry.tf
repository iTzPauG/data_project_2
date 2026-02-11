# Enable Artifact Registry API
resource "google_project_service" "artifactregistry" {
  service            = "artifactregistry.googleapis.com"
  disable_on_destroy = false
}

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.gcp_region
  repository_id = "docker-repo"
  format        = "DOCKER"
  description   = "Docker repository for project images"

  labels = {
    environment = var.environment
  }

  depends_on = [google_project_service.artifactregistry]
}
