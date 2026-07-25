<script setup lang="ts">
import type { StoryboardCutContent } from "@/types/chatMessagesData";

defineProps<{ content: StoryboardCutContent; episodeId: number }>();

const statusLabel: Record<string, string> = { draft: "草案待确认", draftConfirmed: "已确认，等待渲染" };
</script>

<template>
  <t-card :title="`分镜草案 #${content.data.bridgeCutId}`" style="max-width: 480px">
    <template #actions>
      <t-tag theme="default" variant="light">{{ statusLabel[content.data.status] ?? content.data.status }}</t-tag>
    </template>
    <t-space direction="vertical" style="width: 100%">
      <img :src="content.data.imageUrl" style="width: 100%; border-radius: 6px" alt="分镜草案" />
      <div style="font-size: 13px; color: var(--td-text-color-secondary, #666)">{{ content.data.prompt }}</div>
      <div><b>参考分：</b>{{ content.data.evaluatorScore }}</div>
      <div v-if="content.data.evaluatorFeedback" style="font-size: 13px; color: var(--td-text-color-secondary, #666)">
        {{ content.data.evaluatorFeedback }}
      </div>
      <div style="font-size: 12px; color: var(--td-text-color-placeholder, #999)">不满意可以在下面输入框里描述想要的修改，如"画面再明亮一点"</div>
    </t-space>
  </t-card>
</template>
