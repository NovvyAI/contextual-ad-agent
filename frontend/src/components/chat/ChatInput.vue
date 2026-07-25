<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ generating: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();

const text = ref("");

function handleSend() {
  if (!text.value.trim() || props.generating) return;
  emit("send", text.value);
  text.value = "";
}
</script>

<template>
  <div style="display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--td-border-level-2-color, #e7e7e7)">
    <t-textarea v-model="text" placeholder="对某个方案/内容提出修改意见..." :autosize="{ minRows: 1, maxRows: 4 }" @keydown.enter.exact.prevent="handleSend" />
    <t-button v-if="!generating" theme="primary" @click="handleSend">发送</t-button>
    <t-button v-else theme="danger" @click="emit('stop')">停止</t-button>
  </div>
</template>
