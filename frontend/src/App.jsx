import React, { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { PathLayer, PolygonLayer } from '@deck.gl/layers';

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// URL del WebSocket de tu API (FastAPI)
// NOTA: Si estás en local usa 'ws://localhost:8000/ws/locations'
// Si estás en Cloud Run usa 'wss://tu-url-de-cloud-run.app/ws/locations'
const WS_URL = 'ws://localhost:8000/ws/locations';

const INITIAL_VIEW_STATE = {
  longitude: -0.376288, // Valencia Centro
  latitude: 39.469907,
  zoom: 14,
  pitch: 45,
  bearing: 0
};

// Datos Estáticos (Zonas Rojas)
const ZONA_ROJA = [
  {
    polygon: [
      [-0.3775, 39.4705],
      [-0.3765, 39.4705],
      [-0.3765, 39.4695],
      [-0.3775, 39.4695],
      [-0.3775, 39.4705] 
    ]
  }
];

function App() {
  // --- 2. ESTADO ---
  const [rutaNiño, setRutaNiño] = useState([]); // Aquí guardamos la lista de coordenadas
  const [statusConexion, setStatusConexion] = useState("🟡 Conectando...");

  // --- 3. CONEXIÓN WEBSOCKET (La lógica de Tiempo Real) ---
  useEffect(() => {
    let socket;

    try {
      socket = new WebSocket(WS_URL);

      // Al abrir conexión
      socket.onopen = () => {
        console.log("✅ WebSocket Conectado");
        setStatusConexion("🟢 En Vivo");
      };

      // Al recibir un dato desde Python (FastAPI)
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Verificamos que sea un mensaje de actualización de ubicación
          if (data.latitude && data.longitude) {
            // Deck.gl usa formato [longitud, latitud]
            const nuevoPunto = [data.longitude, data.latitude];
            
            // Añadimos el punto al array existente
            setRutaNiño((prevRuta) => [...prevRuta, nuevoPunto]);
          }
        } catch (error) {
          console.error("Error al procesar mensaje WS:", error);
        }
      };

      // Al cerrar o error
      socket.onclose = () => setStatusConexion("🔴 Desconectado");
      socket.onerror = (error) => console.error("Error WS:", error);

    } catch (e) {
      console.error("No se pudo conectar al WebSocket:", e);
      setStatusConexion("🔴 Error Conexión");
    }

    // Limpieza: Cerrar conexión si el usuario cierra la web
    return () => {
      if (socket) socket.close();
    };
  }, []); // Se ejecuta una sola vez al cargar la página

  // --- 4. CAPAS DE DECK.GL ---
  const layers = [
    // Capa 1: Zonas Prohibidas (Estática)
    new PolygonLayer({
      id: 'zonas-prohibidas',
      data: ZONA_ROJA,
      getPolygon: d => d.polygon,
      getFillColor: [255, 0, 0, 80], // Rojo semitransparente
      getLineColor: [255, 0, 0, 255], // Borde sólido
      getLineWidth: 3,
      pickable: true,
    }),

    // Capa 2: Ruta del Niño (Dinámica)
    new PathLayer({
      id: 'ruta-niño',
      // Envolvemos la ruta en un objeto data
      data: [{ path: rutaNiño, color: [0, 150, 255] }], 
      getPath: d => d.path,
      getColor: d => d.color,
      getWidth: 15, // Ancho en metros
      widthMinPixels: 4,
      jointRounded: true,
      capRounded: true,
      // CRÍTICO: updateTriggers avisa a Deck.gl que los datos han cambiado
      // Si no pones esto, la línea no crecerá aunque llegue info nueva
      updateTriggers: {
        getPath: rutaNiño.length 
      }
    })
  ];

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true} // Zoom y rotación habilitados
      layers={layers}
    >
      <Map
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/light-v11"
      />
      
      {/* UI FLOTANTE - LEYENDA Y ESTADO */}
      <div style={{
        position: 'absolute', 
        top: 20, 
        left: 20, 
        background: 'white', 
        padding: '15px', 
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        fontFamily: 'sans-serif'
      }}>
        <h3 style={{margin: '0 0 10px 0', fontSize: '16px'}}>Monitorización Valencia</h3>
        
        {/* Estado Conexión */}
        <div style={{marginBottom: '10px', fontSize: '14px', fontWeight: 'bold'}}>
          {statusConexion}
        </div>

        <div style={{fontSize: '13px', color: '#555'}}>
          <div>Puntos Rastreados: <b>{rutaNiño.length}</b></div>
        </div>

        <hr style={{border: '0', borderTop: '1px solid #eee', margin: '10px 0'}}/>

        {/* Leyenda Colores */}
        <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px'}}>
          <div style={{width: 12, height: 12, background: 'rgba(255, 0, 0, 0.5)', border: '2px solid red'}}></div>
          <span style={{fontSize: '12px'}}>Zona Prohibida</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <div style={{width: 12, height: 12, background: 'rgb(0, 150, 255)'}}></div>
          <span style={{fontSize: '12px'}}>Ruta Niño</span>
        </div>
      </div>
    </DeckGL>
  );
}

export default App;