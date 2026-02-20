import React, { useState, useEffect } from 'react';
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
<<<<<<< Updated upstream

// API de Cloud Run
const API_URL = 'https://api-787549761080.europe-west6.run.app'; 

// ⚠️ CAMBIADO A 98 PARA QUE APAREZCAN LAS ZONAS
const TARGET_USER_ID = "94"; 
const COLLECTION_NAME = "locations"; 

const INITIAL_VIEW_STATE = {
  longitude: -0.365109, 
  latitude: 39.485569,
  zoom: 13,
  pitch: 0,
=======
const API_URL = import.meta.env.VITE_API_URL;
const TARGET_USER_ID = "94"; // ID del padre
const COLLECTION_NAME = "locations";

const INITIAL_VIEW_STATE = {
  longitude: -0.376288, 
  latitude: 39.469907,
  zoom: 14,
  pitch: 45,
>>>>>>> Stashed changes
  bearing: 0
};

// Zonas estáticas (opcional)
const ZONA_ESTATICA = [
  {
    polygon: [
      [-0.3775, 39.4705], [-0.3765, 39.4705],
      [-0.3765, 39.4695], [-0.3775, 39.4695],
      [-0.3775, 39.4705] 
    ]
  }
];

export default function App() {
  // --- 2. ESTADO BASE ---
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [zonasSQL, setZonasSQL] = useState([]);
  
  // Estado Control de Cámara
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [haCentradoInicial, setHaCentradoInicial] = useState(false);

  // Estado Admin (Zonas)
  const [modoAdmin, setModoAdmin] = useState(false);
  const [nuevaZona, setNuevaZona] = useState(null);
  const [radioInput, setRadioInput] = useState(200);

  // NUEVO: Estado Pop-Up Añadir Niño
  const [showKidModal, setShowKidModal] = useState(false);
  const [kidName, setKidName] = useState("");
  const [deviceTag, setDeviceTag] = useState(""); // <-- NUEVO CAMPO

  // --- 3. EFECTOS ---
  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/zones`)
      .then(res => {
        const zonasDelUsuario = res.data.filter(
          zona => String(zona.user_id) === String(TARGET_USER_ID)
        );
        setZonasSQL(zonasDelUsuario);
      })
      .catch(err => console.log("Info: API Zonas no disponible o fallo de CORS.", err));
  }, []);

  // Firebase Listener
  useEffect(() => {    
    if (!db) return;

    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, TARGET_USER_ID), 
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          const lat = parseFloat(data.latitude);
          const lng = parseFloat(data.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
              setUbicacionUsuario({
                latitude: lat,
                longitude: lng,
                timestamp: data.timestamp,
                userId: data.user_id
              });

              if (!haCentradoInicial) {
                setViewState({
                  longitude: lng,
                  latitude: lat,
                  zoom: 16, 
                  pitch: 45,
                  bearing: 0,
                  transitionDuration: 2000 
                });
                setHaCentradoInicial(true); 
              }
          }
        }
      },
      (error) => console.error("Error Firebase:", error)
    );

    return () => unsubscribe();
  }, [haCentradoInicial]);

  // --- 4. MANEJADORES (HANDLERS) ---
  const handleMapClick = (info) => {
    if (!modoAdmin || !info.coordinate) return;
    setNuevaZona({ latitude: info.coordinate[1], longitude: info.coordinate[0], radius: radioInput });
  };

  const handleSaveKid = () => {
    if (!kidName.trim()) return;
    
    // Objeto listo con el nuevo campo Tag
    console.log("🛠️ Preparado para enviar a la API:", {
      nombre: kidName,
      tag_dispositivo: deviceTag, // <-- SE ENVÍA EL TAG
      user_id: TARGET_USER_ID 
    });

    // Limpiamos y cerramos
    setKidName("");
    setDeviceTag("");
    setShowKidModal(false);
  };

  const handleCloseModal = () => {
    setKidName("");
    setDeviceTag("");
    setShowKidModal(false);
  };

  // --- 5. CAPAS ---
  const layers = [
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
      transitions: { getPosition: 1000 },
      updateTriggers: { getPosition: [ubicacionUsuario.latitude, ubicacionUsuario.longitude] }
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

  // --- 6. ESTILOS ---
  const appContainerStyle = {
    display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#212529', overflow: 'hidden'
  };
  const sidebarStyle = {
    width: '320px', display: 'flex', flexDirection: 'column', padding: '30px 20px', boxSizing: 'border-box'
  };
  const mapWrapperStyle = {
    flex: 1, position: 'relative', margin: '20px 20px 20px 0', borderRadius: '24px', 
    overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', backgroundColor: '#343a40' 
  };
  const titleStyle = { margin: '0 0 30px 0', color: '#f8f9fa', fontSize: '24px', fontWeight: 'bold', fontFamily: 'sans-serif' };
  const buttonStyle = {
    padding: '15px 20px', margin: '0 0 15px 0', backgroundColor: '#343a40', border: '1px solid #495057',
    borderRadius: '12px', color: '#f8f9fa', fontSize: '16px', fontWeight: '600', cursor: 'pointer',
    textAlign: 'left', transition: 'all 0.2s ease', boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
  };

  // Estilos del Modal (Pop-Up)
  const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(5px)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
  };
  const modalContentStyle = {
    backgroundColor: '#212529', padding: '30px', borderRadius: '16px',
    width: '400px', boxShadow: '0 15px 40px rgba(0,0,0,0.5)', color: '#f8f9fa',
    fontFamily: 'sans-serif', border: '1px solid #495057'
  };
  const inputStyle = {
    width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '8px',
    border: '1px solid #495057', backgroundColor: '#343a40', color: '#fff',
    fontSize: '16px', boxSizing: 'border-box', outline: 'none'
  };

  return (
    <div style={appContainerStyle}>
      
      {/* --- POP-UP AÑADIR NIÑO --- */}
      {showKidModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <h3 style={{ marginTop: 0 }}>Registrar Nuevo Niño</h3>
            <p style={{ color: '#adb5bd', fontSize: '14px', lineHeight: '1.5', marginBottom: '20px' }}>
              Introduce los datos del menor. Se vinculará a tu cuenta automáticamente para que puedas rastrear su ubicación.
            </p>
            
            <input 
              type="text" 
              placeholder="Nombre (Ej: María)" 
              value={kidName}
              onChange={(e) => setKidName(e.target.value)}
              style={inputStyle}
              autoFocus
            />

            <input 
              type="text" 
              placeholder="Tag del dispositivo (Ej: Reloj-001)" 
              value={deviceTag}
              onChange={(e) => setDeviceTag(e.target.value)}
              style={inputStyle}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button 
                onClick={handleCloseModal}
                style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none' }}
                onMouseEnter={e => e.target.style.color = '#adb5bd'} 
                onMouseLeave={e => e.target.style.color = '#f8f9fa'}
              >
                Cancelar
              </button>
              <button 
                onClick={handleSaveKid}
                style={{ ...buttonStyle, margin: 0, backgroundColor: '#3b82f6', borderColor: '#2563eb', textAlign: 'center' }}
                onMouseEnter={e => e.target.style.backgroundColor = '#2563eb'} 
                onMouseLeave={e => e.target.style.backgroundColor = '#3b82f6'}
              >
                Guardar Niño
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- BARRA LATERAL (SIDEBAR) --- */}
      <div style={sidebarStyle}>
        <h2 style={titleStyle}>Panel de Control</h2>
        
        <button 
          style={buttonStyle} 
          onMouseEnter={e => e.target.style.backgroundColor = '#495057'} 
          onMouseLeave={e => e.target.style.backgroundColor = '#343a40'} 
        >
          👤 Mi Perfil
        </button>

        <button 
          style={buttonStyle}
          onMouseEnter={e => e.target.style.backgroundColor = '#495057'} 
          onMouseLeave={e => e.target.style.backgroundColor = '#343a40'}
        >
          🕒 Historial
        </button>

        <button 
          style={buttonStyle}
          onMouseEnter={e => e.target.style.backgroundColor = '#495057'} 
          onMouseLeave={e => e.target.style.backgroundColor = '#343a40'}
          onClick={() => setShowKidModal(true)} // ABRIR EL MODAL
        >
          👶 Añadir Niño
        </button>

        <button 
          style={{
            ...buttonStyle, 
            backgroundColor: modoAdmin ? '#dc2626' : '#343a40', 
            borderColor: modoAdmin ? '#b91c1c' : '#495057'
          }}
          onMouseEnter={e => {if(!modoAdmin) e.target.style.backgroundColor = '#495057'}} 
          onMouseLeave={e => {if(!modoAdmin) e.target.style.backgroundColor = '#343a40'}}
          onClick={() => setModoAdmin(!modoAdmin)}
        >
          🛑 {modoAdmin ? 'Cancelar Añadir Ubicación' : 'Añadir Ubicación Restringida'}
        </button>
      </div>

      {/* --- CONTENEDOR DEL MAPA --- */}
      <div style={mapWrapperStyle}>
        {mapReady && (
          <DeckGL
            viewState={viewState} 
            onViewStateChange={e => setViewState(e.viewState)} 
            controller={true}
            layers={layers}
            onClick={handleMapClick}
            getCursor={() => modoAdmin ? 'crosshair' : 'grab'}
          >
            <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
          </DeckGL>
        )}
      </div>
      
    </div>
  );
}   