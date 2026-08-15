import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Tauri 期望固定端口 + 不清屏（替代 electron.vite.config.ts 的 renderer 段）
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  // 输出到 apps/desktop/dist（tauri.conf.json 的 frontendDist = ../dist）
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') }
    }
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true
  }
})
