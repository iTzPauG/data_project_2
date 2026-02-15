# Terraform Configuration Code Review - Errors and Issues

## Context

This is a comprehensive review of the Terraform configuration for a GCP data processing pipeline. The infrastructure includes:
- Cloud Functions Gen 2 for processing Pub/Sub messages
- Cloud SQL PostgreSQL database for frequent queries
- Dataflow pipeline for streaming data
- Cloud Run API service
- BigQuery for analytics
- Firestore for location data
- Artifact Registry for Docker images

The review identified **26 distinct issues** ranging from critical security vulnerabilities to best practice violations.

---

## Critical Issues (Must Fix Before Deployment)

### 1. Hardcoded IP Address in Cloud Function
**File:** `cloudsql.tf:75`
**Severity:** 🔴 CRITICAL

The Cloud Function has a hardcoded database IP address:
```hcl
environment_variables = {
  DB_HOST = "34.65.60.185"
}
```

**Problem:** This static IP will break if the Cloud SQL instance is recreated or its IP changes.

**Fix:** Use the Terraform-generated connection reference:
```hcl
DB_HOST = google_sql_database_instance.main.private_ip_address
# Or use connection name for Cloud SQL Proxy
```

---

### 2. Open Network Access to Cloud SQL
**File:** `cloudsql.tf:102-105`
**Severity:** 🔴 CRITICAL SECURITY RISK

The Cloud SQL instance allows connections from the entire internet:
```hcl
authorized_networks {
  name  = "all"
  value = "0.0.0.0/0"
}
```

**Problem:** Anyone with valid credentials can access the database from anywhere in the world.

**Fix:**
- Use Cloud SQL Proxy for secure connections
- OR restrict to specific IP ranges
- OR use private IP with VPC configuration (recommended)

---

### 3. Database Credentials in Environment Variables
**File:** `cloudsql.tf:71-77`
**Severity:** 🔴 CRITICAL SECURITY RISK

Database credentials are passed as plaintext environment variables:
```hcl
environment_variables = {
  DB_USER = var.cloudsql_user
  DB_PASS = var.cloudsql_password
  DB_NAME = var.cloudsql_db_name
}
```

**Problem:** Credentials are visible in the Cloud Function configuration in GCP Console.

**Fix:** Use Google Cloud Secret Manager instead:
1. Store credentials in Secret Manager
2. Grant Cloud Function service account `secretmanager.secretAccessor` role
3. Reference secrets in the application code

---

### 4. Missing Required GCP APIs
**File:** `iam.tf` (missing entries)
**Severity:** 🔴 BLOCKER

The following required APIs are not enabled:
- `cloudfunctions.googleapis.com` (for Cloud Functions Gen 2)
- `sqladmin.googleapis.com` (for Cloud SQL)

**Problem:** Deployment will fail with "API not enabled" errors.

**Fix:** Add these API enablements to `iam.tf`:
```hcl
resource "google_project_service" "cloudfunctions" {
  service            = "cloudfunctions.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}
```

---

### 5. Hardcoded User Email and Service Account
**File:** `iam.tf:5,13`
**Severity:** 🔴 CRITICAL SECURITY RISK

Personal email and service account are hardcoded:
```hcl
member = "user:pgesparterpubli@gmail.com"
member = "serviceAccount:service-787549761080@gs-project-accounts.iam.gserviceaccount.com"
```

**Problem:**
- Personal email exposed in infrastructure code
- Configuration is not portable across projects
- Security risk with external email having BigQuery Admin role

**Fix:**
- Move email to a variable
- Use data source to discover service accounts dynamically
- Consider using service accounts instead of user emails

---

### 6. Deprecated Resource Type
**Files:** `cloudsql.tf:46`, `cloud-build.tf:35`, `dataflow.tf:70,101`
**Severity:** 🔴 CRITICAL

Using deprecated `google_storage_bucket_object` resource:
```hcl
resource "google_storage_bucket_object" "zone_data_function_zip" {
  # This resource is deprecated
}
```

**Problem:** This resource is deprecated since Google Provider v5.0+ and will be removed in future versions.

**Fix:** Replace all instances with `google_storage_object`:
```hcl
resource "google_storage_object" "zone_data_function_zip" {
  # Updated resource type
}
```

