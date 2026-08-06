<script setup lang="ts">
import { ref } from "vue";
import { MessagePlugin } from "tdesign-vue-next";
import type { PlanCandidateContent } from "@/types/chatMessagesData";
import useSessionAgentStore from "@/stores/sessionAgent";

const props = defineProps<{ content: PlanCandidateContent; episodeId: number }>();

const statusLabel: Record<string, string> = { draft: "待确认", approved: "已确认", rejected: "已否决" };
const statusTheme: Record<string, "default" | "success" | "danger"> = { draft: "default", approved: "success", rejected: "danger" };

// 喜欢/不喜欢只是打分反馈，不影响审批流程；本地维护一份状态做即时视觉反馈，点击后落库供以后训练用
const localFeedback = ref<"like" | "dislike" | null>(props.content.data.feedback ?? null);

function handleApprove() {
  const store = useSessionAgentStore(props.episodeId);
  store.approvePlan(props.content.data.id);
  MessagePlugin.info("已发送确认请求");
}

function handleFeedback(value: "like" | "dislike") {
  const next = localFeedback.value === value ? null : value; // 再点一次同一个按钮取消选择
  localFeedback.value = next;
  const store = useSessionAgentStore(props.episodeId);
  store.setPlanFeedback(props.content.data.id, next);
}
</script>

<template>
  <t-card :title="`方案 #${content.data.id}（广告 ${content.data.adName ?? content.data.adId}）`" style="max-width: 560px">
    <template #actions>
      <t-tag :theme="statusTheme[content.data.status]" variant="light">{{ statusLabel[content.data.status] ?? content.data.status }}</t-tag>
    </template>
    <t-space direction="vertical" style="width: 100%">
      <div><b>形式：</b>过渡视频 + H5 小游戏</div>
      <div><b>基调：</b>{{ content.data.tone }}</div>
      <div><b>创意构思：</b>{{ content.data.narrative }}</div>
      <div><b>参考分：</b>{{ content.data.planEvaluatorScore }}</div>
      <div v-if="content.data.evaluatorFeedback" style="color: var(--td-text-color-secondary, #666); font-size: 13px">
        {{ content.data.evaluatorFeedback.feedback }}
      </div>
      <t-space>
        <t-button v-if="content.data.status === 'draft'" theme="primary" @click="handleApprove">确认这份方案</t-button>
        <t-button
          :theme="localFeedback === 'like' ? 'success' : 'default'"
          :variant="localFeedback === 'like' ? 'base' : 'outline'"
          size="small"
          @click="handleFeedback('like')"
        >
          喜欢
        </t-button>
        <t-button
          :theme="localFeedback === 'dislike' ? 'danger' : 'default'"
          :variant="localFeedback === 'dislike' ? 'base' : 'outline'"
          size="small"
          @click="handleFeedback('dislike')"
        >
          不喜欢
        </t-button>
      </t-space>
    </t-space>
  </t-card>
</template>
