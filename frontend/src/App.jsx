import React from 'react';
import DeckGL from '@deck.gl/react';
import { Map } from 'react-map-gl';
import { PathLayer, PolygonLayer } from '@deck.gl/layers';

// 1. CONFIGURACIÓN: Centro de Valencia
const INITIAL_VIEW_STATE = {
  longitude: -0.376288, 
  latitude: 39.469907,
  zoom: 15,
  pitch: 45, // Inclinación 3D
  bearing: 0
};

// 2. DATOS DE EJEMPLO (Simulando lo que vendrá de Dataflow)
const ZONA_ROJA = [
  {
    polygon: [
      [-0.3775, 39.4705],
      [-0.3765, 39.4705],
      [-0.3765, 39.4695],
      [-0.3775, 39.4695],
      [-0.3775, 39.4705] // Cierra el cuadrado
    ]
  }
];

const RUTA_NIÑO = [
  {
    path: [
      [-0.3750, 39.4680], 
      [-0.3755, 39.4685], 
      [-0.3760, 39.4690], 
      [-0.3758, 39.4700]
    ],
    color: [0, 150, 255] // Azul
  }
];

function App() {
  // 3. DEFINICIÓN DE CAPAS
  const layers = [
    new PolygonLayer({
      id: 'zonas-prohibidas',
      data: ZONA_ROJA,
      getPolygon: d => d.polygon,
      getFillColor: [255, 0, 0, 100], // Rojo transparente
      getLineColor: [255, 0, 0, 255], // Borde rojo
      getLineWidth: 2,
      pickable: true,
    }),
    new PathLayer({
      id: 'ruta-niño',
      data: RUTA_NIÑO,
      getPath: d => d.path,
      getColor: d => d.color,
      getWidth: 10,
      widthMinPixels: 4,
      jointRounded: true,
      capRounded: true
    })
  ];

  return (
    <DeckGL
      initialViewState={INITIAL_VIEW_STATE}
      controller={true} // Permite mover el mapa
      layers={layers}
    >
      <Map
        mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/light-v11" // Estilo gris claro
      />
      
      {/* PEQUEÑA LEYENDA FLOTANTE */}
      <div style={{position: 'absolute', top: 10, left: 10, background: 'white', padding: 10, borderRadius: 5}}>
        <div>🔴 Zona Prohibida</div>
        <div>🔵 Ruta Niño</div>
      </div>
    </DeckGL>
  );
}

export default App;