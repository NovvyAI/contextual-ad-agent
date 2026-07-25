<script setup lang="ts">
import type { ManifestContent } from "@/types/chatMessagesData";

defineProps<{ content: ManifestContent; episodeId: number }>();
</script>

<template>
  <t-card title="最终交付物" style="max-width: 480px">
    <t-space direction="vertical" style="width: 100%">
      <div><b>形式：</b>{{ content.data.type }}</div>
      <video v-if="content.data.type === 'video' || content.data.type === 'ctaCard'" :src="content.data.deliverableUrl" controls style="width: 100%; border-radius: 6px" />
      <iframe v-else :src="content.data.deliverableUrl" style="width: 100%; height: 320px; border: none; border-radius: 6px" />
      <t-link :href="content.data.deliverableUrl" target="_blank">在新窗口打开</t-link>
      <div v-if="content.data.ctaUrl"><b>跳转链接：</b><a :href="content.data.ctaUrl" target="_blank" rel="noopener">{{ content.data.ctaUrl }}</a></div>
    </t-space>
  </t-card>
</template>
