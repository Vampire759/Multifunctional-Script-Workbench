import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths()
  ],
  server: {
    port: 5173,
    proxy: {
      // 开发期：把 API 与 WebSocket 转发到 FastAPI 后端
      '/api': {
        target: 'http://127.0.0.1:8010',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
