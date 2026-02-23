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
    setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "" });
    setShowZoneModal(false);
  };

  // Controles de Zoom Manual
  const handleZoomIn = () => {
    setViewState(prev => ({ ...prev, zoom: prev.zoom + 1, transitionDuration: 300 }));
  };

  const handleZoomOut = () => {
    setViewState(prev => ({ ...prev, zoom: prev.zoom - 1, transitionDuration: 300 }));
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

  // --- 6. RENDER ---
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", backgroundColor: '#111921', color: '#f1f5f9', height: '100vh', width: '100vw', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* --- POP-UP AÑADIR NIÑO --- */}
      {showKidModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1a2332', padding: '32px', borderRadius: '16px', width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', color: '#f1f5f9', border: '1px solid #1e293b' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>Registrar Nuevo Niño</h3>
            <input type="text" placeholder="Nombre (Ej: María)" value={kidName} onChange={e => setKidName(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '14px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: '#0f1923', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }} autoFocus />
            <input type="text" placeholder="Tag ID del dispositivo (Ej: 1)" value={deviceTag} onChange={e => setDeviceTag(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '22px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: '#0f1923', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowKidModal(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Cancelar</button>
              <button onClick={handleSaveKid} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#4799eb', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* --- POP-UP AÑADIR ZONA --- */}
      {showZoneModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1a2332', padding: '32px', borderRadius: '16px', width: '800px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', color: '#f1f5f9', border: '1px solid #1e293b' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px', fontWeight: '700', marginBottom: '6px' }}>Nueva Zona Restringida</h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>Haz clic en el mapa para situar el centro de la zona.</p>

            <div style={{ height: '400px', width: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative', marginBottom: '20px', border: '1px solid #1e293b' }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ color: '#94a3b8' }}>Radio: <strong style={{ color: '#4799eb' }}>{nuevaZona.radius}m</strong></span>
            </div>
            <input
              type="range" min="20" max="600" step="10" value={nuevaZona.radius}
              onChange={e => setNuevaZona({...nuevaZona, radius: Number(e.target.value)})}
              style={{ width: '100%', marginBottom: '20px', cursor: 'pointer', accentColor: '#4799eb' }}
            />

            <select style={{ width: '100%', padding: '12px', marginBottom: '22px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: '#0f1923', color: '#f1f5f9', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }} value={nuevaZona.tag_id} onChange={e => setNuevaZona({...nuevaZona, tag_id: e.target.value})}>
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
              <button onClick={() => setShowZoneModal(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Cancelar</button>
              <button onClick={handleSaveZone} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Confirmar Ubicación</button>
            </div>
          </div>
        </div>
      )}

      {/* --- TOP NAVIGATION BAR --- */}
      <header style={{ zIndex: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(17, 25, 33, 0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1e293b', padding: '10px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#4799eb', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#fff', display: 'block', lineHeight: 1 }}>family_restroom</span>
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.025em', color: '#f1f5f9', margin: 0 }}>FamTrack</h1>
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button style={{ position: 'relative', padding: '8px', borderRadius: '50%', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: '22px', display: 'block', lineHeight: 1 }}>notifications</span>
            <span style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid #111921' }}></span>
          </button>
          <div style={{ height: '28px', width: '1px', backgroundColor: '#1e293b' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: '#f1f5f9', lineHeight: 1 }}>Panel de Control</p>
              <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0 0' }}>FamTrack</p>
            </div>
          </div>
        </div>
      </header>

      {/* --- CONTENT AREA (sidebar + map) --- */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* --- LEFT SIDEBAR --- */}
        <aside style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '20px 12px', gap: '8px', backgroundColor: '#111921', borderRight: '1px solid #1e293b', zIndex: 40 }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }} onClick={() => setShowKidModal(true)}>
            <span className="material-symbols-outlined" style={{ color: '#4799eb', fontSize: '22px', flexShrink: 0 }}>group</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Familia</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Añadir Niño</p>
            </div>
          </button>

          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }} onClick={() => setShowZoneModal(true)}>
            <span className="material-symbols-outlined" style={{ color: '#22c55e', fontSize: '22px', flexShrink: 0 }}>security</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Seguridad</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Geocercas</p>
            </div>
          </button>

          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}>
            <span className="material-symbols-outlined" style={{ color: '#f97316', fontSize: '22px', flexShrink: 0 }}>history</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Rutas</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Historial</p>
            </div>
          </button>

          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}>
            <span className="material-symbols-outlined" style={{ color: '#ef4444', fontSize: '22px', flexShrink: 0 }}>warning</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>S.O.S</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Alertas</p>
            </div>
          </button>

          <div style={{ marginTop: 'auto' }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', color: '#475569', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>logout</span>
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Salir</span>
            </button>
          </div>
        </aside>

        {/* --- MAP AREA --- */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Map fills the entire main area */}
          <div style={{ position: 'absolute', inset: 0, backgroundColor: '#0f1923' }}>
            {mapReady && (
              <DeckGL viewState={viewState} onViewStateChange={e => setViewState(e.viewState)} controller={true} layers={mainLayers}>
                <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
              </DeckGL>
            )}
          </div>

          {/* Kid selector pills */}
          <div style={{ position: 'absolute', top: '24px', left: '24px', right: '24px', display: 'flex', flexWrap: 'wrap', gap: '10px', zIndex: 10 }}>
            {/* Kid selector pills */}
            {kids.map(kid => (
              <button key={kid.tag_id} onClick={() => setSelectedKidTag(kid.tag_id)} style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', borderRadius: '9999px', border: 'none', fontWeight: '700', cursor: 'pointer', backgroundColor: selectedKidTag === kid.tag_id ? '#4799eb' : 'rgba(17, 25, 33, 0.92)', color: selectedKidTag === kid.tag_id ? '#fff' : '#94a3b8', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', fontSize: '14px', fontFamily: 'inherit', transition: 'background 0.2s' }}>
                {kid.name}
              </button>
            ))}
            {kids.length === 0 && (
              <div style={{ padding: '10px 20px', borderRadius: '9999px', backgroundColor: 'rgba(17, 25, 33, 0.92)', color: '#475569', fontSize: '14px', border: '1px dashed #1e293b' }}>
                Añade un niño para empezar
              </div>
            )}
          </div>

          {/* Map Controls (zoom) */}
          <div style={{ position: 'absolute', right: '24px', bottom: '130px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 10 }}>
            <button onClick={handleZoomIn} style={{ width: '44px', height: '44px', backgroundColor: 'rgba(17, 25, 33, 0.92)', color: '#f1f5f9', border: '1px solid #1e293b', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined">add</span>
            </button>
            <button onClick={handleZoomOut} style={{ width: '44px', height: '44px', backgroundColor: 'rgba(17, 25, 33, 0.92)', color: '#f1f5f9', border: '1px solid #1e293b', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined">remove</span>
            </button>
            <button style={{ marginTop: '8px', width: '44px', height: '44px', backgroundColor: '#4799eb', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(71, 153, 235, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined">my_location</span>
            </button>
          </div>

          {/* Bottom Family Status Bar */}
          <div style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 48px)', maxWidth: '640px', zIndex: 10 }}>
            <div style={{ backgroundColor: 'rgba(17, 25, 33, 0.94)', backdropFilter: 'blur(12px)', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', padding: '16px', border: '1px solid rgba(30, 41, 59, 0.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', padding: '0 4px' }}>
                <h3 style={{ fontWeight: '700', fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>Estado de la familia</h3>
                <span style={{ fontSize: '11px', fontWeight: '500', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', padding: '4px 10px', borderRadius: '9999px' }}>
                  {kids.length > 0 ? 'Activo' : 'Sin niños'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                {kids.length === 0 ? (
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#0f1923', padding: '12px', borderRadius: '12px', minWidth: '200px', border: '1px solid #1e293b' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ color: '#475569', fontSize: '20px' }}>person_add</span>
                    </div>
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: '700', color: '#475569', margin: 0 }}>Sin niños</p>
                      <p style={{ fontSize: '11px', color: '#334155', margin: '3px 0 0 0' }}>Añade un niño para empezar</p>
                    </div>
                  </div>
                ) : (
                  kids.map(kid => (
                    <div key={kid.tag_id} onClick={() => setSelectedKidTag(kid.tag_id)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: selectedKidTag === kid.tag_id ? 'rgba(71, 153, 235, 0.12)' : '#0f1923', padding: '12px', borderRadius: '12px', minWidth: '200px', border: `1px solid ${selectedKidTag === kid.tag_id ? 'rgba(71, 153, 235, 0.35)' : '#1e293b'}`, cursor: 'pointer', transition: 'all 0.2s' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ color: '#4799eb', fontSize: '20px' }}>child_care</span>
                      </div>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: 0 }}>{kid.name}</p>
                        <p style={{ fontSize: '11px', color: '#64748b', margin: '3px 0 0 0' }}>Tag ID: {kid.tag_id}</p>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className="material-symbols-outlined" style={{ color: '#4ade80', fontSize: '14px' }}>wifi</span>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: '#4ade80' }}>Live</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
