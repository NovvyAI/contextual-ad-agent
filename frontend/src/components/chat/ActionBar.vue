<script setup lang="ts">
import { computed, ref } from "vue";
import type { SessionState } from "@/stores/sessionAgent";

const props = defineProps<{
  sessionState: SessionState;
  ads: { id: number; name: string; summary: string }[];
  busy: boolean;
  onGeneratePlan: (adIds: number[]) => void;
  onGenerateContent: (creativePlanId: number, imageModelKey: string, videoModelKey: string, videoResolution: string) => void;
  onConfirmBridgeCuts: (creativePlanId: number) => void;
  onAssemblePlayable: (creativePlanId: number, selectedCandidateFrames: string[]) => void;
  onGenerateCustomGame: (bridgeCutId: number, description: string, selectedCandidateFrames: string[]) => void;
  onConfirmContent: (creativePlanId: number) => void;
  onRetryBridgeCut: (bridgeCutId: number) => void;
}>();

const selectedAdIds = ref<number[]>([]);
// 和后端 src/agents/shared/imageModel.ts 里的 IMAGE_MODEL_OPTIONS 保持一致——
// 选定之后这份方案下所有分镜草案/游戏素材生成（包括 revise）都用这个模型，不用每次调用各自决定
const imageModelOptions = [
  { key: "openai:gpt-image-2", label: "GPT Image 2" },
  { key: "google:gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image（官方直连）" },
];
const selectedImageModelKey = ref(imageModelOptions[0].key);
// 和后端 src/agents/shared/videoModel.ts 里的 VIDEO_MODEL_OPTIONS 保持一致
const videoModelOptions = [
  { key: "imarouter:seedance-2.0", label: "Seedance 2.0" },
  { key: "google:veo-3.1-generate-preview", label: "Veo 3.1（官方直连，固定8秒）" },
  { key: "imarouter:kling-v3-omni-video", label: "Kling v3 Omni（ImaRouter 中转，固定 720p）" },
  { key: "imarouter:MiniMax-Hailuo-2.3", label: "MiniMax Hailuo 2.3（ImaRouter 中转，时长限 6/10 秒）" },
  { key: "imarouter:viduq3-turbo", label: "Vidu Q3 Turbo（ImaRouter 中转）" },
];
const selectedVideoModelKey = ref(videoModelOptions[0].key);
// 和后端 src/agents/shared/videoResolution.ts 里的 VIDEO_RESOLUTION_OPTIONS 保持一致——只给两个
// 视频供应商都支持的档位（720p/1080p），不做成跟着视频模型联动变化的下拉框，简单直接
const videoResolutionOptions = [
  { key: "1080p", label: "1080p" },
  { key: "720p", label: "720p" },
];
const selectedVideoResolution = ref("720p");
const customGameDialogVisible = ref(false);
const customGameDescription = ref("");
const customGameSelectedFrames = ref<string[]>([]);
const assembleDialogVisible = ref(false);
const assembleSelectedFrames = ref<string[]>([]);

const tileCandidateImages = computed(() => props.sessionState.episode.episodeAnalysis?.tileCandidateImages ?? []);
// 和后端 playableAgent/index.ts 里的 VIDEO_DRAFT_CANDIDATE_KEY 保持一致——这个 key 不是 Episode 帧文件名，
// 选中它时后端会去当前方案的 video cut 自己的产物里找草案图，不是查 episode 帧目录
const VIDEO_DRAFT_CANDIDATE_KEY = "__video_draft__";
const videoDraftCandidate = computed(() => {
  const url = videoCuts.value[0]?.latestDraft?.imageUrl;
  return url ? [{ filename: VIDEO_DRAFT_CANDIDATE_KEY, url }] : [];
});
// 候选素材统一成一个列表给两个弹窗共用——视频分镜草案图排在最前面，其余是 Episode 候选帧
const allCandidateImages = computed(() => [...videoDraftCandidate.value, ...tileCandidateImages.value]);

function submitCustomGame() {
  if (!gameCut.value?.id || !customGameDescription.value.trim()) return;
  props.onGenerateCustomGame(gameCut.value.id, customGameDescription.value.trim(), customGameSelectedFrames.value);
  customGameDialogVisible.value = false;
  customGameDescription.value = "";
  customGameSelectedFrames.value = [];
}

