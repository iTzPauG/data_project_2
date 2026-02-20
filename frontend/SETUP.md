# Frontend - Visualización Geoespacial (Valencia)

Este repositorio contiene la interfaz de usuario (UI) para la visualización de datos procesados por el pipeline de GCP (Pub/Sub -> Dataflow). 

El objetivo principal es renderizar en tiempo real rutas de usuarios (niños) y zonas de exclusión (geofencing) sobre un mapa interactivo de Valencia.

## 1. Stack Tecnológico

Hemos seleccionado una arquitectura moderna optimizada para renderizado de alto rendimiento (WebGL):

* **Core:** [React](https://react.dev/) + [Vite](https://vitejs.dev/) (Build tool ultrarrápido).
* **Visualización:** [Deck.gl](https://deck.gl/) (Uber). Permite manejar miles de capas y puntos sin congelar el navegador, esencial para los datos que vienen de Dataflow.
* **Mapa Base:** [Mapbox GL](https://www.mapbox.com/) (vía `react-map-gl`). Proporciona la cartografía base estética.
* **HTTP Client:** [Axios](https://axios-http.com/). Para la comunicación con el servicio API en Cloud Run.
* **Despliegue:** Docker + Nginx (Optimizado para Google Cloud Run).

## 2. Requisitos Previos

Para ejecutar este proyecto localmente necesitas:

1.  **Node.js** (Versión LTS v18 o superior).
2.  Una **API Key de Mapbox** (Gratuita).
