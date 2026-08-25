import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Servido em iuri1911.github.io/piano-jazz-personal/, entao os assets
// precisam do prefixo do repo. Em dev a base fica na raiz.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/piano-jazz-personal/' : '/',
  plugins: [react()],
})
