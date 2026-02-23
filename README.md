# Data Project 2 – GCP Location Platform

Plataforma integral para ingestión, procesamiento, visualización y administración de datos de localización en Google Cloud Platform.

## Componentes principales

- **Infraestructura como código:** Terraform (carpeta `terraform/`)
- **Backend API:** Python FastAPI (carpeta `api/`)
- **Panel de administración:** Flask + Jinja2 (carpeta `admin/`)
- **Frontend:** React + Vite (carpeta `frontend/`)
- **Procesamiento streaming:** Apache Beam en Dataflow (carpeta `dataflow-pipeline/`)
- **Funciones serverless:** Cloud Functions (carpeta `cloud-func/`)
- **Simulación y tracking:** Herramientas de generación y visualización de movimientos (carpeta `randomtracker/`)

## Arquitectura general

```
┌────────────┐    ┌────────────┐    ┌────────────┐
│  Tracker   │ → │   API      │ →  │ Pub/Sub    │
└────────────┘    └────────────┘    └─────┬──────┘
                                          │
                                  ┌───────▼────────┐
                                  │ Dataflow       │
                                  │ (Beam)         │
                                  └───────┬────────┘
                                          │
        ┌───────────────┬─────────────────┴───────────────┐
        │               │                                 │
   Firestore        BigQuery                        Notificaciones
   (Realtime)      (Batch/SQL)                      (Pub/Sub)
        │               │                                 │
   Frontend        Admin Panel                    Cloud Functions
```

## Estructura del repositorio

```
data_project_2/
├── admin/           # Panel de administración Flask
├── api/             # Backend API (FastAPI)
├── cloud-func/      # Google Cloud Functions
├── dataflow-pipeline/ # Apache Beam pipeline
├── frontend/        # Frontend React
├── randomtracker/   # Simulación y visualización de movimientos
├── terraform/       # Infraestructura como código
└── README.md        # Este archivo
```

## Despliegue rápido

1. Configura variables en `terraform/terraform.tfvars` y backend en `terraform/main.tf`.
2. Despliega infraestructura:
   ```bash
   cd terraform
   terraform init
   terraform apply
   ```
3. Despliega pipelines y funciones según instrucciones en cada subcarpeta.
4. Lanza el frontend y el admin panel para visualizar y administrar datos.

## Recursos principales

- **Firestore**: Base de datos NoSQL para localizaciones en tiempo real.
- **BigQuery**: Almacenamiento analítico y consultas SQL.
- **Pub/Sub**: Ingesta y distribución de eventos.
- **Dataflow**: Procesamiento streaming y batch.
- **Cloud Run/Functions**: APIs y lógica serverless.

## Seguridad y buenas prácticas

- Variables sensibles gestionadas por Secret Manager y tfvars.
- IAM granular para servicios y cuentas.
- Sin credenciales hardcodeadas.
- Logging y monitorización integrados.

## Documentación adicional

- `terraform/README.md`: Infraestructura y despliegue GCP
- `dataflow-pipeline/README.md`: Pipeline de procesamiento
- `frontend/SETUP.md`: Setup del frontend
- `randomtracker/README.md`: Simulación de movimientos

---

**Licencia:** Apache 2.0

**Última actualización:** Febrero 2026
