<script setup lang="ts">
import { ref } from "vue";

// M0 阶段的最小验证页面：只用来证明 Express + JWT 中间件 + 静态资源服务 +
// Vite 开发代理这条链路是通的，不是真正的产品界面。

const status = ref("尚未开始");
const token = ref("");
const vendorList = ref<unknown>(null);
const error = ref("");

async function runCheck() {
  error.value = "";
  vendorList.value = null;
  try {
    status.value = "正在登录...";
    const loginRes = await fetch("/api/login/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin123" }),
    });
    const loginJson = await loginRes.json();
    if (!loginRes.ok) throw new Error(loginJson.message ?? "登录失败");
    token.value = loginJson.data.token;

    status.value = "正在请求供应商列表...";
    const listRes = await fetch("/api/setting/vendorConfig/getVendorList", {
      method: "POST",
      headers: { Authorization: token.value },
    });
    const listJson = await listRes.json();
    if (!listRes.ok) throw new Error(listJson.message ?? "请求失败");
    vendorList.value = listJson.data;
    status.value = "完成";
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    status.value = "失败";
  }
}
</script>

<template>
  <main style="font-family: monospace; padding: 24px; max-width: 720px; margin: 0 auto">
    <h1>contextual-ad-agent · M0 联通性检查</h1>
    <p>状态：{{ status }}</p>
    <button @click="runCheck">登录并拉取供应商列表</button>
    <p v-if="error" style="color: crimson">错误：{{ error }}</p>
    <pre v-if="vendorList">{{ JSON.stringify(vendorList, null, 2) }}</pre>
  </main>
</template>
