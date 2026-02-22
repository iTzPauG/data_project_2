import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PolygonLayer, PathLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import 'mapbox-gl/dist/mapbox-gl.css';

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API_URL = import.meta.env.VITE_API_URL;
const TARGET_USER_ID = "94"; 
const COLLECTION_NAME = "locations";

const INITIAL_VIEW_STATE = { longitude: -0.376288, latitude: 39.469907, zoom: 14, pitch: 45, bearing: 0 };

// Función para obtener la fecha de ayer por defecto (Formato YYYY-MM-DD)
const getYesterdayDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

export default function App() {
  // --- 2. ESTADOS ---
  const [mapReady, setMapReady] = useState(false);
  const [activeView, setActiveView] = useState('live'); // 'live' o 'history'
  
  // Estado Niños
  const [kids, setKids] = useState([]); 
  const [selectedKidTag, setSelectedKidTag] = useState(null); 

  // Estados Datos y Cámara (En vivo)
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [zonasSQL, setZonasSQL] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [haCentradoInicial, setHaCentradoInicial] = useState(false);

  // Estados Historial (BigQuery)
  const [historyDate, setHistoryDate] = useState(getYesterdayDate());
  const [historyStartTime, setHistoryStartTime] = useState("08:00");
  const [historyEndTime, setHistoryEndTime] = useState("20:00");
  const [historyRoute, setHistoryRoute] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Estados Pop-Ups
  const [showKidModal, setShowKidModal] = useState(false);
  const [kidName, setKidName] = useState("");
  const [deviceTag, setDeviceTag] = useState(""); 
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [miniMapViewState, setMiniMapViewState] = useState(INITIAL_VIEW_STATE);
  const [nuevaZona, setNuevaZona] = useState({ latitude: null, longitude: null, radius: 50, tag_id: "" });

  // --- 3. EFECTOS ---
  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (kids.length > 0 && !selectedKidTag) {
      setSelectedKidTag(kids[0].tag_id);
    }
  }, [kids]);

  // Firebase Listener (Solo actúa si estamos en la vista 'live')
  useEffect(() => {    
    if (!db || !selectedKidTag || activeView !== 'live') return;

    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, TARGET_USER_ID), 
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          const lat = parseFloat(data.latitude);
          const lng = parseFloat(data.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
              setUbicacionUsuario({ latitude: lat, longitude: lng, timestamp: data.timestamp, userId: data.user_id });

              if (!haCentradoInicial) {
                setViewState({ longitude: lng, latitude: lat, zoom: 16, pitch: 45, bearing: 0, transitionDuration: 2000 });
                setHaCentradoInicial(true); 
              }
          }
        }
      },
      (error) => console.error("Error Firebase:", error)
    );

    return () => unsubscribe();
  }, [selectedKidTag, haCentradoInicial, activeView]);

  // --- 4. MANEJADORES ---

  const handleSaveKid = () => { /* Igual que antes */ };
  const handleMiniMapClick = (info) => { /* Igual que antes */ };
  const handleSaveZone = () => { /* Igual que antes */ };
  const handleZoomIn = () => { setViewState(prev => ({ ...prev, zoom: prev.zoom + 1, transitionDuration: 300 })); };
  const handleZoomOut = () => { setViewState(prev => ({ ...prev, zoom: prev.zoom - 1, transitionDuration: 300 })); };

  // BUSCAR HISTORIAL EN BIGQUERY
  const handleSearchHistory = async () => {
    if (!selectedKidTag) {
      alert("Selecciona un niño primero arriba a la izquierda.");
      return;
    }

    setIsLoadingHistory(true);
    // Formateamos las fechas al estilo ISO (UTC o Local, según tu preferencia)
    // Ejemplo: 2026-02-21T08:00:00Z
    const startIso = new Date(`${historyDate}T${historyStartTime}:00`).toISOString();
    const endIso = new Date(`${historyDate}T${historyEndTime}:00`).toISOString();

    try {
      const response = await axios.get(`${API_URL}/history/${selectedKidTag}`, {
        params: { start_time: startIso, end_time: endIso }
      });

      if (response.data.path && response.data.path.length > 0) {
        setHistoryRoute({ path: response.data.path });
        
        // Centrar la cámara en el primer punto de la ruta
        setViewState({ 
          longitude: response.data.path[0][0], 
          latitude: response.data.path[0][1], 
          zoom: 15, pitch: 45, bearing: 0, transitionDuration: 1500 
        });
      } else {
        alert("No se han encontrado movimientos en ese rango de horas.");
        setHistoryRoute(null);
      }
    } catch (error) {
      console.error("Error buscando historial:", error);
      alert("Fallo al conectar con BigQuery.");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // --- 5. CAPAS MAPA PRINCIPAL ---
  const zonasFiltradas = zonasSQL.filter(z => String(z.tag_id) === String(selectedKidTag));

  const mainLayers = [
    // Zonas del niño
    new ScatterplotLayer({
      id: 'zonas-sql', data: zonasFiltradas, pickable: true, stroked: true, filled: true,
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), radiusUnits: 'meters', 
      getFillColor: [255, 0, 0, 80], getLineColor: [255, 0, 0, 255], getLineWidth: 2
    }),
    
    // Capa En Vivo (Solo se muestra si la vista es 'live')
    activeView === 'live' && ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo', data: [ubicacionUsuario], pickable: true, stroked: true, filled: true,
      getPosition: d => [d.longitude, d.latitude], radiusUnits: 'pixels', getRadius: 8, 
      getFillColor: [66, 133, 244, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3,
      transitions: { getPosition: 1000 }, updateTriggers: { getPosition: [ubicacionUsuario.latitude, ubicacionUsuario.longitude] }
    }),

    // Capa Historial (Ruta continua, solo se muestra si la vista es 'history' y hay datos)
    activeView === 'history' && historyRoute && new PathLayer({
      id: 'history-path',
      data: [historyRoute],
      pickable: true,
      widthScale: 1,
      widthMinPixels: 4,
      getPath: d => d.path, // Array de coordenadas [ [lon, lat], [lon, lat] ]
      getColor: [59, 130, 246, 200], // Azul semitransparente bonito
      getWidth: 5
    })
  ].filter(Boolean);

  // --- 6. ESTILOS ---
  // (Mismos estilos básicos, he añadido los de los inputs de fecha)
  const appContainerStyle = { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#212529', overflow: 'hidden' };
  const sidebarStyle = { width: '320px', display: 'flex', flexDirection: 'column', padding: '30px 20px', boxSizing: 'border-box', overflowY: 'auto' };
  const mapWrapperStyle = { flex: 1, position: 'relative', margin: '20px 20px 20px 0', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', backgroundColor: '#343a40' };
  
  const buttonStyle = { padding: '15px 20px', margin: '0 0 15px 0', backgroundColor: '#343a40', border: '1px solid #495057', borderRadius: '12px', color: '#f8f9fa', fontSize: '16px', fontWeight: '600', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s ease', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' };
  const activeButtonStyle = { ...buttonStyle, backgroundColor: '#3b82f6', borderColor: '#2563eb' }; // Azul para el activo

  const inputStyle = { width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #495057', backgroundColor: '#343a40', color: '#fff', fontSize: '16px', boxSizing: 'border-box', outline: 'none' };
  const dateInputStyle = { ...inputStyle, cursor: 'pointer', colorScheme: 'dark' };

  const zoomControlStyle = { position: 'absolute', bottom: '30px', right: '30px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 10 };
  const zoomButtonStyle = { width: '45px', height: '45px', backgroundColor: '#343a40', color: '#f8f9fa', border: '1px solid #495057', borderRadius: '12px', fontSize: '24px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' };

  return (
    <div style={appContainerStyle}>
      {/* ... [Los Pop-Ups showKidModal y showZoneModal siguen igual, ocultos por brevedad visual aquí, déjalos como los tenías si ya no los tocas] ... */}

      {/* --- BARRA LATERAL (SIDEBAR) --- */}
      <div style={sidebarStyle}>
        <h2 style={{ margin: '0 0 30px 0', color: '#f8f9fa', fontSize: '24px' }}>Panel de Control</h2>
        
        {/* Pestañas Principales */}
        <button 
          style={activeView === 'live' ? activeButtonStyle : buttonStyle} 
          onClick={() => setActiveView('live')}
        >
          📍 En Vivo
        </button>
        <button 
          style={activeView === 'history' ? activeButtonStyle : buttonStyle} 
          onClick={() => setActiveView('history')}
        >
          🕒 Historial
        </button>

        <hr style={{ border: 'none', borderTop: '1px solid #495057', margin: '15px 0 25px 0', width: '100%' }} />

        {/* CONTROLES CONDICIONALES SEGÚN LA PESTAÑA */}
        {activeView === 'live' ? (
          <>
            <button style={buttonStyle}>👤 Mi Perfil</button>
            <button style={buttonStyle} onClick={() => setShowKidModal(true)}>👶 Añadir Niño</button>
            <button style={buttonStyle} onClick={() => setShowZoneModal(true)}>🛑 Añadir Ubicación Restringida</button>
          </>
        ) : (
          <div style={{ padding: '10px', backgroundColor: '#2b3035', borderRadius: '12px', border: '1px solid #495057' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#adb5bd', fontSize: '16px' }}>Consultar Ruta</h3>
            
            <label style={{ color: '#adb5bd', fontSize: '14px', marginBottom: '5px', display: 'block' }}>Fecha:</label>
            <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} style={dateInputStyle} />
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#adb5bd', fontSize: '14px', marginBottom: '5px', display: 'block' }}>Inicio:</label>
                <input type="time" value={historyStartTime} onChange={e => setHistoryStartTime(e.target.value)} style={dateInputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ color: '#adb5bd', fontSize: '14px', marginBottom: '5px', display: 'block' }}>Fin:</label>
                <input type="time" value={historyEndTime} onChange={e => setHistoryEndTime(e.target.value)} style={dateInputStyle} />
              </div>
            </div>

            <button 
              onClick={handleSearchHistory} 
              disabled={isLoadingHistory}
              style={{ ...buttonStyle, width: '100%', backgroundColor: '#10b981', borderColor: '#059669', textAlign: 'center', marginTop: '10px' }}
            >
              {isLoadingHistory ? 'Cargando...' : '🔍 Buscar Ruta'}
            </button>
          </div>
        )}
      </div>

      {/* --- CONTENEDOR DEL MAPA PRINCIPAL --- */}
      <div style={mapWrapperStyle}>
        {/* SELECTOR DE NIÑOS */}
        <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '10px' }}>
          {kids.map(kid => (
            <button key={kid.tag_id} onClick={() => { setSelectedKidTag(kid.tag_id); setHistoryRoute(null); }} style={{ padding: '10px 20px', borderRadius: '25px', border: 'none', fontWeight: 'bold', cursor: 'pointer', backgroundColor: selectedKidTag === kid.tag_id ? '#3b82f6' : '#212529', color: 'white', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', transition: 'background 0.2s' }}>{kid.name}</button>
          ))}
          {kids.length === 0 && <div style={{ padding: '10px 20px', borderRadius: '25px', backgroundColor: '#212529', color: '#adb5bd', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>Añade un niño para empezar</div>}
        </div>

        {/* CONTROLES DE ZOOM */}
        <div style={zoomControlStyle}>
          <button style={zoomButtonStyle} onClick={handleZoomIn}>+</button>
          <button style={zoomButtonStyle} onClick={handleZoomOut}>-</button>
        </div>

        {mapReady && (
          <DeckGL viewState={viewState} onViewStateChange={e => setViewState(e.viewState)} controller={true} layers={mainLayers}>
            <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
          </DeckGL>
        )}
      </div>
    </div>
  );
}