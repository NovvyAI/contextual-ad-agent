<script setup lang="ts">
import type { ChatMessagesData, AIMessage } from "@/types/chatMessagesData";
import { contentRegistry } from "./registry";

defineProps<{ messages: ChatMessagesData[]; episodeId: number; matchSessionId?: number }>();
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px; padding: 16px; overflow-y: auto; flex: 1">
    <div
      v-for="message in messages"
      :key="message.id"
      :style="{ display: 'flex', flexDirection: 'column', alignItems: message.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }"
    >
      <div style="font-size: 12px; color: var(--td-text-color-placeholder, #999)">
        {{ message.role === "user" ? "我" : (message as AIMessage).name ?? "系统" }}
      </div>
      <template v-if="message.role !== 'system'">
        <component
          :is="contentRegistry[item.type] ?? contentRegistry.text"
          v-for="item in message.content"
          :key="item.id ?? item.type"
          :content="item"
          :episode-id="episodeId"
          :match-session-id="matchSessionId"
        />
      </template>
      <div v-if="message.status === 'error'" style="color: var(--td-error-color, #d54941); font-size: 13px">{{ message.ext?.error ?? "出错了" }}</div>
    </div>
  </div>
</template>
