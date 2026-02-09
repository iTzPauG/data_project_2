# Cloud SQL instance for frequent queries (basic setup)
resource "google_sql_database_instance" "main" {
  name             = var.cloudsql_instance_name
  database_version = "POSTGRES_15"
  region           = var.gcp_region

  settings {
    tier = "db-f1-micro" # Basic, smallest tier for frequent but light queries
    availability_type = "ZONAL"
    backup_configuration {
      enabled = true
    }
    ip_configuration {
      ipv4_enabled = true
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
