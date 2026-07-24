import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export interface FrameRecord {
  index: number;
  file: string;
  path: string;
  /** scene 模式下拿不到准确时间戳，和 Python 参考实现一致用 null 表示 */
  approxTimestampS: number | null;
  isLast: boolean;
}

export interface SampleFramesOptions {
  mode?: "interval" | "scene" | "count";
  interval?: number; // 默认 2.0，mode=interval
  count?: number; // 默认 9，mode=count；也是 scene 模式零帧兜底时的数量（固定5，不受这个参数影响）
  sceneThreshold?: number; // 默认 0.4，mode=scene
  width?: number; // 默认 640
  quality?: number; // 默认 3（ffmpeg -q:v）
  includeLast?: boolean; // 默认 true
}

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, { maxBuffer: 1024 * 1024 * 64 });
  } catch (err: any) {
    throw new Error(`${cmd} 执行失败: ${err.message}`);
  }
}

export async function requireFfmpeg(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
  } catch {
    throw new Error("未找到 ffmpeg/ffprobe，请先安装：brew install ffmpeg");
  }
}

export async function probeDuration(videoPath: string): Promise<number> {
  await requireFfmpeg();
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = parseFloat(stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

export async function hasAudio(videoPath: string): Promise<boolean> {
  await requireFfmpeg();
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", videoPath]);
  return stdout.includes("audio");
}

export async function extractTail(videoPath: string, outputPath: string, seconds = 10.0): Promise<void> {
  await requireFfmpeg();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-sseof",
    `-${seconds}`,
    "-i",
    videoPath,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

/** Node 端 asr.ts 用 wavefile 解码，需要真实 WAV 文件（不像 Python 那边 faster-whisper 能直接吃容器） */
export async function extractAudioToWav(videoPath: string, outputWavPath: string): Promise<void> {
  await requireFfmpeg();
  fs.mkdirSync(path.dirname(outputWavPath), { recursive: true });
  await run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", outputWavPath]);
}

async function probeDims(videoPath: string): Promise<{ width: number; height: number }> {
  await requireFfmpeg();
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", videoPath]);
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width, height };
}

/**
 * 拼接两段视频（如 drama tail + 桥接视频），统一按第二段的分辨率缩放+补边后拼接。
 * 照搬 Python 参考实现 build_playable.py::concat_videos() 的 filter_complex 写法，两段都要求带音轨。
 */
export async function concatVideos(firstPath: string, secondPath: string, outputPath: string): Promise<void> {
  await requireFfmpeg();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const { width, height } = await probeDims(secondPath);
  const norm = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
  await run("ffmpeg", [
    "-y",
    "-i",
    firstPath,
    "-i",
    secondPath,
    "-filter_complex",
    `[0:v]${norm}[v0];[1:v]${norm}[v1];[0:a]aresample=44100[a0];[1:a]aresample=44100[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

function buildScaleFilter(width?: number): string {
  return width ? `scale=${width}:-2,format=yuvj420p` : "scale=iw:ih,format=yuvj420p";
}

async function extractSingleFrame(videoPath: string, outputPath: string, seekArgs: string[], scale: string, quality: number): Promise<boolean> {
  try {
    await run("ffmpeg", ["-y", ...seekArgs, "-i", videoPath, "-vf", scale, "-frames:v", "1", "-q:v", String(quality), outputPath]);
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

function readFrameFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^frame_\d+\.jpg$/.test(f))
    .sort();
}

export async function sampleFrames(videoPath: string, outDir: string, opts: SampleFramesOptions = {}): Promise<FrameRecord[]> {
  await requireFfmpeg();
  const mode = opts.mode ?? "interval";
  const interval = opts.interval ?? 2.0;
  const count = opts.count ?? 9;
  const sceneThreshold = opts.sceneThreshold ?? 0.4;
  const width = opts.width ?? 640;
  const quality = opts.quality ?? 3;
  const includeLast = opts.includeLast ?? true;

  fs.mkdirSync(outDir, { recursive: true });
  // 清理上一次跑这个目录时留下的抽帧结果，避免新旧混在一起
  for (const f of fs.readdirSync(outDir)) {
    if (/^frame_/.test(f)) fs.unlinkSync(path.join(outDir, f));
  }

  const scale = buildScaleFilter(width);
  const pattern = path.join(outDir, "frame_%04d.jpg");
  let records: FrameRecord[] = [];

  if (mode === "interval") {
    await run("ffmpeg", ["-y", "-i", videoPath, "-vf", `fps=1/${interval},${scale}`, "-vsync", "vfr", "-q:v", String(quality), pattern]);
    records = readFrameFiles(outDir).map((file, i) => ({
      index: i,
      file,
      path: path.join(outDir, file),
      approxTimestampS: Math.round(i * interval * 100) / 100,
      isLast: false,
    }));
  } else if (mode === "scene") {
    await run("ffmpeg", ["-y", "-i", videoPath, "-vf", `select='gt(scene,${sceneThreshold})',${scale}`, "-vsync", "vfr", "-q:v", String(quality), pattern]);
    records = readFrameFiles(outDir).map((file, i) => ({
      index: i,
      file,
      path: path.join(outDir, file),
      approxTimestampS: null,
      isLast: false,
    }));
    if (records.length === 0) {
      // 场景检测一帧都没抓到，退化成固定数量的均匀抽帧（和参考实现一致，固定 count=5）
      return sampleFrames(videoPath, outDir, { ...opts, mode: "count", count: 5 });
    }
  } else if (mode === "count") {
    const duration = await probeDuration(videoPath);
    if (duration <= 0) throw new Error(`无法读取视频时长，count 模式需要有效时长: ${videoPath}`);
    for (let i = 0; i < count; i++) {
      const t = (duration * i) / count;
      const file = `frame_${String(i + 1).padStart(4, "0")}.jpg`;
      const framePath = path.join(outDir, file);
      const ok = await extractSingleFrame(videoPath, framePath, ["-ss", t.toFixed(3)], scale, quality);
      if (ok) {
        records.push({ index: records.length, file, path: framePath, approxTimestampS: Math.round(t * 100) / 100, isLast: false });
      }
    }
  }

  if (includeLast) {
    const duration = await probeDuration(videoPath);
    if (duration > 0) {
      const nearEndPath = path.join(outDir, "frame_near_end.jpg");
      if (await extractSingleFrame(videoPath, nearEndPath, ["-ss", Math.max(0, duration - 1.0).toFixed(3)], scale, quality)) {
        records.push({
          index: records.length,
          file: "frame_near_end.jpg",
          path: nearEndPath,
          approxTimestampS: Math.round((duration - 1.0) * 100) / 100,
          isLast: true,
        });
      }

      const lastPath = path.join(outDir, "frame_last.jpg");
      if (await extractSingleFrame(videoPath, lastPath, ["-sseof", "-3"], scale, quality)) {
        records.push({ index: records.length, file: "frame_last.jpg", path: lastPath, approxTimestampS: duration, isLast: true });
      }
    }
  }

  return records;
}
