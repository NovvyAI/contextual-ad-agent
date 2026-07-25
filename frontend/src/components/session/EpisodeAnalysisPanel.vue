<script setup lang="ts">
import { ref } from "vue";
import type { EpisodeAnalysis } from "@/stores/sessionAgent";

defineProps<{ analysis: EpisodeAnalysis }>();

const collapsed = ref(true);

const roleLabel: Record<string, string> = { protagonist: "主角", antagonist: "反派", supporting: "配角" };
const roleTheme: Record<string, "primary" | "danger" | "default"> = { protagonist: "primary", antagonist: "danger", supporting: "default" };
</script>

<template>
  <div style="border-bottom: 1px solid var(--td-border-level-2-color, #e7e7e7); padding: 8px 16px">
    <div style="cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--td-text-color-secondary, #666)" @click="collapsed = !collapsed">
      <b style="color: var(--td-text-color-primary, #000)">剧情分析</b>
      <t-tag v-if="analysis.endingState.cliffhanger" theme="warning" variant="light" size="small">悬念结尾</t-tag>
      <span style="font-size: 13px">{{ collapsed ? "展开" : "收起" }}</span>
    </div>

    <t-space v-if="!collapsed" direction="vertical" style="width: 100%; margin-top: 12px">
      <div><b>剧情梗概：</b>{{ analysis.plot }}</div>

      <div>
        <b>人物：</b>
        <t-space direction="vertical" style="width: 100%; margin-top: 4px">
          <div v-for="c in analysis.characters" :key="c.name">
            <t-tag :theme="roleTheme[c.role] ?? 'default'" variant="light" size="small">{{ roleLabel[c.role] ?? c.role }}</t-tag>
            <b style="margin-left: 4px">{{ c.name }}</b>
            <span style="color: var(--td-text-color-secondary, #666)">：{{ c.description }}</span>
          </div>
        </t-space>
      </div>

      <div>
        <b>情绪曲线：</b>
        <t-space direction="vertical" style="width: 100%; margin-top: 4px">
          <div v-for="(e, i) in analysis.emotionArc" :key="i">
            <span style="color: var(--td-text-color-placeholder, #999)">{{ e.timestampS }}s</span>
            <b style="margin-left: 4px">{{ e.emotion }}</b>
            <span v-if="e.description" style="color: var(--td-text-color-secondary, #666)">：{{ e.description }}</span>
          </div>
        </t-space>
      </div>

      <div>
        <b>结尾状态：</b>{{ analysis.endingState.summary }}
        <div style="color: var(--td-text-color-secondary, #666); font-size: 13px; margin-top: 2px">
          最后画面：{{ analysis.endingState.lastVisualDescription }}
        </div>
        <div style="color: var(--td-text-color-secondary, #666); font-size: 13px">建议桥接基调：{{ analysis.endingState.suggestedTone }}</div>
      </div>
    </t-space>
  </div>
</template>