function openAssembleDialog() {
  assembleSelectedFrames.value = [];
  assembleDialogVisible.value = true;
}

function submitAssemblePlayable() {
  if (!approvedPlan.value?.id) return;
  props.onAssemblePlayable(approvedPlan.value.id, assembleSelectedFrames.value);
  assembleDialogVisible.value = false;
}

// "重新生成方案"复用上一批用过的广告 id，不用再让用户重新选一遍——sessionState.creativePlans
// 是这个 episode 下全部方案（不分状态），去重后就是上一次调用 generatePlans 实际传入的 adIds
const lastPlanAdIds = computed(() => [...new Set(props.sessionState.creativePlans.map((p) => p.adId))]);

const approvedPlan = computed(() => props.sessionState.creativePlans.find((p) => p.status === "approved"));
// 一个 episode 理论上不该同时有多份 approved 方案，但实际数据里出现过（历史遗留/反复测试导致）——
// 这里按当前这份 approved 方案过滤 cut，不然混进另一份方案已经 done 的 cut，会把这些按钮状态判断全部打乱
const currentPlanCuts = computed(() => props.sessionState.bridgeCuts.filter((c) => c.creativePlanId === approvedPlan.value?.id));
const videoCuts = computed(() => currentPlanCuts.value.filter((c) => c.type === "video"));
const hasCuts = computed(() => currentPlanCuts.value.length > 0);
const videoDraftsReadyToConfirm = computed(() => videoCuts.value.length > 0 && videoCuts.value.every((c) => c.status === "draft"));
const gameCut = computed(() => currentPlanCuts.value.find((c) => c.type === "playableGame"));
// M7 新增的手动确认点：video 段渲染完成、小游戏段还没组装过时，才显示「确认组装小游戏」按钮，不自动直通
const readyToAssemblePlayable = computed(() => videoCuts.value.length > 0 && videoCuts.value.every((c) => c.status === "done") && gameCut.value?.status === "pending");
const allCutsDone = computed(() => hasCuts.value && currentPlanCuts.value.every((c) => c.status === "done"));
const failedCuts = computed(() => currentPlanCuts.value.filter((c) => c.status === "failed"));
</script>

