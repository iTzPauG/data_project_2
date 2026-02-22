# =============================================================================
# Generate a random password for Cloud SQL user
resource "random_password" "cloudsql_password" {
  length  = 16
  special = true
}
# SERVICE ACCOUNTS FOR CLOUD FUNCTIONS
# =============================================================================

# Cuenta de servicio dedicada para la Cloud Function de zones
resource "google_service_account" "zone_data_function" {
  account_id   = "zone-data-function-sa"
  display_name = "Service Account for zone-data-to-sql Cloud Function"
}

resource "google_project_iam_member" "zone_data_function_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.zone_data_function.email}"
}

resource "google_project_iam_member" "zone_data_function_firestore" {
  project = var.gcp_project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.zone_data_function.email}"
}

# Cuenta de servicio dedicada para la Cloud Function de users
resource "google_service_account" "user_data_function" {
  account_id   = "user-data-function-sa"
  display_name = "Service Account for user-data-to-sql Cloud Function"
}

resource "google_project_iam_member" "user_data_function_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.user_data_function.email}"
}

# Cuenta de servicio dedicada para la Cloud Function de kids
resource "google_service_account" "kids_data_function" {
  account_id   = "kids-data-function-sa"
  display_name = "Service Account for kids-data-to-sql Cloud Function"
}

resource "google_project_iam_member" "kids_data_function_sql_client" {
  project = var.gcp_project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.kids_data_function.email}"
}

# =============================================================================
# REQUIREMENTS FILE (shared by all cloud functions)
# =============================================================================

resource "local_file" "cloud_function_requirements" {
  filename = "../cloud-func/requirements.txt"
  content  = <<-EOT
psycopg2-binary
google-cloud-secret-manager
google-cloud-firestore
EOT
}

# =============================================================================
# ZONE DATA CLOUD FUNCTION
# =============================================================================

resource "archive_file" "zone_data_function_zip" {
  type        = "zip"
  output_path = "../cloud-func/zone/cloud_function_zone_data_to_sql.zip"
  source {
    content  = file("../cloud-func/zone/main.py")
    filename = "main.py"
  }
  source {
    content  = local_file.cloud_function_requirements.content
    filename = "requirements.txt"
  }
  excludes   = ["*.zip"]
  depends_on = [local_file.cloud_function_requirements]
}

resource "google_storage_bucket" "cloud_functions_code" {
  name          = "${var.cloudsql_instance_name}-cloud-functions-code"
  location      = var.gcp_region
  force_destroy = true
}

resource "google_storage_bucket_object" "zone_data_function_zip" {
  name   = "cloud_function_zone_data_to_sql.zip"
  bucket = google_storage_bucket.cloud_functions_code.name
  source = archive_file.zone_data_function_zip.output_path
}

