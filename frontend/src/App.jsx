import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import 'mapbox-gl/dist/mapbox-gl.css';

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API_URL = import.meta.env.VITE_API_URL;
const TARGET_USER_ID = "94"; // ID del padre
const COLLECTION_NAME = "locations";

const INITIAL_VIEW_STATE = { longitude: -0.376288, latitude: 39.469907, zoom: 14, pitch: 45, bearing: 0 };

export default function App() {
  // --- 2. ESTADOS ---
  const [mapReady, setMapReady] = useState(false);
  
  // Estado Niños
  const [kids, setKids] = useState([]); 
  const [selectedKidTag, setSelectedKidTag] = useState(null); 

  // Estados Datos y Cámara
  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [zonasSQL, setZonasSQL] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [haCentradoInicial, setHaCentradoInicial] = useState(false);

  // Estados Pop-Up Añadir Niño
  const [showKidModal, setShowKidModal] = useState(false);
  const [kidName, setKidName] = useState("");
  const [deviceTag, setDeviceTag] = useState(""); 

  // Estados Pop-Up Añadir Zona (Mini-Mapa)
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [miniMapViewState, setMiniMapViewState] = useState(INITIAL_VIEW_STATE);
  // MODIFICADO: Radio por defecto a 50 metros
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

  useEffect(() => {    
    if (!db || !selectedKidTag) return;

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
  }, [selectedKidTag, haCentradoInicial]);

  // --- 4. MANEJADORES ---

  const handleSaveKid = () => {
    if (!kidName.trim() || !deviceTag.trim()) return;
    const newKid = { name: kidName, tag_id: deviceTag };
    setKids([...kids, newKid]); 
    console.log("🛠️ Enviar Niño a API:", { nombre: kidName, tag_id: deviceTag, user_id: TARGET_USER_ID });
    setKidName(""); setDeviceTag(""); setShowKidModal(false);
  };

  const handleMiniMapClick = (info) => {
    if (info.coordinate) {
      setNuevaZona({ ...nuevaZona, latitude: info.coordinate[1], longitude: info.coordinate[0] });
    }
  };

  const handleSaveZone = () => {
    if (!nuevaZona.latitude || !nuevaZona.tag_id) {
      alert("Por favor, selecciona un punto en el mapa y asigna un niño.");
      return;
    }
    
    console.log("🛠️ Enviar Zona a API:", {
      tag_id: nuevaZona.tag_id,
      latitude: nuevaZona.latitude,
      longitude: nuevaZona.longitude,
      radius: nuevaZona.radius
    });

    setZonasSQL([...zonasSQL, { ...nuevaZona, user_id: TARGET_USER_ID }]);
    // MODIFICADO: Vuelve a 50 metros tras guardar
    setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "" });
    setShowZoneModal(false);
  };

  // --- 5. CAPAS MAPA PRINCIPAL ---
  const zonasFiltradas = zonasSQL.filter(z => String(z.tag_id) === String(selectedKidTag));

  const mainLayers = [
    new ScatterplotLayer({
      id: 'zonas-sql', data: zonasFiltradas, pickable: true, stroked: true, filled: true,
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), radiusUnits: 'meters', 
      getFillColor: [255, 0, 0, 80], getLineColor: [255, 0, 0, 255], getLineWidth: 2
    }),
    ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo', data: [ubicacionUsuario], pickable: true, stroked: true, filled: true,
      getPosition: d => [d.longitude, d.latitude], radiusUnits: 'pixels', getRadius: 8, 
      getFillColor: [66, 133, 244, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3,
      transitions: { getPosition: 1000 }, updateTriggers: { getPosition: [ubicacionUsuario.latitude, ubicacionUsuario.longitude] }
    })
  ].filter(Boolean);

  // --- 6. ESTILOS ---
  const appContainerStyle = { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#212529', overflow: 'hidden' };
  const sidebarStyle = { width: '320px', display: 'flex', flexDirection: 'column', padding: '30px 20px', boxSizing: 'border-box' };
  const mapWrapperStyle = { flex: 1, position: 'relative', margin: '20px 20px 20px 0', borderRadius: '24px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', backgroundColor: '#343a40' };
  const buttonStyle = { padding: '15px 20px', margin: '0 0 15px 0', backgroundColor: '#343a40', border: '1px solid #495057', borderRadius: '12px', color: '#f8f9fa', fontSize: '16px', fontWeight: '600', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s ease', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' };
  
  const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(5px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 };
  const modalContentStyle = { backgroundColor: '#212529', padding: '30px', borderRadius: '16px', width: '800px', boxShadow: '0 15px 40px rgba(0,0,0,0.5)', color: '#f8f9fa', fontFamily: 'sans-serif', border: '1px solid #495057' };
  const inputStyle = { width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #495057', backgroundColor: '#343a40', color: '#fff', fontSize: '16px', boxSizing: 'border-box', outline: 'none' };

  return (
    <div style={appContainerStyle}>
      
      {/* --- POP-UP AÑADIR NIÑO --- */}
      {showKidModal && (
        <div style={modalOverlayStyle}>
          <div style={{...modalContentStyle, width: '400px'}}> 
            <h3 style={{ marginTop: 0 }}>Registrar Nuevo Niño</h3>
            <input type="text" placeholder="Nombre (Ej: María)" value={kidName} onChange={e => setKidName(e.target.value)} style={inputStyle} autoFocus />
            <input type="text" placeholder="Tag ID del dispositivo (Ej: 1)" value={deviceTag} onChange={e => setDeviceTag(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowKidModal(false)} style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none' }}>Cancelar</button>
              <button onClick={handleSaveKid} style={{ ...buttonStyle, margin: 0, backgroundColor: '#3b82f6', borderColor: '#2563eb', textAlign: 'center' }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* --- POP-UP AÑADIR ZONA --- */}
      {showZoneModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <h3 style={{ marginTop: 0 }}>Nueva Zona Restringida</h3>
            <p style={{ fontSize: '14px', color: '#adb5bd', marginBottom: '15px' }}>Haz clic en el mapa para situar el centro de la zona.</p>
            
            <div style={{ height: '500px', width: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative', marginBottom: '20px', border: '1px solid #495057' }}>
              <DeckGL
                viewState={miniMapViewState}
                onViewStateChange={e => setMiniMapViewState(e.viewState)}
                controller={true}
                onClick={handleMiniMapClick}
                layers={[
                  nuevaZona.latitude && new ScatterplotLayer({
                    id: 'mini-preview-circle', data: [nuevaZona], getPosition: d => [d.longitude, d.latitude],
                    getRadius: d => d.radius, radiusUnits: 'meters', getFillColor: [255, 0, 0, 80], getLineColor: [255, 0, 0, 255], getLineWidth: 2
                  }),
                  nuevaZona.latitude && new ScatterplotLayer({
                    id: 'mini-preview-pin', data: [nuevaZona], getPosition: d => [d.longitude, d.latitude],
                    radiusUnits: 'pixels', getRadius: 6, getFillColor: [255, 255, 255, 255], getLineColor: [0, 0, 0, 255], getLineWidth: 2
                  })
                ].filter(Boolean)}
              >
                <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
              </DeckGL>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '14px' }}>
              <span>Radio: <strong style={{ color: '#10b981' }}>{nuevaZona.radius}m</strong></span>
            </div>
            {/* MODIFICADO: Rango de 20 a 200 con saltos de 10 */}
            <input 
              type="range" 
              min="20" 
              max="600" 
              step="10" 
              value={nuevaZona.radius} 
              onChange={e => setNuevaZona({...nuevaZona, radius: Number(e.target.value)})} 
              style={{ width: '100%', marginBottom: '20px', cursor: 'pointer' }} 
            />

            <select style={inputStyle} value={nuevaZona.tag_id} onChange={e => setNuevaZona({...nuevaZona, tag_id: e.target.value})}>
              {kids.length === 0 ? (
                <option value="" disabled style={{ fontStyle: 'italic' }}>No hay niños registrados</option>
              ) : (
                <>
                  <option value="" disabled>Asignar a un niño...</option>
                  {kids.map(k => (
                    <option key={k.tag_id} value={k.tag_id}>{k.name}</option>
                  ))}
                </>
              )}
            </select>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowZoneModal(false)} style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent', borderColor: 'transparent', boxShadow: 'none' }}>Cancelar</button>
              <button onClick={handleSaveZone} style={{ ...buttonStyle, margin: 0, backgroundColor: '#10b981', borderColor: '#059669', textAlign: 'center' }}>Confirmar Ubicación</button>
            </div>
          </div>
        </div>
      )}

      {/* --- BARRA LATERAL (SIDEBAR) --- */}
      <div style={sidebarStyle}>
        <h2 style={{ margin: '0 0 30px 0', color: '#f8f9fa', fontSize: '24px' }}>Panel de Control</h2>
        <button style={buttonStyle} onMouseEnter={e => e.target.style.backgroundColor = '#495057'} onMouseLeave={e => e.target.style.backgroundColor = '#343a40'}>👤 Mi Perfil</button>
        <button style={buttonStyle} onMouseEnter={e => e.target.style.backgroundColor = '#495057'} onMouseLeave={e => e.target.style.backgroundColor = '#343a40'}>🕒 Historial</button>
        <button style={buttonStyle} onMouseEnter={e => e.target.style.backgroundColor = '#495057'} onMouseLeave={e => e.target.style.backgroundColor = '#343a40'} onClick={() => setShowKidModal(true)}>👶 Añadir Niño</button>
        <button style={buttonStyle} onMouseEnter={e => e.target.style.backgroundColor = '#495057'} onMouseLeave={e => e.target.style.backgroundColor = '#343a40'} onClick={() => setShowZoneModal(true)}>🛑 Añadir Ubicación Restringida</button>
      </div>

      {/* --- CONTENEDOR DEL MAPA PRINCIPAL --- */}
      <div style={mapWrapperStyle}>
        <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '10px' }}>
          {kids.map(kid => (
            <button key={kid.tag_id} onClick={() => setSelectedKidTag(kid.tag_id)} style={{ padding: '10px 20px', borderRadius: '25px', border: 'none', fontWeight: 'bold', cursor: 'pointer', backgroundColor: selectedKidTag === kid.tag_id ? '#3b82f6' : '#212529', color: 'white', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', transition: 'background 0.2s' }}>{kid.name}</button>
          ))}
          {kids.length === 0 && <div style={{ padding: '10px 20px', borderRadius: '25px', backgroundColor: '#212529', color: '#adb5bd', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>Añade un niño para empezar</div>}
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