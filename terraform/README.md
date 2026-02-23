# Terraform Infrastructure - Kids Location Tracking

Infrastructure as Code para el sistema de tracking de niños usando Google Cloud Platform.

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            GCP INFRASTRUCTURE                                   │
│                                                                                 │
│   ┌─────────────┐      ┌─────────────┐      ┌─────────────┐      ┌───────────┐ │
│   │  Frontend   │      │     API     │      │   Admin     │      │ Tracker   │ │
│   │ (Cloud Run) │      │ (Cloud Run) │      │ (Cloud Run) │      │  (Local)  │ │
│   └──────┬──────┘      └──────┬──────┘      └──────┬──────┘      └─────┬─────┘ │
│          │                    │                    │                   │        │
│          │                    ▼                    │                   │        │
│          │             ┌─────────────┐             │                   │        │
│          │             │   Pub/Sub   │◄────────────┼───────────────────┘        │
│          │             │   Topics    │             │                            │
│          │             └──────┬──────┘             │                            │
│          │                    │                    │                            │
│          │     ┌──────────────┼──────────────┐     │                            │
│          │     ▼              ▼              ▼     │                            │
│          │ ┌───────┐    ┌───────────┐   ┌───────┐  │                            │
│          │ │Users  │    │ Locations │   │ Zones │  │                            │
│          │ │ Func  │    │ Dataflow  │   │ Func  │  │                            │
│          │ └───┬───┘    └─────┬─────┘   └───┬───┘  │                            │
│          │     │              │             │      │                            │
│          │     ▼              ▼             ▼      │                            │
│          │ ┌─────────────────────────────────────┐ │                            │
│          │ │            Cloud SQL                │◄┘                            │
│          │ │         (PostgreSQL)                │                              │
│          │ └─────────────────────────────────────┘                              │
│          │                    │                                                 │
│          │                    ▼                                                 │
│          │ ┌─────────────────────────────────────┐                              │
│          └►│          Firestore                   │                              │
│            │      (Real-time locations)          │                              │
│            └─────────────────────────────────────┘                              │
│                               │                                                 │
│                               ▼                                                 │
│            ┌─────────────────────────────────────┐                              │
│            │           BigQuery                  │                              │
│            │         (Analytics)                 │                              │
│            └─────────────────────────────────────┘                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Componentes de Infraestructura

### 🗄️ Bases de Datos

| Servicio | Uso | Archivo |
|----------|-----|---------|
| **Cloud SQL (PostgreSQL)** | Usuarios, kids, zonas | `cloudsql.tf` |
| **Firestore** | Ubicaciones en tiempo real | `firestore.tf` |
| **BigQuery** | Análisis histórico | `bigquery.tf` |

### 📨 Mensajería (Pub/Sub)

| Topic | Descripción |
|-------|-------------|
| `incoming-location-data` | Datos de ubicación entrantes |
| `user-data` | Registro/actualización de usuarios |
| `kids-data` | Registro/actualización de niños |
| `zone-data` | Definición de zonas permitidas/prohibidas |
| `notifications` | Alertas y notificaciones |

### 🚀 Servicios (Cloud Run)

| Servicio | Puerto | Descripción |
|----------|--------|-------------|
| **API** | 8080 | API REST principal con WebSocket |
| **Frontend** | 80 | Aplicación web React/Vite |
| **Admin** | 8080 | Panel de administración |

### ⚡ Cloud Functions

| Función | Trigger | Descripción |
|---------|---------|-------------|
| `zone-data-to-sql` | Pub/Sub (zone-data) | Inserta zonas en PostgreSQL |
| `user-data-to-sql` | Pub/Sub (user-data) | Inserta usuarios en PostgreSQL |
| `kids-data-to-sql` | Pub/Sub (kids-data) | Inserta niños en PostgreSQL |

### 🔄 Dataflow

Pipeline de streaming para procesar ubicaciones en tiempo real y detectar violaciones de zonas.

---

## Estructura de Archivos

