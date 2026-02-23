# Firestore Database
resource "google_firestore_database" "location_db" {
  project     = var.gcp_project_id
  name        = var.firestore_database_name
  location_id = var.gcp_region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.firestore]
}

# Collection references (created automatically when first document is added)
# These outputs are for reference only

output "firestore_database" {
  description = "Firestore database information"
  value = {
    name       = google_firestore_database.location_db.name
    project    = google_firestore_database.location_db.project
    region     = google_firestore_database.location_db.location_id
    type       = google_firestore_database.location_db.type
  }
}

output "firestore_collections" {
  description = "Firestore collection names (created automatically)"
  value = {
    locations     = var.firestore_locations_collection
    metadata      = var.firestore_metadata_collection
    notifications = var.firestore_notifications_collection
  }
}

output "firestore_connection_info" {
  description = "Connection info for Dataflow to write to Firestore"
  value = {
    project_id = var.gcp_project_id
    database   = var.firestore_database_name
  }
}
