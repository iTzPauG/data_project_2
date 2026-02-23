import React, { useState, useEffect, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import axios from 'axios';

// --- IMPORTAR FIREBASE ---
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import 'mapbox-gl/dist/mapbox-gl.css';

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

  useEffect(() => {
    const timer = setTimeout(() => setMapReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Cargar niños de la DB al loguearse y auto-seleccionar el primero
  useEffect(() => {
    if (!loggedUser) return;

    const fetchKids = async () => {
      try {
        const res = await axios.get(`${API_URL}/kids/${loggedUser.user_id}`);
        setKids(res.data);

        // Autoseleccionar el primer niño
        if (res.data.length > 0 && !selectedKidTag) {
          setSelectedKidTag(res.data[0].tag_id);
        }
      } catch (error) {
        console.error("Error cargando niños:", error);
      }
    };

    fetchKids();
  }, [loggedUser]); // Quitamos dependencias extra para evitar loops

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

  // Al cambiar de niño, resetear el centrado para la vista en vivo
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
        }
      },
      (error) => console.error("Error Firebase:", error)
    );

    return () => unsubscribe();
  }, [selectedKidTag, haCentradoInicial, activeView, loggedUser]);

  // --- 4. MANEJADORES DE DATOS ---

  // NUEVO: Función envuelta en useCallback para poder llamarla desde el useEffect
  const handleSearchHistory = useCallback(async () => {
    if (!selectedKidTag) return;
    setIsLoadingHistory(true);

    // CORRECCIÓN FINAL: Volvemos a usar toISOString()
    // Esto coge la hora de España y la pasa a UTC para que coincida
    // exactamente con el reloj de tu servidor de Google Cloud Run.
    const startIso = new Date(`${historyDate}T${historyStartTime}:00`).toISOString();
    const endIso = new Date(`${historyDate}T${historyEndTime}:00`).toISOString();

    try {
      const response = await axios.get(`${API_URL}/history/${selectedKidTag}`, {
        params: { start_time: startIso, end_time: endIso }
      });

      // DeckGL necesita un mínimo de 2 puntos para poder trazar una línea.
      if (response.data.path && response.data.path.length > 1) {
        setHistoryRoute({ path: response.data.path });
        setViewState(prev => ({ ...prev, longitude: response.data.path[0][0], latitude: response.data.path[0][1], zoom: 15, pitch: 45, transitionDuration: 1500 }));
      } else if (response.data.path && response.data.path.length === 1) {
        // Si solo hay 1 punto en ese rango de tiempo, avisamos (no se puede hacer una línea con 1 punto)
        alert("Solo hay 1 punto de ubicación en este rango de tiempo. Se necesitan al menos 2 para dibujar una ruta.");
        setHistoryRoute(null);
      } else {
        setHistoryRoute(null); // No hay datos, limpiamos la ruta
      }
    } catch (error) {
      console.error("Error consultando historial:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [selectedKidTag, historyDate, historyStartTime, historyEndTime]);

  // NUEVO: Efecto para recargar el historial automáticamente al cambiar de niño o de vista
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
        zone_type: nuevaZona.zone_type,
        zone_name: nuevaZona.zone_name,
      });
      setZonasSQL([...zonasSQL, { ...nuevaZona, user_id: TARGET_USER_ID }]);
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
      case 'emergencia': return [255, 0, 0, 80]; // rojo
      case 'zona_segura': return [0, 255, 0, 80]; // verde
      default: return [255, 165, 0, 80]; // naranja para aviso
    }
  };

  const getZoneLineColor = (zoneType) => {
    switch(zoneType) {
      case 'emergencia': return [255, 0, 0, 255];
      case 'zona_segura': return [0, 255, 0, 255];
      default: return [255, 165, 0, 255];
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
      getFillColor: [66, 133, 244, 255], getLineColor: [255, 255, 255, 255], getLineWidth: 3,
      transitions: { getPosition: 1000 }
    }),
    activeView === 'history' && historyRoute && new PathLayer({
      id: 'history-path', data: [historyRoute], pickable: true, widthScale: 1, widthMinPixels: 4,
      getPath: d => d.path, getColor: [59, 130, 246, 200], getWidth: 5
    })
  ].filter(Boolean);

  // --- 6. ESTILOS COMPARTIDOS ---
  const modalInputStyle = {
    width: '100%', padding: '11px 12px', marginBottom: '12px', borderRadius: '8px',
    border: '1px solid #1e293b', backgroundColor: '#0f1923', color: '#f1f5f9',
    fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', colorScheme: 'dark'
  };

  // ==========================================
  // PANTALLA LOGIN / REGISTRO
  // ==========================================
  if (!loggedUser) {
    return (
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#111921', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ width: '420px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'center', marginBottom: '28px' }}>
            <div style={{ backgroundColor: '#4799eb', padding: '8px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px', color: '#fff', display: 'block', lineHeight: 1 }}>family_restroom</span>
            </div>
            <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#f1f5f9', margin: 0, letterSpacing: '-0.025em' }}>FamTrack</h1>
          </div>

          <form onSubmit={handleAuth} style={{ backgroundColor: '#1a2332', padding: '36px', borderRadius: '16px', border: '1px solid #1e293b', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
            <h2 style={{ color: '#f1f5f9', textAlign: 'center', marginTop: 0, marginBottom: '24px', fontSize: '18px', fontWeight: '700' }}>
              {isLoginMode ? 'Iniciar sesión' : 'Crear nueva cuenta'}
            </h2>

            {authError && (
              <div style={{ backgroundColor: 'rgba(220, 38, 38, 0.12)', color: '#f87171', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', textAlign: 'center', border: '1px solid rgba(220, 38, 38, 0.25)' }}>
                {authError}
              </div>
            )}

            {!isLoginMode && (
              <>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input type="text" placeholder="Nombre" value={regNombre} onChange={e => setRegNombre(e.target.value)} style={modalInputStyle} required />
                  <input type="text" placeholder="Apellidos" value={regApellidos} onChange={e => setRegApellidos(e.target.value)} style={modalInputStyle} required />
                </div>
                <input type="tel" placeholder="Teléfono" value={regTelefono} onChange={e => setRegTelefono(e.target.value)} style={modalInputStyle} required />
              </>
            )}

            <input type="email" placeholder="Correo Electrónico" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} style={modalInputStyle} required />
            <input type="password" placeholder="Contraseña" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} style={{ ...modalInputStyle, marginBottom: '22px' }} required />

            <button type="submit" disabled={isAuthenticating} style={{ width: '100%', padding: '13px', backgroundColor: '#4799eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', fontFamily: 'inherit', opacity: isAuthenticating ? 0.7 : 1 }}>
              {isAuthenticating ? 'Procesando...' : (isLoginMode ? 'Entrar al Panel' : 'Registrarse')}
            </button>

            <div style={{ textAlign: 'center', color: '#475569', fontSize: '13px', marginTop: '18px' }}>
              {isLoginMode ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
              <span onClick={() => setIsLoginMode(!isLoginMode)} style={{ color: '#4799eb', cursor: 'pointer', textDecoration: 'underline' }}>
                {isLoginMode ? 'Regístrate aquí' : 'Inicia sesión'}
              </span>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // PANTALLA PRINCIPAL
  // ==========================================
  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", backgroundColor: '#111921', color: '#f1f5f9', height: '100vh', width: '100vw', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

      {/* MODAL: AÑADIR NIÑO */}
      {showKidModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1a2332', padding: '32px', borderRadius: '16px', width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)', color: '#f1f5f9', border: '1px solid #1e293b' }}>
            <h3 style={{ marginTop: 0, fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>Registrar Nuevo Niño</h3>
            <input type="text" placeholder="Nombre" value={kidName} onChange={e => setKidName(e.target.value)} style={modalInputStyle} />
            <input type="text" placeholder="Tag ID del dispositivo" value={deviceTag} onChange={e => setDeviceTag(e.target.value)} style={{ ...modalInputStyle, marginBottom: '22px' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowKidModal(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Cancelar</button>
              <button onClick={handleSaveKid} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#4799eb', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AÑADIR ZONA */}
      {showZoneModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
          <div style={{ backgroundColor: '#1a2332', padding: '30px', borderRadius: '16px', width: '700px', maxWidth: '95vw', border: '1px solid #1e293b', color: '#f1f5f9', display: 'flex', flexDirection: 'column', gap: '14px', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>

            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Nueva Zona Restringida</h3>
            <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>
              Haz clic en el mapa para seleccionar el centro de la zona.
            </p>

            {/* MAPA del modal */}
            <div style={{ position: 'relative', height: '380px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #1e293b' }}>
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
              <label style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>
                Radio: <strong style={{ color: '#4799eb' }}>{nuevaZona.radius} m</strong>
              </label>
              <input
                type="range" min="20" max="500" step="10"
                value={nuevaZona.radius}
                onChange={e => setNuevaZona(prev => ({ ...prev, radius: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: '#4799eb' }}
              />
            </div>
            <input
              type="range"
              min="20"
              max="600"
              step="10"
              value={nuevaZona.radius}
              onChange={e => setNuevaZona({...nuevaZona, radius: Number(e.target.value)})}
              style={{ width: '100%', marginBottom: '20px', cursor: 'pointer' }}
            />

            <select style={modalInputStyle} value={nuevaZona.tag_id} onChange={e => setNuevaZona({...nuevaZona, tag_id: e.target.value})}>
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

            <select style={modalInputStyle} value={nuevaZona.zone_type} onChange={e => setNuevaZona({...nuevaZona, zone_type: e.target.value})}>
              <option value="aviso">⚠️ Aviso</option>
              <option value="emergencia">🚨 Emergencia</option>
              <option value="zona_segura">✅ Zona Segura</option>
            </select>

            <input
              type="text"
              placeholder="Nombre de la zona (Ej: Parque Central)"
              value={nuevaZona.zone_name}
              onChange={e => setNuevaZona({...nuevaZona, zone_name: e.target.value})}
              style={{ ...modalInputStyle, marginBottom: 0 }}
            />

            {/* BOTONES */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => {
                  setShowZoneModal(false);
                  setNuevaZona({ latitude: null, longitude: null, radius: 50, tag_id: "" });
                }}
                style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #1e293b', backgroundColor: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveZone}
                disabled={isSavingZone}
                style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit', opacity: isSavingZone ? 0.6 : 1 }}
              >
                {isSavingZone ? 'Guardando...' : '✅ Confirmar Zona'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- TOP NAVIGATION BAR --- */}
      <header style={{ zIndex: 50, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(17, 25, 33, 0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1e293b', padding: '10px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ backgroundColor: '#4799eb', padding: '6px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px', color: '#fff', display: 'block', lineHeight: 1 }}>family_restroom</span>
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.025em', color: '#f1f5f9', margin: 0 }}>FamTrack</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button style={{ position: 'relative', padding: '8px', borderRadius: '50%', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="material-symbols-outlined" style={{ color: '#94a3b8', fontSize: '22px', display: 'block', lineHeight: 1 }}>notifications</span>
            <span style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid #111921' }}></span>
          </button>
          <div style={{ height: '28px', width: '1px', backgroundColor: '#1e293b' }}></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: '#f1f5f9', lineHeight: 1 }}>{loggedUser.nombre}</p>
              <p style={{ fontSize: '12px', color: '#475569', margin: '4px 0 0 0' }}>FamTrack</p>
            </div>
          </div>
        </div>
      </header>

      {/* --- CONTENT AREA --- */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* --- LEFT SIDEBAR --- */}
        <aside style={{ width: '210px', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: '4px', backgroundColor: '#111921', borderRight: '1px solid #1e293b', zIndex: 40, overflowY: 'auto' }}>

          {/* En Vivo */}
          <button
            style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: activeView === 'live' ? 'rgba(71, 153, 235, 0.12)' : 'transparent', padding: '12px 14px', borderRadius: '12px', border: activeView === 'live' ? '1px solid rgba(71, 153, 235, 0.3)' : '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
            onClick={() => setActiveView('live')}
          >
            <span className="material-symbols-outlined" style={{ color: activeView === 'live' ? '#4799eb' : '#475569', fontSize: '22px', flexShrink: 0 }}>my_location</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Tracking</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: activeView === 'live' ? '#4799eb' : '#f1f5f9', margin: '3px 0 0 0' }}>En Vivo</p>
            </div>
          </button>

          {/* Historial */}
          <button
            style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: activeView === 'history' ? 'rgba(249, 115, 22, 0.12)' : 'transparent', padding: '12px 14px', borderRadius: '12px', border: activeView === 'history' ? '1px solid rgba(249, 115, 22, 0.3)' : '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}
            onClick={() => setActiveView(activeView === 'history' ? 'live' : 'history')}
          >
            <span className="material-symbols-outlined" style={{ color: activeView === 'history' ? '#f97316' : '#475569', fontSize: '22px', flexShrink: 0 }}>history</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Rutas</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: activeView === 'history' ? '#f97316' : '#f1f5f9', margin: '3px 0 0 0' }}>Historial</p>
            </div>
          </button>

          {/* History controls — inline when active */}
          {activeView === 'history' && (
            <div style={{ padding: '12px', backgroundColor: '#0f1923', borderRadius: '12px', border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '8px', margin: '2px 0' }}>
              <input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} style={{ ...modalInputStyle, marginBottom: 0 }} />
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="time" value={historyStartTime} onChange={e => setHistoryStartTime(e.target.value)} style={{ ...modalInputStyle, marginBottom: 0, flex: 1 }} />
                <input type="time" value={historyEndTime} onChange={e => setHistoryEndTime(e.target.value)} style={{ ...modalInputStyle, marginBottom: 0, flex: 1 }} />
              </div>
              <button onClick={handleSearchHistory} disabled={isLoadingHistory} style={{ padding: '9px', borderRadius: '8px', border: 'none', backgroundColor: '#10b981', color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: '700', fontFamily: 'inherit', opacity: isLoadingHistory ? 0.6 : 1 }}>
                {isLoadingHistory ? 'Cargando...' : 'Buscar ruta'}
              </button>
            </div>
          )}

          <div style={{ height: '1px', backgroundColor: '#1e293b', margin: '8px 0' }}></div>

          {/* Añadir Niño */}
          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }} onClick={() => setShowKidModal(true)}>
            <span className="material-symbols-outlined" style={{ color: '#4799eb', fontSize: '22px', flexShrink: 0 }}>group</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Familia</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Añadir Niño</p>
            </div>
          </button>

          {/* Geocercas */}
          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }} onClick={() => setShowZoneModal(true)}>
            <span className="material-symbols-outlined" style={{ color: '#22c55e', fontSize: '22px', flexShrink: 0 }}>security</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>Seguridad</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Geocercas</p>
            </div>
          </button>

          {/* Alertas */}
          <button style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'transparent', padding: '12px 14px', borderRadius: '12px', border: '1px solid transparent', cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit' }}>
            <span className="material-symbols-outlined" style={{ color: '#ef4444', fontSize: '22px', flexShrink: 0 }}>warning</span>
            <div>
              <p style={{ fontSize: '10px', fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, lineHeight: 1 }}>S.O.S</p>
              <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: '3px 0 0 0' }}>Alertas</p>
            </div>
          </button>

          {/* Logout */}
          <div style={{ marginTop: 'auto' }}>
            <button style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', color: '#475569', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }} onClick={() => setLoggedUser(null)}>
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>logout</span>
              <span style={{ fontSize: '14px', fontWeight: '600' }}>Salir</span>
            </button>
          </div>
        </aside>

        {/* --- MAP AREA --- */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Map fills the entire area */}
          <div style={{ position: 'absolute', inset: 0, backgroundColor: '#0f1923' }}>
            {mapReady && (
              <DeckGL viewState={viewState} onViewStateChange={e => setViewState(e.viewState)} controller={true} layers={mainLayers}>
                <Map mapboxAccessToken={MAPBOX_TOKEN} mapStyle="mapbox://styles/mapbox/dark-v11" />
              </DeckGL>
            )}
          </div>

          {/* Kid selector pills */}
          <div style={{ position: 'absolute', top: '24px', left: '24px', right: '24px', display: 'flex', flexWrap: 'wrap', gap: '10px', zIndex: 10 }}>
            {kids.map(kid => (
              <button
                key={kid.tag_id}
                onClick={() => setSelectedKidTag(kid.tag_id)}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 20px', borderRadius: '9999px', border: 'none', fontWeight: '700', cursor: 'pointer', backgroundColor: selectedKidTag === kid.tag_id ? '#4799eb' : 'rgba(17, 25, 33, 0.92)', color: selectedKidTag === kid.tag_id ? '#fff' : '#94a3b8', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', fontSize: '14px', fontFamily: 'inherit' }}
              >
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
                <span style={{ fontSize: '11px', fontWeight: '500', backgroundColor: activeView === 'history' ? 'rgba(249, 115, 22, 0.15)' : 'rgba(34, 197, 94, 0.15)', color: activeView === 'history' ? '#fb923c' : '#4ade80', padding: '4px 10px', borderRadius: '9999px' }}>
                  {activeView === 'history' ? 'Historial' : (kids.length > 0 ? 'En Vivo' : 'Sin niños')}
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
                    <div key={kid.tag_id} onClick={() => setSelectedKidTag(kid.tag_id)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: selectedKidTag === kid.tag_id ? 'rgba(71, 153, 235, 0.12)' : '#0f1923', padding: '12px', borderRadius: '12px', minWidth: '200px', border: `1px solid ${selectedKidTag === kid.tag_id ? 'rgba(71, 153, 235, 0.35)' : '#1e293b'}`, cursor: 'pointer' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#1a2332', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ color: '#4799eb', fontSize: '20px' }}>child_care</span>
                      </div>
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9', margin: 0 }}>{kid.name}</p>
                        <p style={{ fontSize: '11px', color: '#64748b', margin: '3px 0 0 0' }}>Tag ID: {kid.tag_id}</p>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className="material-symbols-outlined" style={{ color: activeView === 'live' ? '#4ade80' : '#fb923c', fontSize: '14px' }}>
                          {activeView === 'live' ? 'wifi' : 'history'}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: activeView === 'live' ? '#4ade80' : '#fb923c' }}>
                          {activeView === 'live' ? 'Live' : 'Hist.'}
                        </span>
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
