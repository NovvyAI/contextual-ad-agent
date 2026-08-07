<script setup lang="ts">
// DirectorAgent 一次固定产出 2 份创意方案，这个组件负责把它们并排摆出来方便比较——
// 复用现成的 PlanCandidateCard（含确认/喜欢/不喜欢按钮），不重复实现卡片内容，
// 只是把每份方案包成一个独立的 planCandidate content 对象喂给它。
import type { PlanCandidatePairContent, PlanCandidateContent } from "@/types/chatMessagesData";
import PlanCandidateCard from "./PlanCandidateCard.vue";

const props = defineProps<{ content: PlanCandidatePairContent; episodeId: number; matchSessionId?: number }>();

function wrap(plan: PlanCandidateContent["data"]): PlanCandidateContent {
  return { type: "planCandidate", id: `${props.content.id}-${plan.id}`, data: plan, status: "complete" };
}
</script>

<template>
  <div style="display: flex; gap: 12px; flex-wrap: wrap">
    <PlanCandidateCard
      v-for="plan in content.data.plans"
      :key="plan.id"
      :content="wrap(plan)"
      :episode-id="episodeId"
      :match-session-id="matchSessionId"
      style="flex: 1; min-width: 280px"
    />
  </div>
</template>
