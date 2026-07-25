<script setup lang="ts">
import type { SupervisorResultContent } from "@/types/chatMessagesData";

defineProps<{ content: SupervisorResultContent; episodeId: number }>();
</script>

<template>
  <t-card :title="`落地终审 · cut #${content.data.bridgeCutId}`" style="max-width: 480px">
    <template #actions>
      <t-tag :theme="content.data.passed ? 'success' : 'danger'" variant="light">{{ content.data.passed ? "通过" : "未通过（已拦截）" }}</t-tag>
    </template>
    <t-space direction="vertical" style="width: 100%">
      <div>内容合规：{{ content.data.contentCompliance }} · 品牌安全：{{ content.data.brandSafety }} · 技术规格：{{ content.data.technicalSpec }}</div>
      <div>{{ content.data.feedback }}</div>
      <ul v-if="content.data.issues.length" style="margin: 0; padding-left: 18px; color: var(--td-error-color, #d54941)">
        <li v-for="(issue, i) in content.data.issues" :key="i">{{ issue }}</li>
      </ul>
    </t-space>
  </t-card>
</template>