```
terraform/
│
├── main.tf                 # Configuración del provider y backend
├── variables.tf            # Definición de variables
├── terraform.tfvars        # Valores de variables (configurar aquí)
├── outputs.tf              # Outputs del deployment
│
├── # ═══════════ INFRAESTRUCTURA BASE ═══════════
├── iam.tf                  # Service accounts y permisos IAM
├── secrets.tf              # Secret Manager (tokens, passwords)
├── artifact-registry.tf    # Repositorio Docker para imágenes
│
├── # ═══════════ BASES DE DATOS ═══════════
├── cloudsql.tf             # PostgreSQL + Cloud Functions (users/kids/zones)
├── firestore.tf            # Firestore para ubicaciones real-time
├── bigquery.tf             # Dataset y tabla para analytics
│
├── # ═══════════ MENSAJERÍA ═══════════
├── pubsub.tf               # Topics y subscriptions
│
├── # ═══════════ COMPUTE ═══════════
├── cloudrun.tf             # API service en Cloud Run
├── cloud-build.tf          # CI/CD triggers para builds
├── dataflow.tf             # Pipeline de streaming
├── admin.tf                # Panel de administración
│
└── # ═══════════ DOCUMENTACIÓN ═══════════
    ├── README.md           # Este archivo
    └── futurechanges.md    # Cambios pendientes
```

---

## Requisitos Previos

- **Terraform** v1.0+
- **Google Cloud SDK** (`gcloud`) configurado
- **Proyecto GCP** con billing habilitado
- **Permisos**: Project Editor o equivalente

---

## Quick Start

### 1. Configurar Variables

Editar `terraform.tfvars`:

```hcl
gcp_project_id = "data-project-2-kids"  # Tu proyecto
gcp_region     = "europe-west6"
environment    = "prod"
```

### 2. Inicializar y Desplegar

```bash
# Inicializar Terraform
terraform init

# Ver plan de cambios
terraform plan

# Aplicar infraestructura
terraform apply
```

### 3. Verificar Outputs

```bash
terraform output
```

---

## Variables Principales

| Variable | Valor Actual | Descripción |
|----------|--------------|-------------|
| `gcp_project_id` | ID del proyecto GCP |
| `gcp_region` | Región de despliegue |
| `cloudsql_instance_name`  | Nombre instancia PostgreSQL |
| `cloudsql_db_name` | Base de datos |
| `cloudsql_user` | Usuario PostgreSQL |


## Secretos en Secret Manager

| Secreto | Uso |
|---------|-----|
| `cloudsql-password` | Contraseña PostgreSQL |
| `mapbox-secret` | Token API Mapbox |
| `admin-secret-key` | Clave sesión admin |
| `github-oauth-token` | OAuth para Cloud Build |

Acceder a un secreto:
```bash
gcloud secrets versions access latest --secret=cloudsql-password
```

---

## Service Accounts

| Service Account | Uso |
|-----------------|-----|
| `dataflow-runner` | Ejecutar jobs Dataflow |
| `cloud-run-api` | API en Cloud Run |
| `admin-panel` | Panel de administración |
| `zone-data-function-sa` | Cloud Function zonas |
| `user-data-function-sa` | Cloud Function usuarios |
| `kids-data-function-sa` | Cloud Function niños |

---

## Notas Importantes

1. **Estado Remoto**: El state se almacena en `gs://data-project-2-kids-terraform-state/`
2. **Contraseñas**: Se generan automáticamente con `random_password`
3. **APIs**: Se habilitan automáticamente via `google_project_service`
4. **Cloud Functions**: Se despliegan desde archivos ZIP en GCS

---


## Referencias

- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest)
- [Cloud Run Docs](https://cloud.google.com/run/docs)
- [Cloud Functions Docs](https://cloud.google.com/functions/docs)
- [Pub/Sub Docs](https://cloud.google.com/pubsub/docs)

---

**Última actualización**: Febrero 2026  
**Terraform**: v1.0+  
**Google Provider**: v6.0+  
**Región**: europe-west6

