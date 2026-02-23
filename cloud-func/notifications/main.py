import base64
import json
import time
import functions_framework
from google.cloud import firestore

db = firestore.Client()

@functions_framework.cloud_event
def pubsub_to_firestore(cloud_event):
    try:
        mensaje_b64 = cloud_event.data["message"]["data"]
        mensaje_json = base64.b64decode(mensaje_b64).decode("utf-8")
        alerta = json.loads(mensaje_json)
        
        user_id = alerta.get("user_id")
        kid_name = alerta.get("kid_name", "Tu niño")
        zone_name = alerta.get("zone_name", "Zona Restringida")
        
        if not user_id:
            print("El mensaje no tiene user_id, se ignora.")
            return

        timestamp_ms = int(time.time() * 1000)
        
        doc_ref = db.collection("notifications").document()
        doc_ref.set({
            "user_id": str(user_id),
            "kid_name": str(kid_name),
            "zone_name": str(zone_name),
            "timestamp": timestamp_ms
        })
        
        print(f"✅ Alerta guardada en Firestore para usuario {user_id}: {kid_name} en {zone_name}")
        
    except Exception as e:
        print(f"❌ Error procesando el mensaje de Pub/Sub: {e}")