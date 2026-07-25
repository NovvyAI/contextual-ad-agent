import { createApp } from "vue";
import { createPinia } from "pinia";
import "tdesign-vue-next/es/style/index.css";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { applyThemeMode, applyThemeColor } from "./utils/theme";

applyThemeMode("auto");
applyThemeColor("#0052d9");

createApp(App).use(createPinia()).use(router).mount("#app");
