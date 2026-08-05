import u from "@/utils";

export type StageStatus = "pending" | "in_progress" | "done" | "failed";

export interface StageProgress {
  key: string;
  label: string;
  status: StageStatus;
}

export interface SessionProgress {
  episodeId: number;
  stages: StageProgress[];
}

const STAGE_DEFS = [
  { key: "episodeAnalysis", label: "Episode 分析" },
  { key: "planGeneration", label: "创意方案生成" },
  { key: "draftGeneration", label: "分镜草案生成" },
  { key: "draftConfirm", label: "确认全部分镜草案" },
  { key: "stageBRender", label: "成片渲染" },
  { key: "gameAssembly", label: "游戏组装" },
  { key: "supervision", label: "落地终审" },
  { key: "finalAssembly", label: "最终交付物组装" },
] as const;

function emptyStages(): StageProgress[] {
  return STAGE_DEFS.map((d) => ({ key: d.key, label: d.label, status: "pending" as StageStatus }));
}

/**
 * 综合 ab_episode/ab_creativePlan/ab_bridgeCut/ab_manifest 的状态字段 + o_tasks 最近记录，
 * 算出这个 episode 会话现在处于 8 个固定阶段里的哪一步。这是"尽力推断"，不是一个我们自己拥有的
 * 严格状态机——落地终审（supervision）没有独立的状态列，只能从 o_tasks 里最近一条
 * taskClass=supervision 的记录反推；广告素材分析不算在这 8 步里（不挂在具体某个 episode 下，
 * 见 adLibraryAgent/index.ts 里 projectId 用 0 当哨兵值的注释）。
 *
 * 一个 episode 下可能有多份 creativePlan（用户可能生成过多个候选方案），只看"当前生效"的那一份：
 * 优先取已批准（status=approved）里 id 最大的一条；还没有任何方案被批准，就取 id 最大的那条
 * （不管什么状态），用来展示"方案还在生成/评估中"。
 */
export async function computeSessionProgress(episodeId: number): Promise<SessionProgress> {
  const stages = emptyStages();
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s])) as Record<(typeof STAGE_DEFS)[number]["key"], StageProgress>;

  const episode = await u.db("ab_episode").where("id", episodeId).first();
  if (!episode) return { episodeId, stages };

  // 1. Episode 分析
  if (episode.status === "analyzed") byKey.episodeAnalysis.status = "done";
  else if (episode.status === "analyzing") byKey.episodeAnalysis.status = "in_progress";
  else if (episode.status === "failed") byKey.episodeAnalysis.status = "failed";
  if (byKey.episodeAnalysis.status !== "done") return { episodeId, stages };

  // 2. 创意方案生成——优先用已批准的那份，没有就用最新的一份（不管什么状态）
  const approvedPlan = await u.db("ab_creativePlan").where("episodeId", episodeId).where("status", "approved").orderBy("id", "desc").first();
  const latestPlan = approvedPlan ?? (await u.db("ab_creativePlan").where("episodeId", episodeId).orderBy("id", "desc").first());
  if (!latestPlan) return { episodeId, stages };
  byKey.planGeneration.status = approvedPlan ? "done" : latestPlan.status === "rejected" ? "failed" : "in_progress";
  if (!approvedPlan) return { episodeId, stages };

  const cuts = await u.db("ab_bridgeCut").where("creativePlanId", approvedPlan.id);
  const videoCut = cuts.find((c: any) => c.type === "video");
  const gameCut = cuts.find((c: any) => c.type === "playableGame");

  // 3. 分镜草案生成（Stage A）
  if (!videoCut) return { episodeId, stages };
  byKey.draftGeneration.status = videoCut.status === "failed" && !videoCut.scriptText ? "failed" : videoCut.scriptText ? "done" : "in_progress";
  if (byKey.draftGeneration.status !== "done") return { episodeId, stages };

  // 4. 确认全部分镜草案（纯代码闸门，没有独立 LLM 调用）
  const draftConfirmed = videoCut.status !== "draft";
  byKey.draftConfirm.status = draftConfirmed ? "done" : "in_progress";
  if (!draftConfirmed) return { episodeId, stages };

  // 5. 成片渲染（Stage B）
  if (videoCut.status === "done") byKey.stageBRender.status = "done";
  else if (videoCut.status === "rendering") byKey.stageBRender.status = "in_progress";
  else if (videoCut.status === "failed") byKey.stageBRender.status = "failed";
  if (byKey.stageBRender.status !== "done") return { episodeId, stages };

  // 6. 游戏组装（翻牌配对默认路径 或 自定义玩法，两条路径共用同一个 cut.status 字段）
  if (!gameCut) return { episodeId, stages };
  if (gameCut.status === "done") byKey.gameAssembly.status = "done";
  else if (gameCut.status === "generating") byKey.gameAssembly.status = "in_progress";
  else if (gameCut.status === "failed") byKey.gameAssembly.status = "failed";
  if (byKey.gameAssembly.status !== "done") return { episodeId, stages };

  // 7. 落地终审——没有独立状态列，反推最近一条 o_tasks 里 taskClass=supervision 的记录
  const supervisionTask = await u.db("o_tasks").where("projectId", episodeId).where("taskClass", "supervision").orderBy("id", "desc").first();
  if (supervisionTask) {
    if (supervisionTask.state === "已完成") byKey.supervision.status = "done";
    else if (supervisionTask.state === "生成失败") byKey.supervision.status = "failed";
    else byKey.supervision.status = "in_progress";
  }
  if (byKey.supervision.status !== "done") return { episodeId, stages };

  // 8. 最终交付物组装
  const manifest = await u.db("ab_manifest").where("creativePlanId", approvedPlan.id).orderBy("id", "desc").first();
  if (manifest?.status === "done") byKey.finalAssembly.status = "done";

  return { episodeId, stages };
}
