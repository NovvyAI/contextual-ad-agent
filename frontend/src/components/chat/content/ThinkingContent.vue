<script setup lang="ts">
import { ref } from "vue";
import type { ThinkingContent } from "@/types/chatMessagesData";

const props = defineProps<{ content: ThinkingContent }>();
const collapsed = ref(props.content.ext?.collapsed ?? true);
</script>

<template>
  <div style="border-left: 2px solid var(--td-border-level-2-color, #e7e7e7); padding-left: 8px">
    <div style="cursor: pointer; color: var(--td-text-color-placeholder, #999); font-size: 13px" @click="collapsed = !collapsed">
      {{ content.data.title || "思考中..." }}
      <span>{{ collapsed ? "展开" : "收起" }}</span>
    </div>
    <div v-if="!collapsed" style="white-space: pre-wrap; color: var(--td-text-color-secondary, #666); margin-top: 4px">{{ content.data.text }}</div>
  </div>
</template>
