<script setup lang="ts">
import type { MarkdownContent } from "@/types/chatMessagesData";

// 范围边界内的决定：不引入 markdown 解析库，纯文本展示即可
defineProps<{ content: MarkdownContent }>();
</script>

<template>
  <pre style="white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0">{{ content.data }}</pre>
</template>
