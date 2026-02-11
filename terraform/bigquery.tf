
# Crear un dataset estándar de BigQuery
resource "google_bigquery_dataset" "default" {
	dataset_id                  = "dataset-kids"
	location                    = var.gcp_region
	description                 = "Dataset estándar para el proyecto."
	delete_contents_on_destroy  = true
}

# Crear una tabla estándar en el dataset
resource "google_bigquery_table" "default" {
	dataset_id = google_bigquery_dataset.default.dataset_id
	table_id   = "my_table"

	schema = <<EOF
[
	{"name": "timestamp", "type": "TIMESTAMP", "mode": "REQUIRED"},
	{"name": "user_id", "type": "STRING", "mode": "REQUIRED"},
	{"name": "latitude", "type": "FLOAT", "mode": "REQUIRED"},
	{"name": "longitude", "type": "FLOAT", "mode": "REQUIRED"}
]
EOF
}
