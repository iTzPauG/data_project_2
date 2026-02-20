import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Esto asegura que Vite use la versión correcta de mapbox
      'mapbox-gl': 'mapbox-gl',
    },
  },
  // Esto evita problemas con dependencias antiguas
  optimizeDeps: {
    include: ['mapbox-gl', 'react-map-gl'],
  },
})