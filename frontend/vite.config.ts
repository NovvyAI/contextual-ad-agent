import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { TDesignResolver } from "@tdesign-vue-next/auto-import-resolver";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: "src/components.d.ts",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:10588", ws: true },
      "/oss": "http://localhost:10588",
      // Socket.IO 的引擎握手默认走 /socket.io/（不带 /api 前缀），单独代理一条
      "/socket.io": { target: "http://localhost:10588", ws: true },
    },
  },
  build: {
    // 产物直接落到后端 app.ts 已知的静态目录，yarn build 之后无需再手动挪文件
    outDir: "../data/web",
    emptyOutDir: true,
  },
});
