<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { MessagePlugin } from "tdesign-vue-next";
import http from "@/utils/http";

const router = useRouter();
const route = useRoute();

const username = ref("admin");
const password = ref("admin123");
const loading = ref(false);

async function handleLogin() {
  loading.value = true;
  try {
    const res = (await http.post("/api/login/login", { username: username.value, password: password.value })) as any;
    localStorage.setItem("token", res.data.token);
    router.push((route.query.redirect as string) ?? "/episodes");
  } catch (e: any) {
    MessagePlugin.error(e?.message ?? "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div style="display: flex; align-items: center; justify-content: center; height: 100vh">
    <t-card title="contextual-ad-agent 登录" style="width: 360px">
      <t-space direction="vertical" style="width: 100%">
        <t-input v-model="username" placeholder="用户名" />
        <t-input v-model="password" type="password" placeholder="密码" @keydown.enter="handleLogin" />
        <t-button theme="primary" block :loading="loading" @click="handleLogin">登录</t-button>
      </t-space>
    </t-card>
  </div>
</template>
