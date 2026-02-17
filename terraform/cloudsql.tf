# Cuenta de servicio dedicada para la Cloud Function
resource "google_service_account" "zone_data_function" {
  account_id   = "zone-data-function-sa"
  display_name = "Service Account for zone-data-to-sql Cloud Function"
}

# Asigna el rol Cloud SQL Client a la cuenta de servicio
resource "google_project_iam_member" "zone_data_function_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.zone_data_function.email}"
}
# Create forbidden_locations table in Cloud SQL
# requirements.txt para la Cloud Function Gen 2
resource "local_file" "zone_data_function_requirements" {
  filename = "../dataflow-pipeline/requirements.txt"
  content  = <<-EOT
psycopg2
google-cloud-secret-manager
google-cloud-firestore
EOT
}

# Archivo ZIP para la Cloud Function Gen 2
resource "archive_file" "zone_data_function_zip" {
  type        = "zip"
  output_path = "../dataflow-pipeline/cloud_function_zone_data_to_sql.zip"
  source {
    content  = file("../dataflow-pipeline/main.py")
    filename = "main.py"
  }
  source {
    content  = local_file.zone_data_function_requirements.content
    filename = "requirements.txt"
  }
  excludes   = ["*.zip"]
  depends_on = [local_file.zone_data_function_requirements]
}
# Cloud Function Gen 2 para procesar zone data
resource "google_storage_bucket" "zone_data_function_code" {
  name          = "${var.cloudsql_instance_name}-zone-data-function-code"
  location      = var.gcp_region
  force_destroy = true
}

resource "google_storage_bucket_object" "zone_data_function_zip" {
  name   = "cloud_function_zone_data_to_sql.zip"
  bucket = google_storage_bucket.zone_data_function_code.name
  source = archive_file.zone_data_function_zip.output_path
}

resource "google_cloudfunctions2_function" "zone_data_to_sql" {
  name        = "zone-data-to-sql"
  location    = var.gcp_region
  description = "Procesa mensajes Pub/Sub y los inserta en Cloud SQL (Gen 2)"
  build_config {
    runtime     = "python310"
    entry_point = "zone_data_to_sql"
    source {
      storage_source {
        bucket = google_storage_bucket.zone_data_function_code.name
        object = google_storage_bucket_object.zone_data_function_zip.name
      }
    }
  }
  service_config {
    min_instance_count = 1
    max_instance_count = 1
    available_memory   = "256M"
    timeout_seconds    = 180
    environment_variables = {
      DB_USER     = var.cloudsql_user
      DB_PASS     = var.cloudsql_password
      DB_NAME     = var.cloudsql_db_name
      DB_HOST     = google_sql_database_instance.main.public_ip_address
      GCP_PROJECT = var.gcp_project_id
    }
    service_account_email = google_service_account.zone_data_function.email
  }
  event_trigger {
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    trigger_region = var.gcp_region
    pubsub_topic   = "projects/${var.gcp_project_id}/topics/zone-data"
  }
}

# Eventarc trigger para Pub/Sub topic
# Cloud SQL instance for frequent queries (basic setup)
resource "google_sql_database_instance" "main" {
  name             = var.cloudsql_instance_name
  database_version = "POSTGRES_15"
  region           = var.gcp_region

  settings {
    tier              = "db-f1-micro" # Basic, smallest tier for frequent but light queries
    availability_type = "ZONAL"
    backup_configuration {
      enabled = true
    }
    ip_configuration {
      ipv4_enabled = true
      authorized_networks {
        name  = "all"
        value = "0.0.0.0/0"
      }
    }
    user_labels = {
      environment = var.environment
      purpose     = "frequent-query-db"
    }
  }

  deletion_protection = false
}

resource "google_sql_database" "default" {
  name     = var.cloudsql_db_name
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "default" {
  name     = var.cloudsql_user
  instance = google_sql_database_instance.main.name
  password = var.cloudsql_password
}

output "cloudsql_instance_connection_name" {
  description = "Cloud SQL instance connection name"
  value       = google_sql_database_instance.main.connection_name
}