resource "google_cloudfunctions2_function" "zone_data_to_sql" {
  name        = "zone-data-to-sql"
  location    = var.gcp_region
  description = "Procesa mensajes Pub/Sub de zones y los inserta en Cloud SQL"
  build_config {
    runtime     = "python310"
    entry_point = "zone_data_to_sql"
    source {
      storage_source {
        bucket = google_storage_bucket.cloud_functions_code.name
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
      DB_USER             = var.cloudsql_user
      DB_PASS             = random_password.cloudsql_password.result
      DB_NAME             = var.cloudsql_db_name
      DB_HOST             = google_sql_database_instance.main.public_ip_address
      GCP_PROJECT         = var.gcp_project_id
      FIRESTORE_DATABASE  = var.firestore_database_name
    }
    service_account_email = google_service_account.zone_data_function.email
  }
  event_trigger {
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    trigger_region = var.gcp_region
    pubsub_topic   = "projects/${var.gcp_project_id}/topics/${var.zone_data_topic_name}"
  }
}

# =============================================================================
# USER DATA CLOUD FUNCTION
# =============================================================================

resource "archive_file" "user_data_function_zip" {
  type        = "zip"
  output_path = "../cloud-func/users/cloud_function_user_data_to_sql.zip"
  source {
    content  = file("../cloud-func/users/main.py")
    filename = "main.py"
  }
  source {
    content  = local_file.cloud_function_requirements.content
    filename = "requirements.txt"
  }
  excludes   = ["*.zip"]
  depends_on = [local_file.cloud_function_requirements]
}

resource "google_storage_bucket_object" "user_data_function_zip" {
  name   = "cloud_function_user_data_to_sql.zip"
  bucket = google_storage_bucket.cloud_functions_code.name
  source = archive_file.user_data_function_zip.output_path
}

resource "google_cloudfunctions2_function" "user_data_to_sql" {
  name        = "user-data-to-sql"
  location    = var.gcp_region
  description = "Procesa mensajes Pub/Sub de users y los inserta en Cloud SQL"
  build_config {
    runtime     = "python310"
    entry_point = "user_data_to_sql"
    source {
      storage_source {
        bucket = google_storage_bucket.cloud_functions_code.name
        object = google_storage_bucket_object.user_data_function_zip.name
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
      DB_PASS     = random_password.cloudsql_password.result
      DB_NAME     = var.cloudsql_db_name
      DB_HOST     = google_sql_database_instance.main.public_ip_address
      GCP_PROJECT = var.gcp_project_id
    }
    service_account_email = google_service_account.user_data_function.email
  }
  event_trigger {
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    trigger_region = var.gcp_region
    pubsub_topic   = "projects/${var.gcp_project_id}/topics/${var.user_data_topic_name}"
  }
}

# =============================================================================
# KIDS DATA CLOUD FUNCTION
# =============================================================================

resource "archive_file" "kids_data_function_zip" {
  type        = "zip"
  output_path = "../cloud-func/kids/cloud_function_kids_data_to_sql.zip"
  source {
    content  = file("../cloud-func/kids/main.py")
    filename = "main.py"
  }
  source {
    content  = local_file.cloud_function_requirements.content
    filename = "requirements.txt"
  }
  excludes   = ["*.zip"]
  depends_on = [local_file.cloud_function_requirements]
}

resource "google_storage_bucket_object" "kids_data_function_zip" {
  name   = "cloud_function_kids_data_to_sql.zip"
  bucket = google_storage_bucket.cloud_functions_code.name
  source = archive_file.kids_data_function_zip.output_path
}

resource "google_cloudfunctions2_function" "kids_data_to_sql" {
  name        = "kids-data-to-sql"
  location    = var.gcp_region
  description = "Procesa mensajes Pub/Sub de kids y los inserta en Cloud SQL"
  build_config {
    runtime     = "python310"
    entry_point = "kids_data_to_sql"
    source {
      storage_source {
        bucket = google_storage_bucket.cloud_functions_code.name
        object = google_storage_bucket_object.kids_data_function_zip.name
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
      DB_PASS     = random_password.cloudsql_password.result
      DB_NAME     = var.cloudsql_db_name
      DB_HOST     = google_sql_database_instance.main.public_ip_address
      GCP_PROJECT = var.gcp_project_id
    }
    service_account_email = google_service_account.kids_data_function.email
  }
  event_trigger {
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    trigger_region = var.gcp_region
    pubsub_topic   = "projects/${var.gcp_project_id}/topics/${var.kids_data_topic_name}"
  }
}
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
  password = random_password.cloudsql_password.result
}

output "cloudsql_instance_connection_name" {
  description = "Cloud SQL instance connection name"
  value       = google_sql_database_instance.main.connection_name
}

output "cloud_functions" {
  description = "Cloud Functions URLs"
  value = {
    zone_data_to_sql = google_cloudfunctions2_function.zone_data_to_sql.service_config[0].uri
    user_data_to_sql = google_cloudfunctions2_function.user_data_to_sql.service_config[0].uri
    kids_data_to_sql = google_cloudfunctions2_function.kids_data_to_sql.service_config[0].uri
  }
}
