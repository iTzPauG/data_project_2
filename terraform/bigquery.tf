
# Crear un dataset estándar de BigQuery
resource "google_bigquery_dataset" "bqdataset" {
  dataset_id                 = "dataset_kids"
  location                   = var.gcp_region
  description                = "Dataset estándar para el proyecto."
  delete_contents_on_destroy = true
}

# Crear una tabla estándar en el dataset
resource "google_bigquery_table" "table" {
  dataset_id = google_bigquery_dataset.bqdataset.dataset_id
  table_id   = "my_table"

  schema = <<EOF
[
	{"name": "timestamp", "type": "TIMESTAMP", "mode": "REQUIRED"},
	{"name": "tag_id", "type": "STRING", "mode": "REQUIRED"},
	{"name": "latitude", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "longitude", "type": "FLOAT", "mode": "REQUIRED"}
]
EOF
}

# Tabla para almacenar notificaciones de zona
resource "google_bigquery_table" "notifications" {
  dataset_id = google_bigquery_dataset.bqdataset.dataset_id
  table_id   = "notifications"

  schema = <<EOF
[
	{"name": "message", "type": "STRING", "mode": "REQUIRED"},
	{"name": "tag_id", "type": "STRING", "mode": "REQUIRED"},
	{"name": "zone_id", "type": "STRING", "mode": "REQUIRED"},
	{"name": "latitude", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "longitude", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "timestamp", "type": "TIMESTAMP", "mode": "REQUIRED"},
	{"name": "zone_radius", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "distance_meters", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "zone_type", "type": "STRING", "mode": "REQUIRED"},
	{"name": "zone_name", "type": "STRING", "mode": "NULLABLE"}
]
EOF
}
