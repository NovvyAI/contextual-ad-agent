import type { ModelMessage } from "ai";
import type { EpisodeAnalysis } from "@/agents/storyboardAgent/schema";
import type { AdEntry } from "@/agents/adLibraryAgent/schema";
import type { StageADraft } from "./schema";

// 参考 Toonflow-app 的景别/运镜标签映射（data/modelPrompt/video/universalMulti-parameterMode.md），
// 附在中文描述后面给图片/视频生成模型一个标准化的英文镜头术语锚点，不是整段翻译成英文
// （这个项目已有的 Chinese prompt 在 gpt-image-1/Seedance 上跑得通，没必要改成全英文）。
const SHOT_SIZE_EN: Record<string, string> = {
  远景: "extreme wide shot",
  全景: "wide establishing shot",
  中景: "medium shot",
  近景: "close-up",
  特写: "close-up",
  大特写: "extreme close-up",
};
const CAMERA_MOVEMENT_EN: Record<string, string> = {
  静止: "static camera",
  推进: "dolly in / push in",
  拉远: "dolly out / pull back",
  跟踪: "tracking shot",
  摇镜: "pan left/right",
  甩镜: "whip pan",
  升降: "crane up/down",
  环绕: "surround shooting",
};

function formatContext(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, narrative: string, tone: string): string {
  return [
    `## 已批准的创意方向\n构思：${narrative}\n基调：${tone}`,
    `## Episode 结尾状态\n摘要：${episodeAnalysis.endingState.summary}\n最后画面：${episodeAnalysis.endingState.lastVisualDescription}\n建议承接基调：${episodeAnalysis.endingState.suggestedTone}`,
    `## 广告信息\n游戏：${ad.game.name}（${ad.game.genre}）\n核心卖点：${ad.game.keySellingPoints.join("、")}\n调性：${ad.tone}`,
  ].join("\n\n");
}

export function buildStageADraftMessages(episodeAnalysis: EpisodeAnalysis, ad: AdEntry, narrative: string, tone: string): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad, narrative, tone)}\n\n请构思承接结尾画面过渡到游戏开场的分镜设计，应该呼应上面"已批准的创意方向"。` +
    `景别、运镜请从给定选项里选择，不要用自由文本描述镜头语言；其余字段严格基于上面给出的信息作答，不编造未提及的情节、角色或游戏玩法细节。`;
  return [{ role: "user", content: text }];
}

function formatDraftSummary(draft: StageADraft): string {
  return [
    `景别：${draft.shotSize}`,
    `运镜：${draft.cameraMovement}`,
    `主体动作/过渡呈现：${draft.subjectAction}`,
    `光影氛围：${draft.lightingMood}`,
    `情绪基调：${draft.emotionalTone}`,
    `构图说明：${draft.framingNotes}`,
  ].join("\n");
}

export function buildReviseMessages(
  episodeAnalysis: EpisodeAnalysis,
  ad: AdEntry,
  narrative: string,
  tone: string,
  existing: StageADraft,
  feedback: string,
): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad, narrative, tone)}\n\n## 当前分镜草案\n${formatDraftSummary(existing)}\n\n` +
    `## 用户反馈\n${feedback}\n\n请根据反馈修改这份分镜设计。`;
  return [{ role: "user", content: text }];
}

/**
 * 只针对成片的运镜/节奏问题——草案图已确认，不重新生成，所以只允许模型重新考虑
 * cameraMovement/emotionalTone 这两个不影响画面构图的字段，其余字段照抄，避免 prompt 描述的内容和
 * 已经生成好的静态图对不上。
 */
export function buildMotionReviseMessages(
  episodeAnalysis: EpisodeAnalysis,
  ad: AdEntry,
  narrative: string,
  tone: string,
  existing: StageADraft,
  feedback: string,
): ModelMessage[] {
  const text =
    `${formatContext(episodeAnalysis, ad, narrative, tone)}\n\n## 当前分镜草案（画面已确认，草案图不会重新生成）\n${formatDraftSummary(existing)}\n\n` +
    `## 用户对成片的反馈\n${feedback}\n\n` +
    `这条反馈只针对成片的运镜/节奏，不涉及画面内容本身。请只重新给出 cameraMovement 和 emotionalTone 这两个字段的新值，` +
    `其余字段（shotSize、subjectAction、lightingMood、framingNotes）原样返回当前草案的值，不要修改。`;
  return [{ role: "user", content: text }];
}

/**
 * Stage A（gpt-image-1 草案图）：最多两张参考图需要消歧——Episode 结尾画面 + 广告参考图，
 * 参考 Toonflow-app universalMulti-parameterMode.md 的 @图N 编号引用法，按传入顺序编号，
 * 让模型明确知道每张参考图在画面里分别扮演什么角色，不再靠一句笼统描述让模型自己猜。
 */
export function assembleStageAPrompt(draft: StageADraft, hasEpisodeFrame: boolean, hasAdFrame: boolean, hasGameAssetFrame: boolean = false): string {
  const refLines: string[] = [];
  let n = 1;
  let episodeTag: string | null = null;
  let adTag: string | null = null;
  let gameAssetTag: string | null = null;
  if (hasEpisodeFrame) {
    episodeTag = `@图${n}`;
    refLines.push(`${episodeTag}：Episode 结尾最后一帧画面`);
    n++;
  }
  if (hasAdFrame) {
    adTag = `@图${n}`;
    refLines.push(`${adTag}：广告素材参考图`);
    n++;
  }
  if (hasGameAssetFrame) {
    gameAssetTag = `@图${n}`;
    refLines.push(`${gameAssetTag}：已组装完成的小游戏真实素材参考图`);
    n++;
  }

  const transitionParts: string[] = [];
  if (episodeTag) transitionParts.push(`承接 ${episodeTag} 的画面`);
  if (adTag) transitionParts.push(`过渡到 ${adTag} 所代表的游戏视觉`);
  if (gameAssetTag) transitionParts.push(`结尾可以呼应 ${gameAssetTag} 这份已经生成好的真实游戏素材`);
  transitionParts.push(draft.subjectAction);

  const sections = [
    refLines.length > 0 ? `[参考图]\n${refLines.join("\n")}` : null,
    `[分镜设计]\n${transitionParts.join("，")}。\n` +
      `景别：${draft.shotSize}（${SHOT_SIZE_EN[draft.shotSize] ?? draft.shotSize}）；运镜：${draft.cameraMovement}（${CAMERA_MOVEMENT_EN[draft.cameraMovement] ?? draft.cameraMovement}）。\n` +
      `光影氛围：${draft.lightingMood}。\n情绪基调：${draft.emotionalTone}。`,
  ].filter((s): s is string => s != null);

  return sections.join("\n\n");
}

/**
 * Stage B（Seedance singleImage 模式）：只有一张参考图（已确认的草案图本身），不存在多图消歧，
 * 不需要 @图N 编号——更接近 Toonflow-app wan2.6Single-imageFirstFrameMode.md 的单段式散文表达。
 */
export function assembleStageBPrompt(draft: StageADraft): string {
  const shotSizeEn = SHOT_SIZE_EN[draft.shotSize] ?? draft.shotSize;
  const cameraEn = CAMERA_MOVEMENT_EN[draft.cameraMovement] ?? draft.cameraMovement;
  return (
    `${draft.emotionalTone}的氛围下，${draft.subjectAction}，${draft.lightingMood}。` +
    `镜头以${draft.shotSize}（${shotSizeEn}）呈现，${draft.cameraMovement}（${cameraEn}）。`
  );
}
