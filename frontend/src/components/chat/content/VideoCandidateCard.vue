<script setup lang="ts">
import type { VideoCandidateContent } from "@/types/chatMessagesData";

defineProps<{ content: VideoCandidateContent; episodeId: number }>();
</script>

<template>
  <t-card :title="`成片 #${content.data.bridgeCutId}`" style="max-width: 480px">
    <t-space direction="vertical" style="width: 100%">
      <video :src="content.data.videoUrl" controls style="width: 100%; border-radius: 6px" />
      <div><b>时长：</b>{{ (content.data.durationMs / 1000).toFixed(1) }}秒 <b>参考分：</b>{{ content.data.evaluatorScore }}</div>
      <div v-if="content.data.evaluatorFeedback" style="font-size: 13px; color: var(--td-text-color-secondary, #666)">
        {{ content.data.evaluatorFeedback }}
      </div>
    </t-space>
  </t-card>
</template>
