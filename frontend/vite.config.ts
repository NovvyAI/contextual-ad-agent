import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://localhost:10588",
      "/oss": "http://localhost:10588",
    },
  },
  build: {
    // 产物直接落到后端 app.ts 已知的静态目录，yarn build 之后无需再手动挪文件
    outDir: "../data/web",
    emptyOutDir: true,
  },
});