---

## High Priority Issues

### 7. No Deletion Protection on Cloud SQL
**File:** `cloudsql.tf:113`
**Severity:** 🟠 HIGH

```hcl
deletion_protection = false
```

**Problem:** Database can be accidentally destroyed during `terraform destroy`.

**Fix:** Set to `true` for production environments.

---

### 8. Force Destroy on All Storage Buckets
**Files:** `cloudsql.tf:43`, `cloud-build.tf:11`, `dataflow.tf:5,25`
**Severity:** 🟠 HIGH

```hcl
force_destroy = true
```

**Problem:** All buckets (including production data) can be deleted with their contents during `terraform destroy`.

**Fix:** Set to `false` for production data buckets or use conditional logic based on environment.

---

### 9. Missing VPC and Private IP Configuration
**File:** `cloudsql.tf` (entire file)
**Severity:** 🟠 HIGH SECURITY RISK

**Problem:**
- Cloud SQL uses public IP
- Cloud Function has no VPC connector
- Database traffic goes through public internet

**Fix:**
1. Create VPC network and subnet
2. Enable Cloud SQL private IP
3. Add VPC connector to Cloud Function
4. Disable public IP on Cloud SQL

---

### 10. Incomplete Cloud Function Service Account Permissions
**File:** `cloudsql.tf:8-12`
**Severity:** 🟠 HIGH

The service account only has `cloudsql.client` role.

**Problem:** Missing permissions for:
- Secret Manager access (for credentials)
- Firestore access (listed in requirements.txt)
- Pub/Sub subscriber (for event trigger)

**Fix:** Add missing IAM bindings for the service account.

---

### 11. Provider Version Inconsistency
**File:** `main.tf:20-23`
**Severity:** 🟠 HIGH

The `google-beta` provider is declared without version constraint:
```hcl
provider "google-beta" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
```

**Problem:** Google provider specifies v6.0 but google-beta is locked at v7.19.0 (from .terraform.lock.hcl).

**Fix:** Add version constraint to google-beta provider:
```hcl
provider "google-beta" {
  version = "~> 6.0"
  project = var.gcp_project_id
  region  = var.gcp_region
}
```

---

## Medium Priority Issues

### 12. Overly Broad BigQuery Permissions
**File:** `iam.tf:2-6,10-14`
**Severity:** 🟡 MEDIUM

Granting project-level `roles/bigquery.admin` role.

**Problem:** Too broad - allows access to all BigQuery datasets in the project.

**Fix:** Use dataset-level IAM bindings with `google_bigquery_dataset_iam_member`.

---

### 13. Hardcoded Container Image Tags
**Files:** `cloudrun.tf:30`, `dataflow.tf:86,105`
**Severity:** 🟡 MEDIUM

Using hardcoded `latest` tag for container images.

**Problem:** "latest" tag can cause unexpected updates and makes rollbacks difficult.

**Fix:** Use specific version tags in production (e.g., `v1.0.0`, commit SHA).

---

### 14. Missing Dependency Declarations
**File:** `dataflow.tf:141-147`
**Severity:** 🟡 MEDIUM

Dataflow job depends_on is incomplete:
```hcl
depends_on = [
  google_storage_bucket_object.flex_template_spec,
  google_project_iam_member.dataflow_worker,
  # Missing: google_firestore_database.location_db
  # Missing: BigQuery dataset/table
]
```

**Problem:** Race conditions during deployment.

**Fix:** Add Firestore and BigQuery resources to depends_on list.

---

### 15. Requirements.txt Generated by Terraform
**File:** `cloudsql.tf:15-22`
**Severity:** 🟡 MEDIUM

Using `local_file` resource to generate requirements.txt:
```hcl
resource "local_file" "zone_data_function_requirements" {
  filename = "../dataflow-pipeline/requirements.txt"
  content  = <<-EOT
    psycopg2
    google-cloud-secret-manager
    google-cloud-firestore
  EOT
}
```

**Problem:**
- Creates state drift if file is modified manually
- Requirements file should be in source control
- Writes to directory outside Terraform workspace

**Fix:** Keep requirements.txt in source control and reference it directly.

---

## Low Priority / Best Practice Issues

