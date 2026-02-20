# Replace with your actual GCP project ID
gcp_project_id = "data-project-2-kids"
gcp_region     = "europe-west6"

environment = "prod"

# Pub/Sub Configuration
incoming_topic_name      = "incoming-location-data"
message_retention_days   = 7
notifications_topic_name = "notifications"

zone_data_topic_name = "zone-data"

# Firestore Configuration
firestore_database_name        = "location-db"
firestore_locations_collection = "locations"
firestore_metadata_collection  = "metadata"

# Dataflow Configuration
dataflow_job_name    = "location-streaming-pipeline"
dataflow_max_workers = 10
dataflow_worker_region = "europe-west6"

# Service Account
dataflow_service_account_name = "dataflow-runner"

# Cloud SQL Configuration
cloudsql_instance_name = "main-cloudsql-instance"
cloudsql_db_name       = "appdb"
cloudsql_user          = "appuser"
zones_sql_table        = "zones"

# GitHub CI/CD Configuration
github_owner               = "iTzPauG"
github_repo_name           = "data_project_2"
github_app_installation_id = 106823541
