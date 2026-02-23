import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import 'mapbox-gl/dist/mapbox-gl.css';

// --- 1. CONFIGURACIÓN ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const API_URL = import.meta.env.VITE_API_URL;
const COLLECTION_NAME = "locations";

const INITIAL_VIEW_STATE = { longitude: -0.376288, latitude: 39.469907, zoom: 14, pitch: 45, bearing: 0 };

const getYesterdayDate = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

export default function App() {
  // --- 2. ESTADOS DE LOGIN Y REGISTRO ---
  const [loggedUser, setLoggedUser] = useState(null); 
  const [isLoginMode, setIsLoginMode] = useState(true);
  
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regNombre, setRegNombre] = useState("");
  const [regApellidos, setRegApellidos] = useState("");
  const [regTelefono, setRegTelefono] = useState("");
  
  const [authError, setAuthError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // --- ESTADOS DEL MAPA Y DATOS ---
  const [mapReady, setMapReady] = useState(false);
  const [activeView, setActiveView] = useState('live'); 
  
  const [kids, setKids] = useState([]); 
  const [selectedKidTag, setSelectedKidTag] = useState(null); 

  const [ubicacionUsuario, setUbicacionUsuario] = useState(null);
  const [zonasSQL, setZonasSQL] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [haCentradoInicial, setHaCentradoInicial] = useState(false);

  // Estados Historial
  const [historyDate, setHistoryDate] = useState(getYesterdayDate());
  const [historyStartTime, setHistoryStartTime] = useState("08:00");
  const [historyEndTime, setHistoryEndTime] = useState("20:00");
  const [historyRoute, setHistoryRoute] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Estados Modales
  const [showKidModal, setShowKidModal] = useState(false);
  const [kidName, setKidName] = useState("");
  const [deviceTag, setDeviceTag] = useState(""); 
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [isSavingZone, setIsSavingZone] = useState(false);
  const [miniMapViewState, setMiniMapViewState] = useState(INITIAL_VIEW_STATE);
  const [nuevaZona, setNuevaZona] = useState({ latitude: null, longitude: null, radius: 50, tag_id: "" });

  // --- 3. EFECTOS ---
  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Cargar niños de la DB al loguearse
  useEffect(() => {
    if (!loggedUser) return;
    const fetchKids = async () => {
      try {
        const res = await axios.get(`${API_URL}/kids/${loggedUser.user_id}`);
        setKids(res.data);
      } catch (error) {
        console.error("Error cargando niños:", error);
      }
    };
    fetchKids();
  }, [loggedUser]);

  // Cargar zonas de la DB al loguearse
  useEffect(() => {
    if (!loggedUser) return;
    const fetchZones = async () => {
      try {
        const res = await axios.get(`${API_URL}/zones`);
        setZonasSQL(res.data);
      } catch (error) {
        console.error("Error cargando zonas:", error);
      }
    };
    fetchZones();
  }, [loggedUser]);

  useEffect(() => {
    if (kids.length > 0 && !selectedKidTag) {
      setSelectedKidTag(kids[0].tag_id);
    }
  }, [kids]);

  // Al cambiar de niño, resetear el centrado
  useEffect(() => {
    setHaCentradoInicial(false);
    setUbicacionUsuario(null);
  }, [selectedKidTag]);

  // Listener de Firebase para ubicación en vivo
  useEffect(() => {    
    if (!db || !selectedKidTag || activeView !== 'live' || !loggedUser) return;

    const unsubscribe = onSnapshot(
      doc(db, COLLECTION_NAME, selectedKidTag),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          const lat = parseFloat(data.latitude);
          const lng = parseFloat(data.longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            setUbicacionUsuario({ latitude: lat, longitude: lng, timestamp: data.timestamp, userId: data.tag_id });
            if (!haCentradoInicial) {
              setViewState({ longitude: lng, latitude: lat, zoom: 16, pitch: 45, bearing: 0, transitionDuration: 2000 });
              setHaCentradoInicial(true); 
            }
          }
        } else {
          console.warn(`No hay datos en Firestore para tag_id: ${selectedKidTag}`);
        }
      },
      (error) => console.error("Error Firebase:", error)
    );

    return () => unsubscribe();
  }, [selectedKidTag, haCentradoInicial, activeView, loggedUser]);

  // --- 4. MANEJADORES ---

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setIsAuthenticating(true);
    try {
      if (isLoginMode) {
        const res = await axios.post(`${API_URL}/login`, {
          correo: loginEmail,
          password: loginPassword
        });
        if (res.data.status === "ok") setLoggedUser(res.data);
      } else {
        const newUserId = Date.now().toString(); 
        const res = await axios.post(`${API_URL}/users`, {
          user_id: newUserId,
          username: loginEmail.split('@')[0], 
          nombre: regNombre,
          apellidos: regApellidos,
          correo: loginEmail,
          telefono: regTelefono,
          password: loginPassword
        });
        if (res.data.status === "ok") {
          setLoggedUser({ user_id: newUserId, nombre: regNombre, apellidos: regApellidos });
        }
      }
    } catch (error) {
      setAuthError(error.response?.data?.detail || "Error de autenticación.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleSaveKid = async () => {
    if (!kidName.trim() || !deviceTag.trim()) return;
    const newKid = { name: kidName, tag_id: deviceTag };
    setKids([...kids, newKid]); 
    try {
      await axios.post(`${API_URL}/tags`, { 
        tag_id: deviceTag, 
        nombre: kidName, 
        user_id: loggedUser.user_id 
      });
      setShowKidModal(false);
      setKidName(""); 
      setDeviceTag("");
    } catch (error) {
      console.error("Error API al guardar niño:", error);
      alert("Error al guardar en la base de datos.");
    }
  };

  const handleMiniMapClick = (info) => {
    if (info.coordinate) {
      setNuevaZona(prev => ({ ...prev, latitude: info.coordinate[1], longitude: info.coordinate[0] }));
    }
  };

  // CORREGIDO: guarda en BD via API antes de actualizar el estado local
  const handleSaveZone = async () => {
    if (nuevaZona.latitude == null || !nuevaZona.tag_id) {
      alert("Por favor, selecciona un punto en el mapa y asigna un niño.");
      return;
    }
    setIsSavingZone(true);
    try {
      await axios.post(`${API_URL}/zone`, {
        tag_id: nuevaZona.tag_id,
        latitude: nuevaZona.latitude,
        longitude: nuevaZona.longitude,
        radius: nuevaZona.radius,
      });
      setZonasSQL(prev => [...prev, { ...nuevaZona, user_id: loggedUser.user_id }]);
      setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "" });
      setShowZoneModal(false);
    } catch (error) {
      console.error("Error guardando zona:", error);
      alert("Error al guardar la zona en la base de datos.");
    } finally {
      setIsSavingZone(false);
    }
  };

  const handleZoomIn = () => setViewState(prev => ({ ...prev, zoom: prev.zoom + 1, transitionDuration: 300 }));
  const handleZoomOut = () => setViewState(prev => ({ ...prev, zoom: prev.zoom - 1, transitionDuration: 300 }));

  const handleSearchHistory = async () => {
    if (!selectedKidTag) return alert("Selecciona un niño.");
    setIsLoadingHistory(true);
    const startIso = new Date(`${historyDate}T${historyStartTime}:00`).toISOString();
    const endIso = new Date(`${historyDate}T${historyEndTime}:00`).toISOString();
    try {
      const response = await axios.get(`${API_URL}/history/${selectedKidTag}`, {
        params: { start_time: startIso, end_time: endIso }
      });
      if (response.data.path?.length > 0) {
        setHistoryRoute({ path: response.data.path });
        setViewState({ longitude: response.data.path[0][0], latitude: response.data.path[0][1], zoom: 15, pitch: 45, bearing: 0, transitionDuration: 1500 });
      } else {
        alert("Sin movimientos.");
        setHistoryRoute(null);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // --- 5. CAPAS ---
  const zonasFiltradas = zonasSQL.filter(z => String(z.tag_id) === String(selectedKidTag));
  const mainLayers = [
    new ScatterplotLayer({
      id: 'zonas-sql', data: zonasFiltradas, pickable: true, stroked: true, filled: true,
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), radiusUnits: 'meters', 
      getFillColor: [255, 0, 0, 80], getLineColor: [255, 0, 0, 255], getLineWidth: 2
    }),
    activeView === 'live' && ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo', data: [ubicacionUsuario], pickable: true, stroked: true, filled: true,
      getPosition: d => [d.longitude, d.latitude], radiusUnits: 'pixels', getRadius: 8, 
      getFillColor: [66, 133, 244, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3,
      transitions: { getPosition: 1000 }
    }),
    activeView === 'history' && historyRoute && new PathLayer({
      id: 'history-path', data: [historyRoute], pickable: true, widthScale: 1, widthMinPixels: 4,
      getPath: d => d.path, getColor: [59, 130, 246, 200], getWidth: 5
    })
  ].filter(Boolean);

  // --- 6. ESTILOS ---
  const appContainerStyle = { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#212529', overflow: 'hidden' };
  const sidebarStyle = { width: '320px', display: 'flex', flexDirection: 'column', padding: '30px 20px', boxSizing: 'border-box', overflowY: 'auto' };
  const mapWrapperStyle = { flex: 1, position: 'relative', margin: '20px 20px 20px 0', borderRadius: '24px', overflow: 'hidden', backgroundColor: '#343a40' };
  const buttonStyle = { padding: '15px 20px', margin: '0 0 15px 0', backgroundColor: '#343a40', border: '1px solid #495057', borderRadius: '12px', color: '#f8f9fa', cursor: 'pointer', textAlign: 'left' };
  const activeButtonStyle = { ...buttonStyle, backgroundColor: '#3b82f6', border: '1px solid #2563eb' };
  const inputStyle = { width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '8px', border: '1px solid #495057', backgroundColor: '#212529', color: '#fff', boxSizing: 'border-box' };
  const dateInputStyle = { ...inputStyle, cursor: 'pointer', colorScheme: 'dark' };
  const zoomButtonStyle = { width: '45px', height: '45px', backgroundColor: '#343a40', color: '#f8f9fa', border: '1px solid #495057', borderRadius: '12px', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  // ==========================================
  // PANTALLA LOGIN / REGISTRO
  // ==========================================
  if (!loggedUser) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#212529', justifyContent: 'center', alignItems: 'center', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleAuth} style={{ backgroundColor: '#343a40', padding: '40px', borderRadius: '16px', width: '380px', border: '1px solid #495057' }}>
          <h2 style={{ color: '#f8f9fa', textAlign: 'center', marginBottom: '30px' }}>
            {isLoginMode ? 'Iniciar Sesión' : 'Crear Nueva Cuenta'}
          </h2>
          {authError && (
            <div style={{ backgroundColor: '#dc2626', color: 'white', padding: '10px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', textAlign: 'center' }}>
              {authError}
            </div>
          )}
          {!isLoginMode && (
            <>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input type="text" placeholder="Nombre" value={regNombre} onChange={e => setRegNombre(e.target.value)} style={inputStyle} required />
                <input type="text" placeholder="Apellidos" value={regApellidos} onChange={e => setRegApellidos(e.target.value)} style={inputStyle} required />
              </div>
              <input type="tel" placeholder="Teléfono" value={regTelefono} onChange={e => setRegTelefono(e.target.value)} style={inputStyle} required />
            </>
          )}
          <input type="email" placeholder="Correo Electrónico" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={inputStyle} required />
          <input type="password" placeholder="Contraseña" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={inputStyle} required />
          <button type="submit" disabled={isAuthenticating} style={{ width: '100%', padding: '15px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
            {isAuthenticating ? 'Procesando...' : (isLoginMode ? 'Entrar al Panel' : 'Registrarse')}
          </button>
          <div style={{ textAlign: 'center', color: '#adb5bd', fontSize: '14px', marginTop: '20px' }}>
            {isLoginMode ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
            <span onClick={() => setIsLoginMode(!isLoginMode)} style={{ color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}>
              {isLoginMode ? 'Regístrate aquí' : 'Inicia sesión'}
            </span>
          </div>
        </form>
      </div>
    );
  }

  // ==========================================
  // PANTALLA PRINCIPAL
  // ==========================================
  return (
    <div style={appContainerStyle}>

      {/* MODAL: AÑADIR NIÑO */}
      {showKidModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#212529', padding: '30px', borderRadius: '16px', width: '400px', border: '1px solid #495057', color: 'white' }}> 
            <h3>Registrar Nuevo Niño</h3>
            <input type="text" placeholder="Nombre" value={kidName} onChange={e => setKidName(e.target.value)} style={inputStyle} />
            <input type="text" placeholder="Tag ID del dispositivo" value={deviceTag} onChange={e => setDeviceTag(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowKidModal(false)} style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent' }}>Cancelar</button>
              <button onClick={handleSaveKid} style={{ ...buttonStyle, margin: 0, backgroundColor: '#3b82f6' }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AÑADIR ZONA */}
      {showZoneModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#212529', padding: '30px', borderRadius: '16px', width: '700px', maxWidth: '95vw', border: '1px solid #495057', color: 'white', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            <h3 style={{ margin: 0, fontSize: '18px' }}>🛑 Nueva Zona Restringida</h3>
            <p style={{ margin: 0, color: '#adb5bd', fontSize: '14px' }}>
              Haz clic en el mapa para seleccionar el centro de la zona.
            </p>

            {/* MAPA del modal — aislado del mapa principal */}
            <div style={{ position: 'relative', height: '380px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #495057' }}>
              <DeckGL
                key="zone-modal-map"
                viewState={miniMapViewState}
                onViewStateChange={e => setMiniMapViewState(e.viewState)}
                controller={true}
                onClick={handleMiniMapClick}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                layers={[
                  nuevaZona.latitude != null && new ScatterplotLayer({
                    id: 'zone-preview-radius',
                    data: [nuevaZona],
                    getPosition: d => [d.longitude, d.latitude],
                    getRadius: d => d.radius,
                    radiusUnits: 'meters',
                    getFillColor: [255, 80, 80, 60],
                    getLineColor: [255, 80, 80, 220],
                    stroked: true,
                    filled: true,
                    getLineWidth: 2,
                  }),
                  nuevaZona.latitude != null && new ScatterplotLayer({
                    id: 'zone-preview-pin',
                    data: [nuevaZona],
                    getPosition: d => [d.longitude, d.latitude],
                    getRadius: 6,
                    radiusUnits: 'pixels',
                    getFillColor: [255, 255, 255, 255],
                    getLineColor: [255, 80, 80, 255],
                    stroked: true,
                    getLineWidth: 2,
                  }),
                ].filter(Boolean)}
              >
                <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
              </DeckGL>

              {nuevaZona.latitude == null && (
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: 'rgba(0,0,0,0.6)', color: 'white',
                  padding: '10px 18px', borderRadius: '8px', fontSize: '14px',
                  pointerEvents: 'none'
                }}>
                  👆 Haz clic para colocar la zona
                </div>
              )}
            </div>

            {/* RADIO */}
            <div>
              <label style={{ fontSize: '14px', color: '#adb5bd', display: 'block', marginBottom: '6px' }}>
                Radio: <strong style={{ color: 'white' }}>{nuevaZona.radius} m</strong>
              </label>
              <input
                type="range" min="20" max="500" step="10"
                value={nuevaZona.radius}
                onChange={e => setNuevaZona(prev => ({ ...prev, radius: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: '#3b82f6' }}
              />
            </div>

            {/* SELECTOR DE NIÑO */}
            <select
              style={{ ...inputStyle, marginBottom: 0 }}
              value={nuevaZona.tag_id}
              onChange={e => setNuevaZona(prev => ({ ...prev, tag_id: e.target.value }))}
            >
              <option value="">Seleccionar niño...</option>
              {kids.map(k => <option key={k.tag_id} value={k.tag_id}>{k.name}</option>)}
            </select>

            {/* BOTONES */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => {
                  setShowZoneModal(false);
                  setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "" });
                }}
                style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveZone}
                disabled={isSavingZone}
                style={{ ...buttonStyle, margin: 0, backgroundColor: '#10b981', border: '1px solid #059669', opacity: isSavingZone ? 0.6 : 1 }}
              >
                {isSavingZone ? 'Guardando...' : '✅ Confirmar Zona'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div style={sidebarStyle}>
        <div style={{ marginBottom: '30px' }}>
          <h2 style={{ color: '#f8f9fa', fontSize: '24px', margin: 0 }}>Panel Tracking</h2>
          <span style={{ color: '#adb5bd', fontSize: '14px' }}>Usuario: {loggedUser.nombre}</span>
        </div>
        <button style={activeView === 'live' ? activeButtonStyle : buttonStyle} onClick={() => setActiveView('live')}>📍 En Vivo</button>
        <button style={activeView === 'history' ? activeButtonStyle : buttonStyle} onClick={() => setActiveView('history')}>🕒 Historial</button>
        <hr style={{ border: 'none', borderTop: '1px solid #495057', margin: '15px 0' }} />
        {activeView === 'live' ? (
          <>
            <button style={buttonStyle} onClick={() => setShowKidModal(true)}>👶 Añadir Niño</button>
            <button style={buttonStyle} onClick={() => setShowZoneModal(true)}>🛑 Añadir Zona</button>
            <button style={{ ...buttonStyle, marginTop: 'auto', backgroundColor: '#dc2626' }} onClick={() => setLoggedUser(null)}>🚪 Salir</button>
          </>
        ) : (
          <div>
            <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} style={dateInputStyle} />
            <div style={{ display: 'flex', gap: '5px' }}>
              <input type="time" value={historyStartTime} onChange={e => setHistoryStartTime(e.target.value)} style={dateInputStyle} />
              <input type="time" value={historyEndTime} onChange={e => setHistoryEndTime(e.target.value)} style={dateInputStyle} />
            </div>
            <button onClick={handleSearchHistory} disabled={isLoadingHistory} style={{ ...buttonStyle, width: '100%', backgroundColor: '#10b981', textAlign: 'center' }}>
              {isLoadingHistory ? '...' : '🔍 Buscar'}
            </button>
          </div>
        )}
      </div>

      {/* MAPA PRINCIPAL */}
      <div style={mapWrapperStyle}>
        <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '10px' }}>
          {kids.map(kid => (
            <button
              key={kid.tag_id}
              onClick={() => setSelectedKidTag(kid.tag_id)}
              style={{ padding: '10px 20px', borderRadius: '25px', border: 'none', backgroundColor: selectedKidTag === kid.tag_id ? '#3b82f6' : '#212529', color: 'white', cursor: 'pointer' }}
            >
              {kid.name}
            </button>
          ))}
        </div>
        <div style={{ position: 'absolute', bottom: '30px', right: '30px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '8px' }}>
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