### 16. Default Environment Set to 'prod'
**File:** `variables.tf:15`
**Severity:** 🔵 LOW

```hcl
variable "environment" {
  default = "prod"
}
```

**Problem:** Could accidentally create production resources during testing.

**Fix:** Default to "dev" or "test", require explicit "prod" setting.

---

### 17. Database Password in terraform.tfvars
**File:** `terraform.tfvars:32`
**Severity:** 🔵 LOW (if not committed with real password)

**Problem:** If real password is in tfvars and committed to version control, it's exposed.

**Fix:** Use environment variable `TF_VAR_cloudsql_password` (already documented as best practice).

---

### 18. Missing Cloud Function in Outputs
**File:** `outputs.tf`
**Severity:** 🔵 LOW

**Problem:** Cloud Function resources not exported in outputs.

**Fix:** Add outputs for Cloud Function URL and service account email.

---

### 19. BigQuery Table Schema as Inline JSON
**File:** `bigquery.tf:15-22`
**Severity:** 🔵 LOW

**Problem:** Schema defined as JSON string rather than HCL blocks.

**Fix:** Use native Terraform `schema` blocks for better maintainability.

---

### 20. Missing Variable Validation
**File:** `variables.tf`
**Severity:** 🔵 LOW

**Problem:** No validation rules on critical variables (gcp_project_id, gcp_region, etc.).

**Fix:** Add validation blocks to ensure valid values.

---

## Summary Statistics

| Severity | Count | Category |
|----------|-------|----------|
| 🔴 Critical | 6 | Security vulnerabilities and deployment blockers |
| 🟠 High | 5 | Security risks and configuration issues |
| 🟡 Medium | 5 | Best practices and potential issues |
| 🔵 Low | 4 | Code quality and maintainability |
| **Total** | **20** | **Distinct issues identified** |

---

## Critical Files Requiring Changes

1. **cloudsql.tf** - Most critical issues (hardcoded IP, open network, credentials)
2. **iam.tf** - Missing APIs, hardcoded credentials
3. **main.tf** - Provider version inconsistency
4. **cloud-build.tf, dataflow.tf** - Deprecated resource types
5. **variables.tf, terraform.tfvars** - Variable management improvements

---

## Recommended Action Plan (Priority Order)

### Immediate Actions (Before Any Deployment)
1. ✅ Add missing API services (`cloudfunctions.googleapis.com`, `sqladmin.googleapis.com`)
2. ✅ Replace hardcoded IP (34.65.60.185) with Terraform reference
3. ✅ Restrict Cloud SQL network access (remove 0.0.0.0/0)
4. ✅ Move credentials to Secret Manager
5. ✅ Remove hardcoded email and service account (use variables)
6. ✅ Replace deprecated `google_storage_bucket_object` with `google_storage_object`

### High Priority (Before Production)
7. ✅ Enable deletion protection on Cloud SQL
8. ✅ Set force_destroy to false on production buckets
9. ✅ Implement VPC and private IP for Cloud SQL
10. ✅ Add missing Cloud Function service account permissions
11. ✅ Fix provider version consistency

### Medium Priority (Production Hardening)
12. ✅ Use dataset-level BigQuery permissions
13. ✅ Replace "latest" tags with specific versions
14. ✅ Add missing dependency declarations
15. ✅ Move requirements.txt to source control

### Low Priority (Code Quality)
16. ✅ Change default environment to "dev"
17. ✅ Ensure no passwords in version control
18. ✅ Add Cloud Function outputs
19. ✅ Add variable validation
20. ✅ Use HCL schema blocks for BigQuery

---

## Verification Steps

After fixes are applied:
1. Run `terraform validate` to check syntax
2. Run `terraform plan` to verify changes
3. Review plan output for unexpected resource changes
4. Test deployment in a non-production environment first
5. Verify Cloud Function can connect to Cloud SQL
6. Check that all APIs are enabled before deployment
7. Verify IAM permissions are correctly assigned
8. Test database connectivity with proper network restrictions

---

## Notes

- This is a static code review - runtime behavior not tested
- All issues are based on Terraform configuration as of the current commit
- Security recommendations assume production deployment
- Some issues may be acceptable for development/testing environments
