import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Servido em iuri1911.github.io/piano-jazz-personal/, entao o build precisa
// do prefixo do repo nos assets. O dev server continua na raiz.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/piano-jazz-personal/' : '/',
  plugins: [react()],
}))
