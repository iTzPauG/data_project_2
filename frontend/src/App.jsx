import React, { useState, useEffect, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'; 
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "./firebase"; 
import 'mapbox-gl/dist/mapbox-gl.css';

// --- IMPORTAR NOTIFICACIONES ---
import toast, { Toaster } from 'react-hot-toast';

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
  const [nuevaZona, setNuevaZona] = useState({ latitude: null, longitude: null, radius: 50, tag_id: "", zone_type: "aviso", zone_name: "" });

  // --- 3. EFECTOS ---
  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loggedUser) return;
    
    const fetchKids = async () => {
      try {
        const res = await axios.get(`${API_URL}/kids/${loggedUser.user_id}`);
        setKids(res.data);
        
        if (res.data.length > 0 && !selectedKidTag) {
          setSelectedKidTag(res.data[0].tag_id);
        }
      } catch (error) {
        console.error("Error cargando niños:", error);
      }
    };
    
    fetchKids();
  }, [loggedUser]); 

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
    setHaCentradoInicial(false);
    setUbicacionUsuario(null);
  }, [selectedKidTag]);

  // Listener Firebase (Ubicación)
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
        }
      },
      (error) => console.error("Error Firebase:", error)
    );

    return () => unsubscribe();
  }, [selectedKidTag, haCentradoInicial, activeView, loggedUser]);

  // Listener Firebase (Notificaciones)
  useEffect(() => {
    if (!db || !loggedUser) return;

    const q = query(
      collection(db, "notifications"),
      where("user_id", "==", String(loggedUser.user_id))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const alerta = change.doc.data();
          const ahora = Date.now();
          const tiempoAlerta = alerta.timestamp; 
          
          if (ahora - tiempoAlerta < 10000) { 
            toast.error(
              `¡Alerta! ${alerta.kid_name} ha infringido la zona: ${alerta.zone_name}`,
              {
                duration: 6000, 
                position: 'top-right',
                style: {
                  background: '#2c2c2c',
                  color: '#fff',
                  border: '1px solid #ef4444',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                },
              }
            );
          }
        }
      });
    }, (error) => console.error("Error Firebase (Notificaciones):", error));

    return () => unsubscribe();
  }, [loggedUser]);


  // --- 4. MANEJADORES DE DATOS ---

  const handleSearchHistory = useCallback(async () => {
    if (!selectedKidTag) return;
    setIsLoadingHistory(true);
    
    const startIso = `${historyDate}T${historyStartTime}:00.000Z`;
    const endIso = `${historyDate}T${historyEndTime}:00.000Z`;
    
    try {
      const response = await axios.get(`${API_URL}/history/${selectedKidTag}`, {
        params: { start_time: startIso, end_time: endIso }
      });
      
      if (response.data.path && response.data.path.length > 1) {
        setHistoryRoute({ path: response.data.path });
        setViewState(prev => ({ ...prev, longitude: response.data.path[0][0], latitude: response.data.path[0][1], zoom: 15, pitch: 45, transitionDuration: 1500 }));
      } else if (response.data.path && response.data.path.length === 1) {
        alert("Solo hay 1 punto de ubicación en este rango de tiempo. Se necesitan al menos 2 para dibujar una ruta.");
        setHistoryRoute(null);
      } else {
        setHistoryRoute(null);
      }
    } catch (error) {
      console.error("Error consultando historial:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [selectedKidTag, historyDate, historyStartTime, historyEndTime]);

  useEffect(() => {
    if (activeView === 'history' && selectedKidTag) {
      handleSearchHistory();
    }
  }, [selectedKidTag, activeView, handleSearchHistory]);

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
          alert("¡Cuenta creada con éxito! Por favor, inicia sesión para continuar.");
          setIsLoginMode(true);
          setLoginPassword(""); 
        }
      }
    } catch (error) {
      setAuthError(error.response?.data?.detail || "Error de conexión con el servidor.");
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
      if (kids.length === 0) {
          setSelectedKidTag(deviceTag);
      }
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

  const handleSaveZone = async () => {
    if (nuevaZona.latitude == null || !nuevaZona.tag_id || !nuevaZona.zone_name.trim()) {
      alert("Por favor, selecciona un punto, asigna un niño y dale un nombre a la zona.");
      return;
    }
    setIsSavingZone(true);
    try {
      await axios.post(`${API_URL}/zone`, {
        tag_id: nuevaZona.tag_id,
        latitude: nuevaZona.latitude,
        longitude: nuevaZona.longitude,
        radius: nuevaZona.radius,
        zone_type: nuevaZona.zone_type,
        zone_data: nuevaZona.zone_name, 
      });
      setZonasSQL([...zonasSQL, { ...nuevaZona, user_id: loggedUser.user_id }]);
      setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "", zone_type: "aviso", zone_name: "" });
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

  // --- 5. CAPAS ---
  const zonasFiltradas = zonasSQL.filter(z => String(z.tag_id) === String(selectedKidTag));

  const getZoneColor = (zoneType) => {
    switch(zoneType) {
      case 'emergencia': return [239, 68, 68, 80]; // Tailwind red-500
      case 'zona_segura': return [34, 197, 94, 80]; // Tailwind green-500
      default: return [245, 158, 11, 80]; // Tailwind amber-500
    }
  };

  const getZoneLineColor = (zoneType) => {
    switch(zoneType) {
      case 'emergencia': return [239, 68, 68, 255];
      case 'zona_segura': return [34, 197, 94, 255];
      default: return [245, 158, 11, 255];
    }
  };

  const mainLayers = [
    new ScatterplotLayer({
      id: 'zonas-sql', data: zonasFiltradas, pickable: true, stroked: true, filled: true,
      getPosition: d => [parseFloat(d.longitude), parseFloat(d.latitude)],
      getRadius: d => parseFloat(d.radius), radiusUnits: 'meters', 
      getFillColor: d => getZoneColor(d.zone_type), getLineColor: d => getZoneLineColor(d.zone_type), getLineWidth: 2
    }),
    activeView === 'live' && ubicacionUsuario && new ScatterplotLayer({
      id: 'usuario-vivo', data: [ubicacionUsuario], pickable: true, stroked: true, filled: true,
      getPosition: d => [d.longitude, d.latitude], radiusUnits: 'pixels', getRadius: 8, 
      getFillColor: [59, 130, 246, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3, // Tailwind blue-500
      transitions: { getPosition: 1000 }
    }),
    activeView === 'history' && historyRoute && new PathLayer({
      id: 'history-path', data: [historyRoute], pickable: true, widthScale: 1, widthMinPixels: 4,
      getPath: d => d.path, getColor: [59, 130, 246, 200], getWidth: 5
    })
  ].filter(Boolean);


  // --- ESTILOS MEJORADOS ---
  const appContainerStyle = { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#121212', overflow: 'hidden', fontFamily: "'Inter', system-ui, sans-serif" };
  const sidebarStyle = { width: '340px', display: 'flex', flexDirection: 'column', padding: '32px 24px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#18181b', borderRight: '1px solid #27272a' };
  const mapWrapperStyle = { flex: 1, position: 'relative', margin: '24px 24px 24px 0', borderRadius: '16px', overflow: 'hidden', backgroundColor: '#27272a', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)' };
  
  const buttonBaseStyle = { padding: '14px 20px', margin: '0 0 12px 0', borderRadius: '10px', fontSize: '15px', fontWeight: '500', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s ease', border: '1px solid transparent' };
  const buttonStyle = { ...buttonBaseStyle, backgroundColor: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46' };
  const activeButtonStyle = { ...buttonBaseStyle, backgroundColor: '#3b82f6', color: 'white', boxShadow: '0 4px 14px -4px rgba(59, 130, 246, 0.4)' };
  const primaryButtonStyle = { ...buttonBaseStyle, backgroundColor: '#10b981', color: 'white', textAlign: 'center', boxShadow: '0 4px 14px -4px rgba(16, 185, 129, 0.4)' };
  const dangerButtonStyle = { ...buttonBaseStyle, backgroundColor: '#ef4444', color: 'white', marginTop: 'auto', textAlign: 'center' };
  
  const inputStyle = { width: '100%', padding: '14px 16px', marginBottom: '16px', borderRadius: '10px', border: '1px solid #3f3f46', backgroundColor: '#27272a', color: '#f4f4f5', fontSize: '15px', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.2s' };
  const dateInputStyle = { ...inputStyle, cursor: 'pointer', colorScheme: 'dark' };
  const zoomButtonStyle = { width: '40px', height: '40px', backgroundColor: '#18181b', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)', transition: 'background-color 0.2s' };
  
  const modalOverlayStyle = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 };
  const modalContentStyle = { backgroundColor: '#18181b', padding: '32px', borderRadius: '20px', width: '450px', border: '1px solid #27272a', color: 'white', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' };


  // ==========================================
  // PANTALLA LOGIN / REGISTRO
  // ==========================================
  if (!loggedUser) {
    return (
      <div style={{ display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <form onSubmit={handleAuth} style={{ backgroundColor: '#18181b', padding: '48px', borderRadius: '24px', width: '400px', border: '1px solid #27272a', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h2 style={{ color: '#ffffff', margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700' }}>
              {isLoginMode ? 'Bienvenido' : 'Crear Cuenta'}
            </h2>
            <p style={{ color: '#a1a1aa', margin: 0, fontSize: '15px' }}>
              {isLoginMode ? 'Inicia sesión para acceder al panel' : 'Rellena los datos para comenzar'}
            </p>
          </div>

          {authError && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '10px', marginBottom: '24px', fontSize: '14px', textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              {authError}
            </div>
          )}
          
          {!isLoginMode && (
            <>
              <div style={{ display: 'flex', gap: '12px' }}>
                <input type="text" placeholder="Nombre" value={regNombre} onChange={e => setRegNombre(e.target.value)} style={inputStyle} required />
                <input type="text" placeholder="Apellidos" value={regApellidos} onChange={e => setRegApellidos(e.target.value)} style={inputStyle} required />
              </div>
              <input type="tel" placeholder="Teléfono" value={regTelefono} onChange={e => setRegTelefono(e.target.value)} style={inputStyle} required />
            </>
          )}
          
          <input type="email" placeholder="Correo Electrónico" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={inputStyle} required />
          <input type="password" placeholder="Contraseña" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={inputStyle} required />
          
          <button type="submit" disabled={isAuthenticating} style={{ width: '100%', padding: '16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 14px -4px rgba(59, 130, 246, 0.4)', marginTop: '8px' }}>
            {isAuthenticating ? 'Procesando...' : (isLoginMode ? 'Entrar al Panel' : 'Registrarse')}
          </button>
          
          <div style={{ textAlign: 'center', color: '#a1a1aa', fontSize: '14px', marginTop: '24px' }}>
            {isLoginMode ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
            <span onClick={() => setIsLoginMode(!isLoginMode)} style={{ color: '#60a5fa', cursor: 'pointer', fontWeight: '500', transition: 'color 0.2s' }}>
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
      <Toaster />

      {/* MODAL: AÑADIR NIÑO */}
      {showKidModal && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}> 
            <h3 style={{ margin: '0 0 20px 0', fontSize: '20px' }}>Registrar Nuevo Niño</h3>
            <input type="text" placeholder="Nombre" value={kidName} onChange={e => setKidName(e.target.value)} style={inputStyle} />
            <input type="text" placeholder="Tag ID del dispositivo" value={deviceTag} onChange={e => setDeviceTag(e.target.value)} style={inputStyle} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button onClick={() => setShowKidModal(false)} style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent', border: 'none' }}>Cancelar</button>
              <button onClick={handleSaveKid} style={{ ...activeButtonStyle, margin: 0 }}>Guardar Niño</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AÑADIR ZONA */}
      {showZoneModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalContentStyle, width: '700px', maxWidth: '95vw' }}>
            
            <h3 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>🛑 Nueva Zona Restringida</h3>
            <p style={{ margin: '0 0 20px 0', color: '#a1a1aa', fontSize: '14px' }}>
              Haz clic en el mapa para seleccionar el centro de la zona.
            </p>

            <div style={{ position: 'relative', height: '350px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #3f3f46', marginBottom: '20px' }}>
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
                    getFillColor: getZoneColor(nuevaZona.zone_type),
                    getLineColor: getZoneLineColor(nuevaZona.zone_type),
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
                    getLineColor: getZoneLineColor(nuevaZona.zone_type),
                    stroked: true,
                    getLineWidth: 2,
                  }),
                ].filter(Boolean)}
              >
                <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
              </DeckGL>

              {nuevaZona.latitude == null && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', padding: '12px 20px', borderRadius: '30px', fontSize: '14px', fontWeight: '500', pointerEvents: 'none' }}>
                  👆 Haz clic para colocar la zona
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px', fontWeight: '500' }}>Nombre de la Zona</label>
                <input type="text" placeholder="Ej: Colegio" value={nuevaZona.zone_name} onChange={e => setNuevaZona({...nuevaZona, zone_name: e.target.value})} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px', fontWeight: '500' }}>Asignar a</label>
                <select style={inputStyle} value={nuevaZona.tag_id} onChange={e => setNuevaZona({...nuevaZona, tag_id: e.target.value})}>
                  {kids.length === 0 ? (
                    <option value="" disabled>No hay niños</option>
                  ) : (
                    <>
                      <option value="" disabled>Seleccionar...</option>
                      {kids.map(k => <option key={k.tag_id} value={k.tag_id}>{k.name}</option>)}
                    </>
                  )}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <div>
                <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px', fontWeight: '500' }}>
                  Radio: <span style={{ color: 'white' }}>{nuevaZona.radius} m</span>
                </label>
                <input type="range" min="20" max="600" step="10" value={nuevaZona.radius} onChange={e => setNuevaZona({...nuevaZona, radius: Number(e.target.value)})} style={{ width: '100%', accentColor: '#3b82f6', marginTop: '10px' }} />
              </div>
              <div>
                <label style={{ fontSize: '13px', color: '#a1a1aa', display: 'block', marginBottom: '6px', fontWeight: '500' }}>Tipo de Alerta</label>
                <select style={inputStyle} value={nuevaZona.zone_type} onChange={e => setNuevaZona({...nuevaZona, zone_type: e.target.value})}>
                  <option value="aviso">⚠️ Aviso Simple</option>
                  <option value="emergencia">🚨 Emergencia (Peligro)</option>
                  <option value="zona_segura">✅ Zona Segura</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => { setShowZoneModal(false); setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "", zone_type: "aviso", zone_name: "" }); }} style={{ ...buttonStyle, margin: 0, backgroundColor: 'transparent', border: 'none' }}>Cancelar</button>
              <button onClick={handleSaveZone} disabled={isSavingZone} style={{ ...primaryButtonStyle, margin: 0, opacity: isSavingZone ? 0.7 : 1 }}>
                {isSavingZone ? 'Guardando...' : '✅ Confirmar Zona'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div style={sidebarStyle}>
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#3b82f6', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontWeight: 'bold' }}>T</div>
            <h2 style={{ color: '#ffffff', fontSize: '22px', margin: 0, fontWeight: '700', letterSpacing: '-0.5px' }}>TrackKids</h2>
          </div>
          <span style={{ color: '#a1a1aa', fontSize: '13px', display: 'block' }}>Usuario: <span style={{ color: '#e4e4e7', fontWeight: '500' }}>{loggedUser.nombre}</span></span>
        </div>
        
        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontSize: '12px', textTransform: 'uppercase', color: '#71717a', fontWeight: '700', letterSpacing: '1px', marginBottom: '12px' }}>Vistas</p>
          <button style={activeView === 'live' ? activeButtonStyle : buttonStyle} onClick={() => setActiveView('live')}>📍 Rastreo en Vivo</button>
          <button style={activeView === 'history' ? activeButtonStyle : buttonStyle} onClick={() => setActiveView('history')}>🕒 Historial de Rutas</button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #27272a', margin: '0 0 24px 0' }} />
        
        {activeView === 'live' ? (
          <div>
            <p style={{ fontSize: '12px', textTransform: 'uppercase', color: '#71717a', fontWeight: '700', letterSpacing: '1px', marginBottom: '12px' }}>Gestión</p>
            <button style={buttonStyle} onClick={() => setShowKidModal(true)}>👶 Añadir Nuevo Niño</button>
            <button style={buttonStyle} onClick={() => setShowZoneModal(true)}>🛑 Configurar Zona</button>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '12px', textTransform: 'uppercase', color: '#71717a', fontWeight: '700', letterSpacing: '1px', marginBottom: '12px' }}>Filtros</p>
            <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} style={dateInputStyle} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <input type="time" value={historyStartTime} onChange={e => setHistoryStartTime(e.target.value)} style={{...dateInputStyle, flex: 1}} />
              <input type="time" value={historyEndTime} onChange={e => setHistoryEndTime(e.target.value)} style={{...dateInputStyle, flex: 1}} />
            </div>
            <button onClick={handleSearchHistory} disabled={isLoadingHistory} style={{ ...primaryButtonStyle, width: '100%', marginTop: '8px' }}>
              {isLoadingHistory ? 'Buscando...' : '🔍 Buscar Ruta'}
            </button>
          </div>
        )}
        
        <button style={dangerButtonStyle} onClick={() => setLoggedUser(null)}>🚪 Cerrar Sesión</button>
      </div>

      {/* MAPA PRINCIPAL */}
      <div style={mapWrapperStyle}>
        
        {/* Selector de niños superior */}
        <div style={{ position: 'absolute', top: '24px', left: '24px', zIndex: 10, display: 'flex', gap: '10px', flexWrap: 'wrap', maxWidth: '70%' }}>
          {kids.map(kid => (
            <button
              key={kid.tag_id}
              onClick={() => setSelectedKidTag(kid.tag_id)}
              style={{ 
                padding: '8px 16px', 
                borderRadius: '30px', 
                border: selectedKidTag === kid.tag_id ? '1px solid #60a5fa' : '1px solid #3f3f46', 
                backgroundColor: selectedKidTag === kid.tag_id ? 'rgba(59, 130, 246, 0.9)' : 'rgba(39, 39, 42, 0.9)', 
                color: 'white', 
                fontWeight: '500',
                fontSize: '14px',
                cursor: 'pointer',
                backdropFilter: 'blur(4px)',
                transition: 'all 0.2s',
                boxShadow: selectedKidTag === kid.tag_id ? '0 4px 12px -2px rgba(59, 130, 246, 0.5)' : '0 2px 4px rgba(0,0,0,0.2)'
              }}
            >
              {kid.name}
            </button>
          ))}
        </div>

        {/* Controles de Zoom */}
        <div style={{ position: 'absolute', bottom: '24px', right: '24px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '8px' }}>
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