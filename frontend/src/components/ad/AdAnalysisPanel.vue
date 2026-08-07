<script setup lang="ts">
// 营销素材分析结果的结构化展示——从 AdDetailView.vue 抽出来，"匹配创作会话"详情页也要展示同一份内容，
// 两处复用同一个组件，不用把 13 个字段的展示逻辑抄两遍。schema 字段以后会变，这里对每个字段做了
// v-if 兜底，老数据/字段缺失只是少展示一块，不会报错。
interface GameInfo {
  name: string;
  genre: string;
  coreMechanic: string;
  visualStyle: string;
  keySellingPoints: string[];
}
interface VisualToneGuide {
  colorTendency: string;
  graphicLanguage: string;
  brandVisualGuidelines: string;
  referenceStyleSamples: string[];
  materials: string;
  colorCodes: string[];
  fontStyle: string;
  manual: string;
}
interface EmotionalTone {
  coreEmotion: string;
  narrativeTendency: string;
  brandTemperatureRange: string;
}
interface AudiovisualStyle {
  artStyle: string;
  artForm: string;
  artElements: string[];
  visualTexture: string;
  voiceover: string;
  musicStyle: string;
  soundEffectSystem: string;
}
interface MaterialPlanning {
  materialTypes: string[];
  channelSpecs: { channel: string; format: string }[];
  schedule: string;
}
interface MaterialObjectives {
  subGoals: { goal: string; category: "test" | "commercial" }[];
  videoDataKPIs: string[];
}
interface DerivativeFission {
  supportsSecondaryEditing: boolean;
  derivativeIdeas: string[];
}
interface RegionalFissionEntry {
  region: string;
  culturalSymbols: string;
  aesthetics: string;
  copywritingTone: string;
  taboos: string;
  complianceNotes: string;
}
interface UserResearchDimensions {
  feedbackChannels: string[];
  attentionFactors: { dimension: string; rationale: string }[];
}
interface ReviewDataDimensions {
  abTestMetrics: string[];
  qualityCriteria: string[];
}
export interface AdAnalysisResult {
  tone?: string;
  game?: GameInfo;
  // 老数据（这个 schema 锁定成"游戏广告必须有 game 字段"之前跑的分析）可能是别的形状，比如 product
  product?: { name: string; category: string; keySellingPoints: string[] };
  brandSafety?: { isSafe: boolean; concerns: string[] };
  summary?: string;
  visualToneGuide?: VisualToneGuide;
  emotionalTone?: EmotionalTone;
  audiovisualStyle?: AudiovisualStyle;
  materialPlanning?: MaterialPlanning;
  materialObjectives?: MaterialObjectives;
  derivativeFission?: DerivativeFission;
  regionalFission?: RegionalFissionEntry[];
  userResearchDimensions?: UserResearchDimensions;
  reviewDataDimensions?: ReviewDataDimensions;
}

defineProps<{ analysis: AdAnalysisResult }>();

const categoryLabel: Record<string, string> = { test: "测试目标", commercial: "商业转化目标" };
</script>

