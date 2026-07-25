<script setup lang="ts">
import type { TextContent } from "@/types/chatMessagesData";

defineProps<{ content: TextContent }>();
</script>

<template>
  <div style="white-space: pre-wrap; word-break: break-word">{{ content.data }}</div>
</template>
