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



output "incoming_zone_topic" {
  description = "Incoming zone data topic name"
  value       = google_pubsub_topic.incoming_zone_data.name
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

# Cloud Run Outputs
output "cloud_run_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.api.uri
}

# Dataflow Outputs
output "dataflow_job_id" {
  description = "Dataflow job ID"
  value       = google_dataflow_flex_template_job.location_pipeline.job_id
}

# Dataflow and Storage Outputs
output "summary" {
  description = "Summary of all created resources"
  value = {
    pubsub = {
      incoming_topic_name      = google_pubsub_topic.incoming_location_data.name
      notifications_topic_name = google_pubsub_topic.notifications.name
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
    cloudbuild = {
      trigger_name       = google_cloudbuild_trigger.github_main.name
      github_connection  = google_cloudbuildv2_connection.github.name
      github_repository  = google_cloudbuildv2_repository.main.name
    }
  }
}
