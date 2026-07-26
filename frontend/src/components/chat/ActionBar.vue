<script setup lang="ts">
import { computed, ref } from "vue";
import type { SessionState } from "@/stores/sessionAgent";

const props = defineProps<{
  sessionState: SessionState;
  ads: { id: number; name: string; summary: string }[];
  busy: boolean;
  onGeneratePlan: (adIds: number[]) => void;
  onGenerateContent: (creativePlanId: number) => void;
  onConfirmBridgeCuts: (creativePlanId: number) => void;
  onAssemblePlayable: (creativePlanId: number) => void;
  onConfirmContent: (creativePlanId: number) => void;
  onRetryBridgeCut: (bridgeCutId: number) => void;
}>();

const selectedAdIds = ref<number[]>([]);

const approvedPlan = computed(() => props.sessionState.creativePlans.find((p) => p.status === "approved"));
const videoCuts = computed(() => props.sessionState.bridgeCuts.filter((c) => c.type === "video"));
const hasCuts = computed(() => props.sessionState.bridgeCuts.length > 0);
const videoDraftsReadyToConfirm = computed(() => videoCuts.value.length > 0 && videoCuts.value.every((c) => c.status === "draft"));
const gameCut = computed(() => props.sessionState.bridgeCuts.find((c) => c.type === "playableGame"));
// M7 新增的手动确认点：video 段渲染完成、小游戏段还没组装过时，才显示「确认组装小游戏」按钮，不自动直通
const readyToAssemblePlayable = computed(() => videoCuts.value.length > 0 && videoCuts.value.every((c) => c.status === "done") && gameCut.value?.status === "pending");
const allCutsDone = computed(() => hasCuts.value && props.sessionState.bridgeCuts.every((c) => c.status === "done"));
const failedCuts = computed(() => props.sessionState.bridgeCuts.filter((c) => c.status === "failed"));
</script>

<template>
  <div style="padding: 12px 16px; border-top: 1px solid var(--td-border-level-2-color, #e7e7e7); display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
    <template v-if="sessionState.episode.workflowStage === 'uploaded'">
      <t-select v-model="selectedAdIds" multiple placeholder="选择要参与创意方案的广告素材" style="min-width: 260px">
        <t-option v-for="ad in ads" :key="ad.id" :value="ad.id" :label="ad.name" :title="ad.summary" />
      </t-select>
      <t-button theme="primary" :disabled="!selectedAdIds.length || busy" @click="onGeneratePlan(selectedAdIds)">生成创意方案</t-button>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'plan_review'">
      <span style="color: var(--td-text-color-secondary, #666)">请在上面的方案卡片里选择并确认一份方案</span>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'content_review'">
      <t-button v-if="approvedPlan && !hasCuts" theme="primary" :disabled="busy" @click="onGenerateContent(approvedPlan.id)">生成内容</t-button>
      <template v-else-if="hasCuts && failedCuts.length">
        <span style="color: var(--td-error-color, #d54941)">{{ failedCuts.length }} 个内容生成失败</span>
        <t-button v-for="cut in failedCuts" :key="cut.id" theme="danger" variant="outline" :disabled="busy" @click="onRetryBridgeCut(cut.id)">
          重试 cut {{ cut.id }}（{{ cut.type }}）
        </t-button>
      </template>
      <t-button v-else-if="approvedPlan && videoDraftsReadyToConfirm" theme="primary" :disabled="busy" @click="onConfirmBridgeCuts(approvedPlan.id)">
        确认分镜草案，开始渲染成片
      </t-button>
      <t-button v-else-if="approvedPlan && readyToAssemblePlayable" theme="primary" :disabled="busy" @click="onAssemblePlayable(approvedPlan.id)">
        确认组装小游戏
      </t-button>
      <t-button v-else-if="approvedPlan && allCutsDone" theme="primary" :disabled="busy" @click="onConfirmContent(approvedPlan.id)">确认内容，进入终审与落地</t-button>
      <span v-else style="color: var(--td-text-color-secondary, #666)">内容生成中...</span>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'assembling'">
      <span style="color: var(--td-success-color, #2ba471)">已完成落地</span>
      <t-link v-if="sessionState.manifest" :href="sessionState.manifest.deliverableUrl" target="_blank">查看最终交付物</t-link>
    </template>
  </div>
</template>
