<script setup lang="ts">
import type { AIMessageContent } from "@/types/chatMessagesData";

// search/suggestion/toolcall/activity/reasoning 共用兜底——sessionAgent 的 chat 只有 4 个 revise
// 工具，实际不太会产出这些 Toonflow 专属类型，先原样展示 JSON，不单独做卡片
defineProps<{ content: AIMessageContent }>();
</script>

<template>
  <pre style="white-space: pre-wrap; word-break: break-word; font-size: 12px; color: var(--td-text-color-placeholder, #999); margin: 0">{{
    JSON.stringify(content.data, null, 2)
  }}</pre>
</template>