<template>
  <t-space direction="vertical" style="width: 100%" :size="20">
    <!-- 基础分析 -->
    <t-card title="基础分析" v-if="analysis.tone || analysis.game || analysis.product || analysis.summary">
      <t-space direction="vertical" style="width: 100%">
        <div v-if="analysis.tone"><b>调性：</b>{{ analysis.tone }}</div>
        <template v-if="analysis.game">
          <div><b>游戏：</b>{{ analysis.game.name }}（{{ analysis.game.genre }}）</div>
          <div><b>核心玩法：</b>{{ analysis.game.coreMechanic }}</div>
          <div><b>视觉风格：</b>{{ analysis.game.visualStyle }}</div>
          <div>
            <b>核心卖点：</b>
            <t-tag v-for="p in analysis.game.keySellingPoints" :key="p" variant="light" style="margin: 2px 4px 2px 0">{{ p }}</t-tag>
          </div>
        </template>
        <!-- 老数据兼容：schema 锁定成"必须是游戏"之前的分析结果，可能是 product 而不是 game -->
        <template v-else-if="analysis.product">
          <div><b>产品：</b>{{ analysis.product.name }}（{{ analysis.product.category }}）</div>
          <div>
            <b>核心卖点：</b>
            <t-tag v-for="p in analysis.product.keySellingPoints" :key="p" variant="light" style="margin: 2px 4px 2px 0">{{ p }}</t-tag>
          </div>
        </template>
        <div v-if="analysis.brandSafety">
          <b>品牌安全：</b>
          <t-tag :theme="analysis.brandSafety.isSafe ? 'success' : 'danger'" variant="light">{{ analysis.brandSafety.isSafe ? "通过" : "有风险" }}</t-tag>
          <span v-if="analysis.brandSafety.concerns?.length" style="margin-left: 8px; color: var(--td-error-color, #d54941)">
            {{ analysis.brandSafety.concerns.join("；") }}
          </span>
        </div>
        <div v-if="analysis.summary"><b>摘要：</b>{{ analysis.summary }}</div>
      </t-space>
    </t-card>

    <!-- 视觉定调 -->
    <t-card title="视觉定调" v-if="analysis.visualToneGuide">
      <t-space direction="vertical" style="width: 100%">
        <div><b>色彩倾向：</b>{{ analysis.visualToneGuide.colorTendency }}</div>
        <div v-if="analysis.visualToneGuide.colorCodes?.length">
          <b>色号：</b>
          <span
            v-for="c in analysis.visualToneGuide.colorCodes"
            :key="c"
            style="display: inline-flex; align-items: center; gap: 4px; margin: 2px 10px 2px 0"
          >
            <span :style="{ display: 'inline-block', width: '14px', height: '14px', borderRadius: '3px', background: c, border: '1px solid rgba(0,0,0,0.15)' }"></span>
            <span style="font-family: monospace; font-size: 12px">{{ c }}</span>
          </span>
        </div>
        <div><b>图形语言：</b>{{ analysis.visualToneGuide.graphicLanguage }}</div>
        <div><b>品牌视觉规范：</b>{{ analysis.visualToneGuide.brandVisualGuidelines }}</div>
        <div><b>材质：</b>{{ analysis.visualToneGuide.materials }}</div>
        <div><b>字体风格：</b>{{ analysis.visualToneGuide.fontStyle }}</div>
        <div v-if="analysis.visualToneGuide.referenceStyleSamples?.length">
          <b>参考风格样本：</b>
          <ul style="margin: 4px 0 0; padding-left: 20px">
            <li v-for="s in analysis.visualToneGuide.referenceStyleSamples" :key="s">{{ s }}</li>
          </ul>
        </div>
        <div>
          <b>定调手册：</b>
          <p style="margin: 6px 0 0; padding: 10px 12px; background: var(--td-bg-color-component, #f3f3f3); border-radius: 6px; line-height: 1.6">
            {{ analysis.visualToneGuide.manual }}
          </p>
        </div>
      </t-space>
    </t-card>

    <!-- 情绪基调 -->
    <t-card title="情绪基调" v-if="analysis.emotionalTone">
      <t-space direction="vertical" style="width: 100%">
        <div><b>核心情绪感受：</b>{{ analysis.emotionalTone.coreEmotion }}</div>
        <div><b>叙事倾向：</b>{{ analysis.emotionalTone.narrativeTendency }}</div>
        <div><b>品牌温度区间：</b>{{ analysis.emotionalTone.brandTemperatureRange }}</div>
      </t-space>
    </t-card>

    <!-- 视听风格 -->
    <t-card title="视听风格" v-if="analysis.audiovisualStyle">
      <t-space direction="vertical" style="width: 100%">
        <div><b>美术风格：</b>{{ analysis.audiovisualStyle.artStyle }}</div>
        <div><b>艺术形式：</b>{{ analysis.audiovisualStyle.artForm }}</div>
        <div v-if="analysis.audiovisualStyle.artElements?.length">
          <b>艺术元素：</b>
          <t-tag v-for="e in analysis.audiovisualStyle.artElements" :key="e" variant="light" style="margin: 2px 4px 2px 0">{{ e }}</t-tag>
        </div>
        <div><b>画面质感：</b>{{ analysis.audiovisualStyle.visualTexture }}</div>
        <div><b>配音：</b>{{ analysis.audiovisualStyle.voiceover }}</div>
        <div><b>配乐曲风：</b>{{ analysis.audiovisualStyle.musicStyle }}</div>
        <div><b>音效体系：</b>{{ analysis.audiovisualStyle.soundEffectSystem }}</div>
      </t-space>
    </t-card>

    <!-- 物料规划 -->
    <t-card title="物料规划" v-if="analysis.materialPlanning">
      <t-space direction="vertical" style="width: 100%">
        <div v-if="analysis.materialPlanning.materialTypes?.length">
          <b>物料类型：</b>
          <t-tag v-for="t in analysis.materialPlanning.materialTypes" :key="t" variant="light" style="margin: 2px 4px 2px 0">{{ t }}</t-tag>
        </div>
        <div v-if="analysis.materialPlanning.channelSpecs?.length">
          <b>渠道画幅规格：</b>
          <t-table
            size="small"
            row-key="channel"
            :data="analysis.materialPlanning.channelSpecs"
            :columns="[{ colKey: 'channel', title: '渠道' }, { colKey: 'format', title: '画幅规格' }]"
            style="margin-top: 6px"
          />
        </div>
        <div><b>上线排期：</b>{{ analysis.materialPlanning.schedule }}</div>
      </t-space>
    </t-card>

    <!-- 物料目标 -->
    <t-card title="物料目标" v-if="analysis.materialObjectives">
      <t-space direction="vertical" style="width: 100%">
        <div v-if="analysis.materialObjectives.subGoals?.length">
          <b>细分目标：</b>
          <div v-for="(g, i) in analysis.materialObjectives.subGoals" :key="i" style="margin-top: 4px">
            <t-tag size="small" :theme="g.category === 'commercial' ? 'primary' : 'default'" variant="light" style="margin-right: 6px">
              {{ categoryLabel[g.category] ?? g.category }}
            </t-tag>
            {{ g.goal }}
          </div>
        </div>
        <div v-if="analysis.materialObjectives.videoDataKPIs?.length">
          <b>建议关注的视频数据 KPI：</b>
          <t-tag v-for="k in analysis.materialObjectives.videoDataKPIs" :key="k" variant="light" style="margin: 2px 4px 2px 0">{{ k }}</t-tag>
        </div>
      </t-space>
    </t-card>

    <!-- 衍生裂变 -->
    <t-card title="衍生裂变" v-if="analysis.derivativeFission">
      <t-space direction="vertical" style="width: 100%">
        <div>
          <b>是否支持二次剪辑/衍生：</b>
          <t-tag :theme="analysis.derivativeFission.supportsSecondaryEditing ? 'success' : 'default'" variant="light">
            {{ analysis.derivativeFission.supportsSecondaryEditing ? "支持" : "不支持" }}
          </t-tag>
        </div>
        <div v-if="analysis.derivativeFission.derivativeIdeas?.length">
          <b>衍生方向：</b>
          <ul style="margin: 4px 0 0; padding-left: 20px">
            <li v-for="idea in analysis.derivativeFission.derivativeIdeas" :key="idea">{{ idea }}</li>
          </ul>
        </div>
      </t-space>
    </t-card>

    <!-- 区域裂化 -->
    <t-card title="区域裂化" v-if="analysis.regionalFission?.length">
      <t-space direction="vertical" style="width: 100%" :size="16">
        <div v-for="r in analysis.regionalFission" :key="r.region" style="border-bottom: 1px solid var(--td-border-level-1-color, #f0f0f0); padding-bottom: 12px">
          <div style="font-weight: 600; margin-bottom: 4px">{{ r.region }}</div>
          <div style="font-size: 13px; color: var(--td-text-color-secondary, #666)">
            <div><b>文化符号：</b>{{ r.culturalSymbols }}</div>
            <div><b>审美：</b>{{ r.aesthetics }}</div>
            <div><b>话术：</b>{{ r.copywritingTone }}</div>
            <div><b>禁忌：</b>{{ r.taboos }}</div>
            <div><b>合规差异：</b>{{ r.complianceNotes }}</div>
          </div>
        </div>
      </t-space>
    </t-card>

    <!-- 用户调研维度 -->
    <t-card title="用户调研维度" v-if="analysis.userResearchDimensions">
      <t-space direction="vertical" style="width: 100%">
        <div v-if="analysis.userResearchDimensions.feedbackChannels?.length">
          <b>反馈渠道：</b>
          <t-tag v-for="c in analysis.userResearchDimensions.feedbackChannels" :key="c" variant="light" style="margin: 2px 4px 2px 0">{{ c }}</t-tag>
        </div>
        <div v-if="analysis.userResearchDimensions.attentionFactors?.length">
          <b>吸引力维度排序：</b>
          <div v-for="(f, i) in analysis.userResearchDimensions.attentionFactors" :key="i" style="margin-top: 4px">
            <b>{{ i + 1 }}. {{ f.dimension }}</b>
            <span style="color: var(--td-text-color-secondary, #666)"> — {{ f.rationale }}</span>
          </div>
        </div>
      </t-space>
    </t-card>

    <!-- 复盘数据维度 -->
    <t-card title="复盘数据维度" v-if="analysis.reviewDataDimensions">
      <t-space direction="vertical" style="width: 100%">
        <div v-if="analysis.reviewDataDimensions.abTestMetrics?.length">
          <b>A/B 测试观测指标：</b>
          <t-tag v-for="m in analysis.reviewDataDimensions.abTestMetrics" :key="m" variant="light" style="margin: 2px 4px 2px 0">{{ m }}</t-tag>
        </div>
        <div v-if="analysis.reviewDataDimensions.qualityCriteria?.length">
          <b>创意好坏判断标准：</b>
          <ul style="margin: 4px 0 0; padding-left: 20px">
            <li v-for="c in analysis.reviewDataDimensions.qualityCriteria" :key="c">{{ c }}</li>
          </ul>
        </div>
      </t-space>
    </t-card>
  </t-space>
</template>
