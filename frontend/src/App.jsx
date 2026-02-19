import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PolygonLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// API de Cloud Run (Asegúrate de haber subido la versión de main.py actualizada)
const API_URL = 'http://api-787549761080.europe-west6.run.app'; 

// ⚠️ CONFIRMA QUE ESTE ID ES EL QUE QUIERES SEGUIR
const TARGET_USER_ID = "2"; 
const COLLECTION_NAME = "locations"; 

const INITIAL_VIEW_STATE = {
  longitude: -0.365109, 
  latitude: 39.485569,
  zoom: 13,
  pitch: 0,
  bearing: 0
};

// Zonas estáticas (opcional, lo dejamos por si te sirve de referencia)
const ZONA_ESTATICA = [
  {
    polygon: [
      [-0.3775, 39.4705], [-0.3765, 39.4705],
      [-0.3765, 39.4695], [-0.3775, 39.4695],
      [-0.3775, 39.4705] 
    ]
  }
];

function App() {
  // --- 2. ESTADO ---
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [statusConexion, setStatusConexion] = useState("🟡 Inicializando...");
  const [debugData, setDebugData] = useState("Esperando datos...");

  // Estado de Zonas
  const [zonasSQL, setZonasSQL] = useState([]);
  const [modoAdmin, setModoAdmin] = useState(false);
  const [nuevaZona, setNuevaZona] = useState(null);
  const [radioInput, setRadioInput] = useState(200);

  // --- 3. EFECTOS ---

  // A) Cargar Zonas (API) y Filtrar por TARGET_USER_ID
  useEffect(() => {
    axios.get(`${API_URL}/zones`)
      .then(res => {
        // Filtramos para quedarnos SOLO con las zonas del niño que estamos vigilando ("98")
        const zonasDelUsuario = res.data.filter(
          zona => String(zona.user_id) === String(TARGET_USER_ID)
        );
        
        setZonasSQL(zonasDelUsuario);
        console.log(`Zonas cargadas para el usuario ${TARGET_USER_ID}:`, zonasDelUsuario);
      })
      .catch(err => console.log("Info: API Zonas no disponible o fallo de CORS.", err));
  }, []);

  // B) --- EL CHIVATO DE FIREBASE (Ubicación en tiempo real) ---
  useEffect(() => {
    console.log(`%c🔥 [DEBUG] INICIANDO RASTREO:`, 'color: orange; font-weight: bold; font-size: 14px');
    
    if (!db) {
        console.error("❌ [FATAL] La base de datos 'db' es undefined. Revisa firebase.js");
        setStatusConexion("🔴 Error Config DB");
        return;
    }

    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, TARGET_USER_ID), 
      (docSnapshot) => {
        console.log(`%c📡 [EVENTO] Cambio detectado en Firestore`, 'color: cyan');

        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          
          setDebugData(JSON.stringify(data, null, 2));

          const lat = parseFloat(data.latitude);
          const lng = parseFloat(data.longitude);

          if (isNaN(lat) || isNaN(lng)) {
              console.error("❌ [ERROR DATOS] Latitud o Longitud no son números válidos.");
              setStatusConexion("🔴 Datos Inválidos");
          } else {
              setUbicacionUsuario({
                latitude: lat,
                longitude: lng,
                timestamp: data.timestamp,
                userId: data.user_id
              });
              setStatusConexion("🟢 En Vivo (Datos OK)");
          }
        } else {
          console.warn(`⚠️ [AVISO] El documento con ID "${TARGET_USER_ID}" NO EXISTE.`);
          setDebugData(`Error: Documento ${TARGET_USER_ID} no encontrado.`);
          setStatusConexion("⚪ ID No Encontrado");
        }
      },
      (error) => {
        console.error("💀 [ERROR CRÍTICO FIREBASE]:", error);
        setStatusConexion("🔴 Error Conexión");
      }
    );

    return () => unsubscribe();
  }, []);

  // --- 4. ADMIN ---
  const handleMapClick = (info) => {
    if (!modoAdmin || !info.coordinate) return;
    setNuevaZona({ latitude: info.coordinate[1], longitude: info.coordinate[0], radius: radioInput });
  };

  // --- 5. CAPAS ---
  const layers = [
    // Capa 1: Zonas estáticas (Gris)
    new PolygonLayer({
      id: 'zonas-estaticas',
      data: ZONA_ESTATICA,
      getPolygon: d => d.polygon,
      getFillColor: [100, 100, 100, 50],
      getLineColor: [100, 100, 100, 255],
      getLineWidth: 2,
    }),

    // Capa 2: Zonas Restringidas del Usuario (ROJAS y TAMAÑO DINÁMICO)
    new ScatterplotLayer({
      id: 'zonas-sql',
      data: zonasSQL, // Zonas ya filtradas para el usuario 98
      pickable: true,
      stroked: true,
      filled: true,
      
      // Parseamos coordenadas y radio
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), 
      
      // Indicamos que el radio viene en Metros Reales
      radiusUnits: 'meters', 
      
      // Color Rojo Alerta
      getFillColor: [255, 0, 0, 80], 
      getLineColor: [255, 0, 0, 255], 
      
      // Borde fijo en pantalla para que se vea bien
      lineWidthUnits: 'pixels',
      getLineWidth: 2
    }),

    // Capa 3: EL USUARIO VIVO (TAMAÑO FIJO EN PANTALLA)
    ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo',
      data: [ubicacionUsuario],
      pickable: true,
      stroked: true,
      filled: true,
      getPosition: d => [d.longitude, d.latitude],
      
      // Tamaño fijo en píxeles (No desaparece al hacer zoom)
      radiusUnits: 'pixels',
      getRadius: 8, 

      // Estilo GPS (Azul Google)
      getFillColor: [66, 133, 244, 255], 
      getLineColor: [255, 255, 255, 255], 
      lineWidthUnits: 'pixels',
      getLineWidth: 3,

      // Animación suave
      transitions: {
        getPosition: 1000 
      },

      // Forzar repintado si cambian coordenadas
      updateTriggers: {
        getPosition: [ubicacionUsuario.latitude, ubicacionUsuario.longitude]
      }
    }),

    // Capa 4: Preview de nueva zona (Verde)
    nuevaZona && new ScatterplotLayer({
      id: 'zona-preview',
      data: [nuevaZona],
      radiusScale: 1,
      getPosition: d => [d.longitude, d.latitude],
      getRadius: d => d.radius,
      getFillColor: [0, 255, 0, 80],
      getLineColor: [0, 255, 0, 255],
      getLineWidth: 2
    })
  ].filter(Boolean);

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      onClick={handleMapClick}
      getCursor={() => modoAdmin ? 'crosshair' : 'grab'}
    >
      <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/light-v11" />
      
      {/* --- PANEL DE DEBUGGING --- */}
      <div style={{
        position: 'absolute', top: 20, left: 20, 
        background: 'rgba(0,0,0,0.8)', color: '#0f0', 
        padding: 15, borderRadius: 8, 
        fontFamily: 'monospace', fontSize: 12, minWidth: 300,
        border: '1px solid #0f0'
      }}>
        <h3 style={{margin: '0 0 10px 0', color: 'white'}}>🐞 PANEL DE DEBUG</h3>
        
        <div style={{marginBottom: 5}}>Estado: <b>{statusConexion}</b></div>
        <div style={{marginBottom: 5}}>BD Objetivo: <b>location-db</b></div>
        <div style={{marginBottom: 5}}>ID Buscado: <b>{TARGET_USER_ID}</b></div>
        
        <hr style={{borderColor: '#333'}}/>
        
        <div style={{whiteSpace: 'pre-wrap', wordBreak: 'break-all'}}>
            {debugData}
        </div>
      </div>
    </DeckGL>
  );
}

export default App;