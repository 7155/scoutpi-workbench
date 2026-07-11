import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium-static";

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`),
  },
  plugins: [
    vue(),
    viteStaticCopy({
      targets: ["ThirdParty", "Workers", "Assets", "Widgets"].map((directory) => ({
        src: `${cesiumSource}/${directory}/**/*`,
        dest: `${cesiumBaseUrl}/${directory}`,
        rename: { stripBase: 5 },
      })),
    }),
  ],
  build: {
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("cesium")) return "cesium";
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