<template>
  <div style="padding: 12px 16px; border-top: 1px solid var(--td-border-level-2-color, #e7e7e7); display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
    <template v-if="sessionState.episode.workflowStage === 'uploaded'">
      <t-select v-model="selectedAdIds" multiple placeholder="选择要参与创意方案的创意素材" style="min-width: 260px">
        <t-option v-for="ad in ads" :key="ad.id" :value="ad.id" :label="ad.name" :title="ad.summary" />
      </t-select>
      <t-button theme="primary" :disabled="!selectedAdIds.length || busy" @click="onGeneratePlan(selectedAdIds)">生成创意方案</t-button>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'plan_review'">
      <span style="color: var(--td-text-color-secondary, #666)">请在上面的方案卡片里选择并确认一份方案</span>
      <t-button variant="outline" :disabled="busy" @click="onGeneratePlan(lastPlanAdIds)">重新生成方案</t-button>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'content_review'">
      <template v-if="approvedPlan && !hasCuts">
        <t-select v-model="selectedImageModelKey" style="width: 220px" :disabled="busy">
          <t-option v-for="opt in imageModelOptions" :key="opt.key" :value="opt.key" :label="opt.label" />
        </t-select>
        <t-select v-model="selectedVideoModelKey" style="width: 220px" :disabled="busy">
          <t-option v-for="opt in videoModelOptions" :key="opt.key" :value="opt.key" :label="opt.label" />
        </t-select>
        <t-select v-model="selectedVideoResolution" style="width: 120px" :disabled="busy">
          <t-option v-for="opt in videoResolutionOptions" :key="opt.key" :value="opt.key" :label="opt.label" />
        </t-select>
        <t-button
          theme="primary"
          :disabled="busy"
          @click="onGenerateContent(approvedPlan.id, selectedImageModelKey, selectedVideoModelKey, selectedVideoResolution)"
        >
          生成内容
        </t-button>
      </template>
      <template v-else-if="hasCuts && failedCuts.length">
        <span style="color: var(--td-error-color, #d54941)">{{ failedCuts.length }} 个内容生成失败</span>
        <t-button v-for="cut in failedCuts" :key="cut.id" theme="danger" variant="outline" :disabled="busy" @click="onRetryBridgeCut(cut.id)">
          重试 cut {{ cut.id }}（{{ cut.type }}）
        </t-button>
      </template>
      <t-button v-else-if="approvedPlan && videoDraftsReadyToConfirm" theme="primary" :disabled="busy" @click="onConfirmBridgeCuts(approvedPlan.id)">
        确认分镜草案，开始渲染成片
      </t-button>
      <template v-else-if="approvedPlan && readyToAssemblePlayable">
        <t-button theme="primary" :disabled="busy" @click="openAssembleDialog">确认组装小游戏</t-button>
        <t-button theme="default" variant="outline" :disabled="busy" @click="customGameDialogVisible = true">自定义玩法生成</t-button>
      </template>
      <t-button v-else-if="approvedPlan && allCutsDone" theme="primary" :disabled="busy" @click="onConfirmContent(approvedPlan.id)">确认内容，进入终审与落地</t-button>
      <span v-else style="color: var(--td-text-color-secondary, #666)">内容生成中...</span>
    </template>

    <template v-else-if="sessionState.episode.workflowStage === 'assembling'">
      <span style="color: var(--td-success-color, #2ba471)">已完成落地</span>
      <t-link v-if="sessionState.manifest" :href="sessionState.manifest.deliverableUrl" target="_blank">查看最终交付物</t-link>
    </template>

    <t-dialog
      v-model:visible="customGameDialogVisible"
      header="自定义玩法生成"
      width="600px"
      :on-confirm="submitCustomGame"
      :confirm-btn="{ content: '开始生成', disabled: !customGameDescription.trim() }"
    >
      <p style="margin: 0 0 8px; color: var(--td-text-color-secondary, #666); font-size: 13px">
        描述想要的玩法，越详细越好——玩法类型、具体规则、通关条件、难度、想用什么风格的素材图，都可以写清楚，描述越具体，生成出来的游戏越接近预期。系统会据此现场生成一个对应的小游戏；如果生成失败，会自动回退到默认的翻牌配对版本。
      </p>
      <t-textarea v-model="customGameDescription" placeholder="比如：找不同玩法，给两张几乎一样的游戏截图，需要在30秒内点出5处不同，每找对一处有音效反馈，全部找完弹出通关庆祝……" :autosize="{ minRows: 5, maxRows: 14 }" />

      <div v-if="allCandidateImages.length" style="margin-top: 12px">
        <p style="margin: 0 0 6px; color: var(--td-text-color-secondary, #666); font-size: 13px">
          可选：勾选下面这些画面作为素材参考（含视频分镜草案图和这集的候选画面，会作为参考图，不是直接拿来用，风格会重新绘制）
        </p>
        <t-checkbox-group v-model="customGameSelectedFrames" style="display: flex; gap: 8px; flex-wrap: wrap">
          <t-checkbox v-for="img in allCandidateImages" :key="img.filename" :value="img.filename" style="margin: 0">
            <img :src="img.url" style="width: 64px; height: 64px; object-fit: cover; border-radius: 4px; vertical-align: middle" />
          </t-checkbox>
        </t-checkbox-group>
      </div>
    </t-dialog>

    <t-dialog v-model:visible="assembleDialogVisible" header="确认组装小游戏" width="600px" :on-confirm="submitAssemblePlayable" confirm-btn="开始组装">
      <p style="margin: 0 0 8px; color: var(--td-text-color-secondary, #666); font-size: 13px">确认后开始生成默认的翻牌配对小游戏。</p>
      <div v-if="allCandidateImages.length">
        <p style="margin: 0 0 6px; color: var(--td-text-color-secondary, #666); font-size: 13px">
          可选：勾选下面这些画面作为卡面素材参考（含视频分镜草案图和这集的候选画面，不选也可以正常生成）
        </p>
        <t-checkbox-group v-model="assembleSelectedFrames" style="display: flex; gap: 8px; flex-wrap: wrap">
          <t-checkbox v-for="img in allCandidateImages" :key="img.filename" :value="img.filename" style="margin: 0">
            <img :src="img.url" style="width: 64px; height: 64px; object-fit: cover; border-radius: 4px; vertical-align: middle" />
          </t-checkbox>
        </t-checkbox-group>
      </div>
    </t-dialog>
  </div>
</template>
