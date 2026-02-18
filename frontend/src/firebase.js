import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeFirestore, 
  getFirestore, 
  terminate, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB1bl5uvZAsg1_UcXVIZBDyapJ3JmlLaGM", // <--- REVISA QUE ESTO ESTÉ BIEN
  authDomain: "data-project-2-kids.firebaseapp.com",
  projectId: "data-project-2-kids",
};

let app;
let db;

// 1. Patrón Singleton para la APP
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp(); // Usa la que ya existe si Vite recarga
}

// 2. Inicialización forzada de Firestore
try {
  // Intentamos obtener la instancia existente
  const existingDb = getFirestore(app);
  
  // Si existe pero está apuntando a la base de datos incorrecta (default), hay que matarla
  if (existingDb._databaseId && existingDb._databaseId.database !== "location-db") {
     console.warn("⚠️ Detectada conexión a BD incorrecta. Reiniciando Firebase...");
     terminate(existingDb); // <--- ESTO MATA LA CONEXIÓN VIEJA
     throw new Error("Re-inicializar");
  }
  db = existingDb;
} catch (e) {
  // Si no existía o la hemos matado, la creamos bien
  db = initializeFirestore(app, {
      databaseId: "location-db", // <--- LA CLAVE
      localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
  });
  console.log("✅ Firebase inicializado apuntando a: location-db");
}

export { db };