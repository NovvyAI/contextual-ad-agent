import { pipeline, env as transformersEnv, AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import fs from "fs";
import { WaveFile } from "wavefile";

// ── 模型配置 ──
// 和 utils/agent/embedding.ts 的本地 ONNX 模型加载方式一致，但这里刻意允许远程下载
// （allowRemoteModels: true）——不像 embedding 模型那样把权重提交进仓库，因为 Episode/
// 广告素材本来就是大体积媒体，处理阶段本就假定有网络，没必要再让仓库多背一个大模型。
const MODEL_ID = "onnx-community/whisper-base";

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

export async function initAsr(): Promise<void> {
  if (transcriber) return;

  transformersEnv.allowRemoteModels = true;
  transformersEnv.allowLocalModels = true;

  // @ts-ignore - pipeline 重载联合类型过于复杂
  transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, { dtype: "fp32" });
}

/**
 * Node 环境没有浏览器的 AudioContext，transformers.js 没法直接吃文件路径/URL，
 * 需要自己把 WAV 解码成 16kHz 单声道 Float32Array 再喂给 pipeline。
 * 参考: https://huggingface.co/docs/transformers.js/guides/node-audio-processing
 */
function decodeWavTo16kMono(filePath: string): Float32Array {
  const buffer = fs.readFileSync(filePath);
  const wav = new WaveFile(buffer);
  wav.toBitDepth("32f");
  wav.toSampleRate(16000);
  let samples = wav.getSamples() as unknown as Float32Array | Float32Array[];
  if (Array.isArray(samples)) {
    // 多声道：简单平均混音为单声道
    const [ch0, ch1] = samples;
    if (ch1) {
      const mono = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; ++i) mono[i] = (ch0[i] + ch1[i]) / 2;
      samples = mono;
    } else {
      samples = ch0;
    }
  }
  return samples as Float32Array;
}

export async function transcribe(audioFilePath: string): Promise<string> {
  if (!transcriber) await initAsr();
  const audioData = decodeWavTo16kMono(audioFilePath);
  const output: any = await transcriber!(audioData);
  const result = Array.isArray(output) ? output[0] : output;
  return result?.text ?? "";
}

export interface AsrSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * 带时间戳的分段转写，供需要"哪句话大概几秒说的"这种场景使用（比如拼多模态分析 prompt）。
 * whisper-base 原生只能处理 <=30s 的窗口，chunk_length_s/stride_length_s 让它能处理更长音频。
 */
export async function transcribeSegments(audioFilePath: string): Promise<AsrSegment[]> {
  if (!transcriber) await initAsr();
  const audioData = decodeWavTo16kMono(audioFilePath);
  const output: any = await transcriber!(audioData, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  } as any);
  const result = Array.isArray(output) ? output[0] : output;
  const chunks = result?.chunks ?? [];
  return chunks.map((c: any) => ({
    start: Math.round((c.timestamp?.[0] ?? 0) * 100) / 100,
    end: Math.round((c.timestamp?.[1] ?? 0) * 100) / 100,
    text: (c.text ?? "").trim(),
  }));
}

export async function disposeAsr(): Promise<void> {
  await transcriber?.dispose?.();
  transcriber = null;
}
