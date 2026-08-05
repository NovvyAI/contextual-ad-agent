// taskClass -> 8 步固定阶段 label 的映射（和 sessionProgress.ts 的 STAGE_DEFS 用同一套中文名）。
// 独立成纯函数、零依赖：taskRecord.ts 是被到处调用的底层工具，不能反向依赖 sessionProgress.ts
// ——那边 import 了 "@/utils" 聚合对象，而 "@/utils" 里又挂着 taskRecord，会形成循环 import。
export function stageLabelForTaskClass(taskClass: string): string {
  if (taskClass === "storyboard-analysis") return "Episode 分析";
  if (taskClass.startsWith("director-")) return "创意方案生成";
  if (taskClass.startsWith("videoGen-stageA")) return "分镜草案生成";
  if (taskClass.startsWith("videoGen-stageB")) return "成片渲染";
  if (taskClass.startsWith("playable-")) return "游戏组装";
  if (taskClass === "supervision") return "落地终审";
  if (taskClass === "ad-analysis") return "广告素材分析";
  return taskClass;
}
