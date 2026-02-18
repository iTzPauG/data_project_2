variable "gcp_project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-west6"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

# Pub/Sub Variables
variable "incoming_topic_name" {
  description = "Name of the incoming location data topic"
  type        = string
  default     = "incoming-location-data"
}

variable "message_retention_days" {
  description = "Message retention in days"
  type        = number
  default     = 7
}

variable "notifications_topic_name" {
  description = "Name of the notifications topic"
  type        = string
  default     = "notifications"
}

variable "zone_data_topic_name" {
  description = "Name of the zone data topic"
  type        = string
  default     = "zone-data"
}

variable "user_data_topic_name" {
  description = "Name of the user data topic"
  type        = string
  default     = "user-data"
}

variable "kids_data_topic_name" {
  description = "Name of the kids data topic"
  type        = string
  default     = "kids-data"
}

# Firestore Variables
variable "firestore_database_name" {
  description = "Firestore database name"
  type        = string
  default     = "location-db"
}

variable "firestore_locations_collection" {
  description = "Firestore collection for location data"
  type        = string
  default     = "locations"
}

variable "firestore_metadata_collection" {
  description = "Firestore collection for metadata"
  type        = string
  default     = "metadata"
}

variable "zones_sql_table" {
  description = "Cloud SQL table name for zones"
  type        = string
  default     = "zones"
}

# Dataflow Variables
variable "dataflow_job_name" {
  description = "Dataflow job name"
  type        = string
  default     = "location-streaming-pipeline"
}

variable "dataflow_max_workers" {
  description = "Maximum number of Dataflow workers"
  type        = number
  default     = 10
}

variable "dataflow_worker_region" {
  description = "Region where Dataflow workers run (use a different region if the main one is capacity-exhausted)"
  type        = string
  default     = "europe-west1"
}

variable "dataflow_bucket_name" {
  description = "GCS bucket for Dataflow staging and templates"
  type        = string
  default     = ""
}

# Service Account Variables

# Cloud SQL Variables
variable "cloudsql_instance_name" {
  description = "Cloud SQL instance name"
  type        = string
  default     = "main-cloudsql-instance"
}

variable "cloudsql_db_name" {
  description = "Cloud SQL database name"
  type        = string
  default     = "appdb"
}

variable "cloudsql_user" {
  description = "Cloud SQL user name"
  type        = string
  default     = "appuser"
}

variable "cloudsql_password" {
  description = "Cloud SQL user password"
  type        = string
  sensitive   = true
}
variable "dataflow_service_account_name" {
  description = "Service account name for Dataflow"
  type        = string
  default     = "dataflow-runner"
}

# Cloud Run Variables
variable "cloud_run_service_name" {
  description = "Name of the Cloud Run service"
  type        = string
  default     = "api"
}

variable "cloud_run_allow_unauthenticated" {
  description = "Allow unauthenticated access to Cloud Run service"
  type        = bool
  default     = true
}
