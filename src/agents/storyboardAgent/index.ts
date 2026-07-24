import path from "path";
import u from "@/utils";
import { sampleFrames, extractTail, hasAudio, extractAudioToWav, probeDuration } from "@/utils/video";
import { transcribeSegments } from "@/utils/asr";
import { episodeAnalysisSchema } from "./schema";
import { buildEpisodeAnalysisMessages, EPISODE_ANALYSIS_SYSTEM_PROMPT } from "./prompt";

const TAIL_SECONDS = 10.0;

export async function analyzeEpisode(episodeId: number): Promise<void> {
  const episode = await u.db("ab_episode").where("id", episodeId).first();
  if (!episode) throw new Error(`Episode ${episodeId} 不存在`);
  if (!episode.sourceFilePath) throw new Error(`Episode ${episodeId} 缺少 sourceFilePath`);

  await u.db("ab_episode").where("id", episodeId).update({ status: "analyzing", errorReason: null });

  try {
    const workDir = u.getPath(["episode", String(episodeId)]);

    const duration = await probeDuration(episode.sourceFilePath);
    await u.db("ab_episode").where("id", episodeId).update({ durationMs: Math.round(duration * 1000) });

    const fullFrames = await sampleFrames(episode.sourceFilePath, path.join(workDir, "frames"), { mode: "interval", interval: 2.0 });

    const tailClipPath = path.join(workDir, "tail.mp4");
    await extractTail(episode.sourceFilePath, tailClipPath, TAIL_SECONDS);
    const tailFrames = await sampleFrames(tailClipPath, path.join(workDir, "tailFrames"), { mode: "interval", interval: 1.0, includeLast: false });

    let segments: Awaited<ReturnType<typeof transcribeSegments>> = [];
    if (await hasAudio(episode.sourceFilePath)) {
      const wavPath = path.join(workDir, "audio.wav");
      await extractAudioToWav(episode.sourceFilePath, wavPath);
      segments = await transcribeSegments(wavPath);
    }

    const messages = buildEpisodeAnalysisMessages(fullFrames, tailFrames, segments);
    const { object } = await u.Ai.Text("anthropic:claude-opus-4-8").invokeObject({
      schema: episodeAnalysisSchema,
      system: EPISODE_ANALYSIS_SYSTEM_PROMPT,
      messages,
    });

    await u.db("ab_episode").where("id", episodeId).update({
      episodeAnalysis: JSON.stringify(object),
      status: "analyzed",
    });
  } catch (e) {
    await u.db("ab_episode").where("id", episodeId).update({ status: "failed", errorReason: u.error(e).message });
    throw e;
  }
}
