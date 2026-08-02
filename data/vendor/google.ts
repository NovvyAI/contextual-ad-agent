/**
 * Google 官方 Gemini API 供应商适配——直连 generativelanguage.googleapis.com，不经过第三方中转。
 * @version 1.1
 *
 * 说明：
 * 1) 图片生成/编辑（Nano Banana / Gemini Flash Image 系列）走 generateContent 接口的多模态输出
 *    （responseModalities 里要 IMAGE），不是 Imagen 那条 predict 接口；参考图/生成结果都是 inline
 *    base64（`inlineData.data`），一次请求直接拿到结果，不需要 pollTask。
 * 2) 视频生成（Veo 3.1）是另一套模式——`predictLongRunning` 提交任务后立即返回一个 operation 资源名，
 *    要轮询 `GET {baseUrl}/{operation.name}` 直到 done:true，从 response.generateVideoResponse.
 *    generatedSamples[0].video.uri 拿下载地址；这个下载地址本身也需要带 x-goog-api-key 才能访问
 *    （不是公开直链），所以在这里就地下载转 base64 返回，不能让上层 AiVideo.run() 自己拿 http 链接
 *    去无鉴权下载（会 401）。图生视频（用参考图）官方文档写明必须固定 8 秒时长，没有自由时长的空间。
 * 3) 鉴权都是用 AI Studio（aistudio.google.com/apikey）生成的 API Key，走 `x-goog-api-key` 请求头，
 *    不需要 OAuth/服务账号那一套；请求地址支持配置，不填就用官方默认地址。
 */
// ============================================================
// 类型定义
// ============================================================
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: ("text" | "singleImage")[];
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };
interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: ("text" | "singleImage")[];
}
interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: any, m: any) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "google",
  version: "1.1",
  author: "contextual-ad-agent",
  name: "Google Gemini 官方接口",
  description: "Google AI Studio 官方 Gemini API，直连不经过中转，接图片生成/编辑（Nano Banana）和视频生成（Veo 3.1）。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "AI Studio (aistudio.google.com/apikey) 生成的 API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: false, placeholder: "https://generativelanguage.googleapis.com/v1beta" },
  ],
  inputValues: { apiKey: "", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  models: [
    { name: "Gemini 3.1 Flash Image", modelName: "gemini-3.1-flash-image", type: "image", mode: ["text", "singleImage", "multiReference"] },
    {
      name: "Veo 3.1",
      modelName: "veo-3.1-generate-preview",
      type: "video",
      mode: ["text", "singleImage"],
      audio: true,
      // 图生视频（singleImage）官方强制固定 8 秒，这里如实标注实际会用到的档位，clampDurationForVeo 里也是按这个来
      durationResolutionMap: [{ duration: [8], resolution: ["720p", "1080p"] }],
    },
  ],
};
// ============================================================
// 辅助工具
// ============================================================
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const getBaseUrl = () => vendor.inputValues.baseUrl || DEFAULT_BASE_URL;
const IMAGE_REQUEST_TIMEOUT_MS = 130000; // 和 openai.ts 保持一致的超时兜底思路

// aspectRatio（宽:高）映射到 Gemini 图片生成支持的比例枚举
function mapAspectRatio(aspectRatio: `${number}:${number}`): string {
  const [w, h] = aspectRatio.split(":").map(Number);
  if (w === h) return "1:1";
  return w > h ? "16:9" : "9:16";
}

// ============================================================
// 适配器函数
// ============================================================
const textRequest = () => {
  throw new Error("Google 供应商目前只接了图片生成，文本模型请用 anthropic 等其他供应商。");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  const parts: any[] = [{ text: config.prompt }];
  for (const ref of config.referenceList ?? []) {
    const b64 = ref.base64.replace(/^data:[^;]+;base64,/, "");
    parts.push({ inlineData: { mimeType: "image/png", data: b64 } });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: mapAspectRatio(config.aspectRatio) },
    },
  };

  logger(`开始提交图片生成任务，模型：${model.modelName}（参考图 ${config.referenceList?.length ?? 0} 张）`);
  let resp: any;
  try {
    resp = await axios.post(`${getBaseUrl()}/models/${model.modelName}:generateContent`, body, {
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      timeout: IMAGE_REQUEST_TIMEOUT_MS,
    });
  } catch (e: any) {
    if (e?.code === "ECONNABORTED") throw new Error(`图片生成请求超过 ${IMAGE_REQUEST_TIMEOUT_MS / 1000} 秒未响应，判定为卡住，已主动放弃`);
    const errBody = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
    throw new Error(`图片生成失败：${errBody}`);
  }

  const responseParts = resp.data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = responseParts.find((p: any) => p.inlineData);
  if (!imagePart) throw new Error(`图片生成返回异常：${JSON.stringify(resp.data).slice(0, 500)}`);
  logger(`图片生成完成`);
  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
};

