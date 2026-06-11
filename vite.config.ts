import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages раздаёт сайт из подпапки /alexion/; локальный dev — с корня
  base: command === 'build' ? '/alexion/' : '/',
}))
