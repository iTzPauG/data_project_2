import React, { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PolygonLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import 'mapbox-gl/dist/mapbox-gl.css';

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// API de Cloud Run
const API_URL = 'https://api-787549761080.europe-west6.run.app'; 

// ⚠️ CAMBIADO A 98 PARA QUE APAREZCAN LAS ZONAS
const TARGET_USER_ID = "94"; 
const COLLECTION_NAME = "locations"; 

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

export default function App() {
  // --- 2. ESTADO ---
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [statusConexion, setStatusConexion] = useState("🟡 Inicializando...");
  const [debugData, setDebugData] = useState("Esperando datos...");
  
  // Estado para evitar el crasheo de WebGL al inicio
  const [mapReady, setMapReady] = useState(false);

  // Estado de Zonas
  const [zonasSQL, setZonasSQL] = useState([]);
  const [modoAdmin, setModoAdmin] = useState(false);
  const [nuevaZona, setNuevaZona] = useState(null);
  const [radioInput, setRadioInput] = useState(200);

  // --- 3. EFECTOS ---

  // A) Retraso mínimo para que el DOM tenga tamaño antes de cargar WebGL
  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/zones`)
      .then(res => {
        // 🔥 AÑADE ESTO: Vamos a ver qué trae toda la base de datos
        console.log("Datos crudos de la API:", res.data); 

        const zonasDelUsuario = res.data.filter(
          zona => String(zona.user_id) === String(TARGET_USER_ID)
        );
        
        setZonasSQL(zonasDelUsuario);
        console.log(`Zonas cargadas para el usuario ${TARGET_USER_ID}:`, zonasDelUsuario);
      })
      .catch(err => console.log("Info: API Zonas no disponible o fallo de CORS.", err));
  }, []);

  // C) --- EL CHIVATO DE FIREBASE (Ubicación en tiempo real) ---
  useEffect(() => {    
    if (!db) {
        console.error("❌ [FATAL] La base de datos 'db' es undefined. Revisa firebase.js");
        setStatusConexion("🔴 Error Config DB");
        return;
    }

    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, TARGET_USER_ID), 
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setDebugData(JSON.stringify(data, null, 2));

          const lat = parseFloat(data.latitude);
          const lng = parseFloat(data.longitude);

          if (isNaN(lat) || isNaN(lng)) {
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
    // Capa 1: Zonas Prohibidas (Estática)
    new PolygonLayer({
      id: 'zonas-estaticas',
      data: ZONA_ESTATICA,
      getPolygon: d => d.polygon,
      getFillColor: [100, 100, 100, 50],
      getLineColor: [100, 100, 100, 255],
      getLineWidth: 2,
    }),

    new ScatterplotLayer({
      id: 'zonas-sql',
      data: zonasSQL,
      pickable: true,
      stroked: true,
      filled: true,
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), 
      radiusUnits: 'meters', 
      getFillColor: [255, 0, 0, 80], 
      getLineColor: [255, 0, 0, 255], 
      lineWidthUnits: 'pixels',
      getLineWidth: 2
    }),

    ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo',
      data: [ubicacionUsuario],
      pickable: true,
      stroked: true,
      filled: true,
      getPosition: d => [d.longitude, d.latitude],
      radiusUnits: 'pixels',
      getRadius: 8, 
      getFillColor: [66, 133, 244, 255], 
      getLineColor: [255, 255, 255, 255], 
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      transitions: {
        getPosition: 1000 
      },
      updateTriggers: {
        getPosition: [ubicacionUsuario.latitude, ubicacionUsuario.longitude]
      }
    }),

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
    // ESTE DIV ES VITAL PARA QUE NO FALLE WEBGL
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      
      {/* Solo renderiza si mapReady es true, dando tiempo al navegador a calcular el 100vw/100vh */}
      {mapReady && (
        <DeckGL
          initialViewState={INITIAL_VIEW_STATE}
          controller={true}
          layers={layers}
          onClick={handleMapClick}
          getCursor={() => modoAdmin ? 'crosshair' : 'grab'}
        >
          <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/light-v11" />
          
          <div style={{
            position: 'absolute', top: 20, left: 20, 
            background: 'rgba(0,0,0,0.8)', color: '#0f0', 
            padding: 15, borderRadius: 8, 
            fontFamily: 'monospace', fontSize: 12, minWidth: 300,
            border: '1px solid #0f0',
            zIndex: 1000 
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
      )}
    </div>
  );
}
