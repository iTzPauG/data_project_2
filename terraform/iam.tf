# Enable required APIs
resource "google_project_service" "dataflow" {
  service            = "dataflow.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "pubsub" {
  service            = "pubsub.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firestore" {
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "compute" {
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "storage" {
  service            = "storage-api.googleapis.com"
  disable_on_destroy = false
}

# Service Account for Dataflow
resource "google_service_account" "dataflow_runner" {
  account_id   = var.dataflow_service_account_name
  display_name = "Dataflow Runner Service Account"
  description  = "Service account for Dataflow streaming pipeline"
}

# IAM Role: Dataflow Worker
resource "google_project_iam_member" "dataflow_worker" {
  project = var.gcp_project_id
  role    = "roles/dataflow.worker"
  member  = "serviceAccount:${google_service_account.dataflow_runner.email}"

  depends_on = [google_project_service.dataflow]
}

# IAM Role: Pub/Sub Editor (for Dataflow to read/write to Pub/Sub)
resource "google_project_iam_member" "dataflow_worker_pubsub" {
  project = var.gcp_project_id
  role    = "roles/pubsub.editor"
  member  = "serviceAccount:${google_service_account.dataflow_runner.email}"

  depends_on = [google_project_service.pubsub]
}

# IAM Role: Firestore Database Editor (for Dataflow to write to Firestore)
resource "google_project_iam_member" "firestore_editor" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.dataflow_runner.email}"

  depends_on = [google_project_service.firestore]
}

# IAM Role: Storage Object Creator (for Dataflow to create temporary files)
resource "google_project_iam_member" "dataflow_worker_storage" {
  project = var.gcp_project_id
  role    = "roles/storage.objectCreator"
  member  = "serviceAccount:${google_service_account.dataflow_runner.email}"

  depends_on = [google_project_service.storage]
}

# IAM Role: Storage Object Viewer (for Dataflow to read files)
resource "google_project_iam_member" "dataflow_worker_storage_viewer" {
  project = var.gcp_project_id
  role    = "roles/storage.objectViewer"
  member  = "serviceAccount:${google_service_account.dataflow_runner.email}"

  depends_on = [google_project_service.storage]
}

# Output service account information
output "dataflow_service_account_email" {
  description = "Service account email for Dataflow"
  value       = google_service_account.dataflow_runner.email
}

output "dataflow_service_account_id" {
  description = "Service account ID for Dataflow"
  value       = google_service_account.dataflow_runner.unique_id
}
