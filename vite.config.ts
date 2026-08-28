import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Servido na raiz de keytrainer.iuri.io, entao os assets nao levam prefixo.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
