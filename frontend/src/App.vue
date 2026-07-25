<script setup lang="ts">
import { useRoute } from "vue-router";
import AppHeader from "@/components/layout/AppHeader.vue";

const route = useRoute();
</script>

<template>
  <AppHeader v-if="route.name !== 'login'" />
  <router-view />
</template>
