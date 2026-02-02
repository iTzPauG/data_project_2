output "project_id" {
  description = "GCP Project ID"
  value       = var.gcp_project_id
}

output "region" {
  description = "GCP Region"
  value       = var.gcp_region
}

# Pub/Sub Outputs
output "incoming_location_topic" {
  description = "Incoming location data topic name"
  value       = google_pubsub_topic.incoming_location_data.name
}

output "notifications_topic" {
  description = "Notifications topic name"
  value       = google_pubsub_topic.notifications.name
}

output "processed_location_topic" {
  description = "Processed location data topic name"
  value       = google_pubsub_topic.processed_location_data.name
}

# Firestore Outputs
output "firestore_database_name" {
  description = "Firestore database name"
  value       = google_firestore_database.location_db.name
}

output "firestore_database_id" {
  description = "Firestore database ID"
  value       = google_firestore_database.location_db.uid
}

# Dataflow and Storage Outputs
output "summary" {
  description = "Summary of all created resources"
  value = {
    pubsub = {
      incoming_topic_name      = google_pubsub_topic.incoming_location_data.name
      notifications_topic_name = google_pubsub_topic.notifications.name
      processed_location_topic = google_pubsub_topic.processed_location_data.name
      message_retention_days   = var.message_retention_days
    }
    firestore = {
      database_name = google_firestore_database.location_db.name
      project_id    = var.gcp_project_id
      region        = var.gcp_region
    }
    dataflow = {
      service_account = google_service_account.dataflow_runner.email
      staging_bucket  = google_storage_bucket.dataflow_bucket.name
      temp_bucket     = google_storage_bucket.dataflow_temp.name
      region          = var.gcp_region
    }
  }
}
