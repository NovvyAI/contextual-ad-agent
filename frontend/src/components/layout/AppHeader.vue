<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

function logout() {
  localStorage.removeItem("token");
  router.push("/login");
}
</script>

<template>
  <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; border-bottom: 1px solid var(--td-border-level-2-color, #e7e7e7)">
    <div style="display: flex; align-items: center; gap: 20px">
      <b>contextual-ad-agent</b>
      <router-link to="/episodes">Episodes</router-link>
      <router-link to="/ads">创意素材</router-link>
    </div>
    <t-button variant="text" @click="logout">退出登录</t-button>
  </div>
</template>
