variable "gcp_project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region for resources"
  type        = string
  default     = "europe-southwest1"
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

variable "location_data_topic_name" {
  description = "Name of the processed location data topic"
  type        = string
  default     = "processed-location-data"
}

variable "forbidden_relevant_topic_name" {
  description = "Name of the forbidden or relevant locations topic"
  type        = string
  default     = "forbidden-relevant-location-data"
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