const VIDEO_SUBMIT_TIMEOUT_MS = 30000; // 提交任务本身很快，真正耗时的是后面的轮询
const VIDEO_POLL_INTERVAL_MS = 10000; // 官方 Python SDK 示例里也是 sleep(10) 再查一次
const VIDEO_POLL_TIMEOUT_MS = 900000; // 15 分钟，和 imarouter.ts 的视频轮询上限保持一致

// resolution 只接受 720p/1080p/4K，不是这三个值之一就退回 1080p（我们目前唯一会传的值）
function normalizeResolution(resolution: string): string {
  const allowed = ["720p", "1080p", "4K"];
  return allowed.includes(resolution) ? resolution : "1080p";
}

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };

  const imageRef = (config.referenceList ?? []).find((r): r is Extract<ReferenceList, { type: "image" }> => r.type === "image");
  const instance: any = { prompt: config.prompt };
  if (imageRef) {
    const b64 = imageRef.base64.replace(/^data:[^;]+;base64,/, "");
    // predictLongRunning 是 Vertex 风格的 predict 接口，图片字段是 bytesBase64Encoded，不是
    // generateContent 那套 inlineData——真实调用验证过，传 inlineData 会报 "isn't supported by this model"
    instance.image = { bytesBase64Encoded: b64, mimeType: "image/png" };
  }

  // 图生视频官方文档写明必须固定 8 秒，不管 config.duration 传了多少——和 Seedance 那种"clamp 到最接近
  // 档位"不一样，这里没有"最接近"可言，只有一个能用的值，如实按 8 秒提交，不假装尊重了调用方传入的时长
  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: config.aspectRatio,
      durationSeconds: 8,
      resolution: normalizeResolution(config.resolution),
    },
  };

  logger(`开始提交视频生成任务，模型：${model.modelName}（参考图 ${imageRef ? 1 : 0} 张，固定 8 秒）`);
  let submitResp: any;
  try {
    submitResp = await axios.post(`${getBaseUrl()}/models/${model.modelName}:predictLongRunning`, body, { headers, timeout: VIDEO_SUBMIT_TIMEOUT_MS });
  } catch (e: any) {
    const errBody = e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
    throw new Error(`视频任务提交失败：${errBody}`);
  }
  const operationName = submitResp.data?.name;
  if (!operationName) throw new Error(`视频任务提交失败：未获取到 operation 名称，原始响应：${JSON.stringify(submitResp.data).slice(0, 500)}`);

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const opResp = await axios.get(`${getBaseUrl()}/${operationName}`, { headers });
      const op = opResp.data;
      if (!op?.done) return { completed: false };
      if (op.error) return { completed: true, error: `视频生成失败：${op.error.message ?? JSON.stringify(op.error).slice(0, 500)}` };
      const videoUri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) return { completed: true, error: `视频生成任务已完成但未返回视频地址：${JSON.stringify(op.response).slice(0, 500)}` };
      return { completed: true, data: videoUri };
    },
    VIDEO_POLL_INTERVAL_MS,
    VIDEO_POLL_TIMEOUT_MS,
  );
  if (pollResult.error) throw new Error(pollResult.error);
  if (!pollResult.data) throw new Error("视频生成失败：轮询未返回数据");

  // 下载地址本身也要带 x-goog-api-key 才能访问（不是公开直链，直接交给上层 AiVideo.run() 无鉴权下载会 401），
  // 所以这里就地下载转成 base64 data URI 返回，不要返回裸 http 链接
  logger(`视频生成完成，正在下载`);
  const downloadResp = await axios.get(pollResult.data, { headers, responseType: "arraybuffer", maxRedirects: 5 });
  const mimeType = downloadResp.headers?.["content-type"] || "video/mp4";
  const videoBase64 = Buffer.from(downloadResp.data).toString("base64");
  return `data:${mimeType};base64,${videoBase64}`;
};
const ttsRequest = async (): Promise<string> => "";
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: vendor.version, notice: "" };
};
const updateVendor = async (): Promise<string> => "";
// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;
export {};
