<script setup lang="ts">
import { MessagePlugin } from "tdesign-vue-next";
import type { PlanCandidateContent } from "@/types/chatMessagesData";
import useSessionAgentStore from "@/stores/sessionAgent";

const props = defineProps<{ content: PlanCandidateContent; episodeId: number }>();

const formatLabel: Record<string, string> = { video: "桥接视频", playableGame: "H5 小游戏", ctaCard: "CTA 卡片" };
const statusLabel: Record<string, string> = { draft: "待确认", approved: "已确认", rejected: "已否决" };
const statusTheme: Record<string, "default" | "success" | "danger"> = { draft: "default", approved: "success", rejected: "danger" };

function handleApprove() {
  const store = useSessionAgentStore(props.episodeId);
  store.approvePlan(props.content.data.id);
  MessagePlugin.info("已发送确认请求");
}
</script>

<template>
  <t-card :title="`方案 #${content.data.id}（广告 ${content.data.adName ?? content.data.adId}）`" style="max-width: 560px">
    <template #actions>
      <t-tag :theme="statusTheme[content.data.status]" variant="light">{{ statusLabel[content.data.status] ?? content.data.status }}</t-tag>
    </template>
    <t-space direction="vertical" style="width: 100%">
      <div><b>形式：</b>{{ content.data.formatSequence.map((f) => formatLabel[f] ?? f).join("、") }}</div>
      <div><b>基调：</b>{{ content.data.tone }}</div>
      <div><b>创意构思：</b>{{ content.data.narrative }}</div>
      <div><b>参考分：</b>{{ content.data.planEvaluatorScore }}</div>
      <div v-if="content.data.evaluatorFeedback" style="color: var(--td-text-color-secondary, #666); font-size: 13px">
        {{ content.data.evaluatorFeedback.feedback }}
      </div>
      <t-button v-if="content.data.status === 'draft'" theme="primary" @click="handleApprove">确认这份方案</t-button>
    </t-space>
  </t-card>
</template>
