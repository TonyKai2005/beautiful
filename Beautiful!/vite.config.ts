import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 4174,
    allowedHosts: ["terminal.local"],
    proxy: {
      "/api/v1": "http://127.0.0.1:4175",
    },
    warmup: {
      clientFiles: ["./src/main.ts"],
    },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        public: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin/index.html"),
      },
    },
  },
});
