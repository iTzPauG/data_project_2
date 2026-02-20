import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  initializeFirestore, 
  getFirestore, 
  persistentLocalCache, 
  persistentMultipleTabManager 
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAFhzDBWGZ7uNTR7caksYWauGs7Zz-nsHE", 
  authDomain: "data-project-2-kids.firebaseapp.com",
  projectId: "data-project-2-kids",
};

// 1. Inicialización de la App (Singleton)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// 2. Inicialización de Firestore
let db;

try {
  // Intentamos inicializar CON la configuración específica y el nombre de la BD
  // NOTA: El segundo parámetro son los settings, el tercero es el nombre de la BD
  db = initializeFirestore(app, {
      localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
  }, "location-db"); 

  console.log("✅ Firestore inicializado correctamente: location-db");

} catch (e) {
  // El error "failed to initialize" suele pasar si ya se ha llamado a getFirestore antes en otra parte.
  // En ese caso, simplemente recuperamos la instancia existente apuntando a la BD correcta.
  console.warn("⚠️ Firestore ya estaba inicializado, recuperando instancia existing...");
  db = getFirestore(app, "location-db");
}

// 3. Exportamos al final, fuera de cualquier bloque
export { db };