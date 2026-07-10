import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) return "maplibre";
          if (id.includes("echarts") || id.includes("zrender")) return "charts";
          if (id.includes("lucide-vue-next")) return "icons";
          if (id.includes("node_modules/vue")) return "vue";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: { "/api": "http://127.0.0.1:17420", "/health": "http://127.0.0.1:17420" },
  },
});
