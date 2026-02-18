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

// Tu API en Cloud Run (Para gestionar Zonas SQL)
const API_URL = 'http://api-787549761080.europe-west6.run.app';

// Configuración de Rastreamento
const TARGET_USER_ID = "85"; // El usuario que quieres seguir
const COLLECTION_NAME = "locations"; // Colección en Firestore

const INITIAL_VIEW_STATE = {
  longitude: -0.365109, 
  latitude: 39.485569,
  zoom: 14,
  pitch: 0, // Vista cenital (mejor para ver puntos)
  bearing: 0
};

// (Opcional) Zonas estáticas hardcoded
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
  
  // Estado del Usuario (Tiempo Real Firestore)
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [statusConexion, setStatusConexion] = useState("🟡 Conectando a Firestore...");

  // Estado de Zonas (Admin / Cloud SQL)
  const [zonasSQL, setZonasSQL] = useState([]);
  const [modoAdmin, setModoAdmin] = useState(false);
  const [nuevaZona, setNuevaZona] = useState(null);
  const [radioInput, setRadioInput] = useState(200);

  // --- 3. EFECTOS ---

  // A) Cargar Zonas desde tu API (Cloud SQL)
  useEffect(() => {
    axios.get(`${API_URL}/zones`)
      .then(res => {
        console.log("Zonas cargadas:", res.data);
        setZonasSQL(res.data);
      })
      .catch(err => console.error("Error cargando zonas SQL:", err));
  }, []);

  // B) Conexión Tiempo Real con Firestore
  useEffect(() => {
    console.log(`📡 Escuchando BD: location-db | Colección: ${COLLECTION_NAME} | Doc: ${TARGET_USER_ID}`);
    
    // onSnapshot crea una conexión permanente y recibe actualizaciones solas
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, TARGET_USER_ID), 
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          // console.log("🔥 Dato recibido:", data); 
          
          setUbicacionUsuario({
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: data.timestamp,
            updatedAt: data.updated_at,
            userId: data.user_id
          });
          setStatusConexion("🟢 En Vivo");
        } else {
          console.warn("⚠️ No existe el documento. Verifica ID o Colección.");
          setStatusConexion("⚪ Esperando datos...");
        }
      },
      (error) => {
        console.error("❌ Error Firestore:", error);
        setStatusConexion("🔴 Error Conexión");
      }
    );

    // Limpieza al desmontar el componente
    return () => unsubscribe();
  }, []);

  // --- 4. MANEJADORES DE EVENTOS (ADMIN) ---

  const handleMapClick = (info) => {
    if (!modoAdmin || !info.coordinate) return;
    setNuevaZona({
      latitude: info.coordinate[1],
      longitude: info.coordinate[0],
      radius: radioInput
    });
  };

  const guardarZona = async () => {
    if (!nuevaZona) return;
    try {
      // POST a tu API Python -> Guarda en SQL
      const response = await axios.post(`${API_URL}/zone`, {
        user_id: "admin-dashboard",
        latitude: nuevaZona.latitude,
        longitude: nuevaZona.longitude,
        radius: nuevaZona.radius
      });

      // Añadimos visualmente la zona confirmada
      const zonaConfirmada = {
        ...nuevaZona,
        id: response.data.db_id
      };
      
      setZonasSQL(prev => [...prev, zonaConfirmada]);
      setNuevaZona(null);
      alert("Zona guardada correctamente");
    } catch (e) {
      console.error("Error guardando zona:", e);
      alert("Error al guardar zona en el servidor");
    }
  };

  // --- 5. CAPAS DECK.GL ---
  const layers = [
    // Capa 1: Zonas Estáticas
    new PolygonLayer({
      id: 'zonas-estaticas',
      data: ZONA_ESTATICA,
      getPolygon: d => d.polygon,
      getFillColor: [100, 100, 100, 50],
      getLineColor: [100, 100, 100, 255],
      getLineWidth: 2,
    }),

    // Capa 2: Zonas SQL (Círculos Rojos)
    new ScatterplotLayer({
      id: 'zonas-sql',
      data: zonasSQL,
      pickable: true,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 2,
      getPosition: d => [d.longitude, d.latitude],
      getRadius: d => d.radius,
      getFillColor: [255, 0, 0, 40], // Rojo transparente
      getLineColor: [255, 0, 0, 255], // Borde rojo
      getLineWidth: 2
    }),

    // Capa 3: Ubicación Usuario (Punto Azul Brillante)
    ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo',
      data: [ubicacionUsuario], // DeckGL necesita un array
      pickable: true,
      stroked: true,
      filled: true,
      radiusScale: 1,
      radiusMinPixels: 6,
      radiusMaxPixels: 20,
      getPosition: d => [d.longitude, d.latitude],
      getRadius: 40, // Radio visual en metros
      getFillColor: [0, 120, 255, 200], // Azul
      getLineColor: [255, 255, 255, 255], // Borde blanco
      getLineWidth: 3,
      // Animación suave de movimiento
      transitions: {
        getPosition: 1000 // 1 segundo de transición suave entre puntos
      }
    }),

    // Capa 4: Preview Nueva Zona (Verde)
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
      
      {/* UI IZQUIERDA: INFORMACIÓN USUARIO */}
      <div style={{
        position: 'absolute', top: 20, left: 20, 
        background: 'white', padding: 15, borderRadius: 8, 
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'sans-serif', minWidth: 200
      }}>
        <h3 style={{margin: '0 0 10px 0', fontSize: 16}}>Rastreo: Usuario {TARGET_USER_ID}</h3>
        
        <div style={{fontWeight: 'bold', color: statusConexion.includes("Vivo")?'green':'orange', marginBottom: 10}}>
          {statusConexion}
        </div>

        {ubicacionUsuario ? (
          <div style={{fontSize: 12, color: '#333'}}>
            <div style={{marginBottom: 4}}>📅 <b>Última Señal:</b><br/>{new Date(ubicacionUsuario.timestamp).toLocaleTimeString()}</div>
            <div style={{marginBottom: 4}}>🌍 <b>Lat:</b> {ubicacionUsuario.latitude.toFixed(5)}</div>
            <div>🌍 <b>Lng:</b> {ubicacionUsuario.longitude.toFixed(5)}</div>
          </div>
        ) : (
          <div style={{fontSize: 12, color: '#999'}}>Esperando primera señal...</div>
        )}

        <hr style={{margin: '10px 0', border: 0, borderTop: '1px solid #eee'}}/>
        <div style={{fontSize: 12}}>🛡️ Zonas Activas: {zonasSQL.length}</div>
      </div>

      {/* UI DERECHA: ADMIN ZONAS */}
      <div style={{
        position: 'absolute', top: 20, right: 20, 
        background: 'white', padding: 15, borderRadius: 8, 
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontFamily: 'sans-serif', width: 250
      }}>
        <h3 style={{margin: '0 0 10px 0', fontSize: 16}}>Gestión Zonas</h3>
        
        <label style={{display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 10, fontSize: 14}}>
          <input 
            type="checkbox" 
            checked={modoAdmin} 
            onChange={e => { setModoAdmin(e.target.checked); setNuevaZona(null); }} 
            style={{marginRight: 8}}
          /> 
          Activar Creación
        </label>

        {modoAdmin && (
          <div style={{background: '#f5f5f5', padding: 10, borderRadius: 5, border: '1px solid #eee'}}>
            <p style={{fontSize: 11, margin: '0 0 10px 0', color: '#666'}}>
              Haz clic en el mapa para definir el centro de la zona.
            </p>
            
            <label style={{fontSize: 12, display: 'block', marginBottom: 5}}>Radio: <b>{radioInput}m</b></label>
            <input 
              type="range" min="50" max="1000" step="50" 
              value={radioInput} 
              style={{width: '100%', marginBottom: 10}}
              onChange={e => {
                const r = Number(e.target.value);
                setRadioInput(r);
                if (nuevaZona) setNuevaZona({...nuevaZona, radius: r});
              }}
            />
            
            <div style={{display: 'flex', gap: 5}}>
              <button 
                onClick={guardarZona}
                disabled={!nuevaZona}
                style={{
                  flex: 1, padding: 8, borderRadius: 4, border: 'none', 
                  background: nuevaZona ? '#2196F3' : '#e0e0e0', 
                  color: nuevaZona ? 'white' : '#999', 
                  cursor: nuevaZona ? 'pointer' : 'default'
                }}
              >
                Guardar
              </button>
              {nuevaZona && (
                <button 
                  onClick={() => setNuevaZona(null)} 
                  style={{padding: '8px 12px', borderRadius: 4, border: 'none', background: '#FF5252', color: 'white', cursor: 'pointer'}}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </DeckGL>
  );
}

export default App;