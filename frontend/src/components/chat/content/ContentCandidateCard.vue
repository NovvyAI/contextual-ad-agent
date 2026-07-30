<script setup lang="ts">
import type { ContentCandidateContent } from "@/types/chatMessagesData";

defineProps<{ content: ContentCandidateContent; episodeId: number }>();

const typeLabel: Record<string, string> = { playableGame: "H5 小游戏", ctaCard: "CTA 卡片" };
</script>

<template>
  <t-card :title="`${typeLabel[content.data.type] ?? content.data.type} #${content.data.bridgeCutId}`" style="max-width: 480px">
    <t-space direction="vertical" style="width: 100%">
      <t-space v-if="content.data.custom || content.data.fallback">
        <t-tag v-if="content.data.custom" theme="primary" variant="light">自定义生成</t-tag>
        <t-tag v-if="content.data.fallback" theme="warning" variant="light">自定义生成失败，已回退默认版本</t-tag>
      </t-space>
      <div v-if="content.data.fallback && content.data.fallbackReason" style="font-size: 13px; color: var(--td-warning-color, #ed7b2f)">
        {{ content.data.fallbackReason }}
      </div>
      <iframe v-if="content.data.type === 'playableGame'" :src="content.data.previewUrl" style="width: 100%; height: 320px; border: none; border-radius: 6px" />
      <img v-else :src="content.data.previewUrl" style="width: 100%; border-radius: 6px" alt="CTA 卡片" />
      <div v-if="content.data.ctaUrl"><b>跳转链接：</b><a :href="content.data.ctaUrl" target="_blank" rel="noopener">{{ content.data.ctaUrl }}</a></div>
      <div><b>参考分：</b>{{ content.data.evaluatorScore }}</div>
      <div v-if="content.data.evaluatorFeedback" style="font-size: 13px; color: var(--td-text-color-secondary, #666)">
        {{ content.data.evaluatorFeedback }}
      </div>
    </t-space>
  </t-card>
</template>
