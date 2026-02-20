data "google_secret_manager_secret_version" "mapbox_token" {
  secret  = "mapbox-secret"
  version = "latest"
}

data "google_secret_manager_secret_version" "admin_secret_key" {
  secret  = "admin-secret-key"
  version = "latest"
}

resource "google_secret_manager_secret" "github_oauth_token" {
  secret_id = "github-oauth-token"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "cloudbuild_github_token_access" {
  secret_id = "github-oauth-token"
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:service-787549761080@gcp-sa-cloudbuild.iam.gserviceaccount.com"
  depends_on = [
    google_secret_manager_secret.github_oauth_token
  ]
}
