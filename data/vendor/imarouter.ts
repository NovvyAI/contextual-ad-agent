/**
 * ImaRouter (Seedance / Kling 视频) 供应商适配
 * @version 1.0
 *
 * 说明：
 * 1) 只接视频生成，Seedance 部分和 ads-gen-agent-main 的 tools/seedance.py 走的是同一个平台/同一套接口契约
 * 2) 提交任务 POST {baseUrl}/v1/videos，轮询 GET {baseUrl}/v1/videos/{id}——两个模型共用同一对端点，
 *    靠 body.model 字段路由到不同供应商，但两边请求体 schema 完全不同（见下）
 * 3) Seedance 时长只接受 4/5/6/8/10/12/15 秒；参考图/参考视频优先走 ImaRouter 的素材审核流程
 *    （POST /v1/assets/group/create 建分组 → POST /v1/assets/create 传公网可访问的 url 建素材 →
 *    POST /v1/assets/get 轮询审核状态 → /v1/videos 里用 asset://<assetId> 引用），这是文档推荐的
 *    正式接入方式，也是唯一能避免"疑似真实人物"隐私合规拦截的路径——真实测试过：同一张人像图，
 *    直接塞 base64 临时直链会被 Seedance/Doubao 判定为疑似真实人物而拒绝，走这条素材审核流程能
 *    正常通过并渲染成功。只有 referenceList 里的图片没带公网 url（比如本机 dev 环境用的是
 *    localhost，ImaRouter 的服务器访问不到）时，才退回 base64 data URI 直传，这条路径本机开发
 *    环境验证过能跑通，但会带着"疑似真实人物"这类隐私合规拦截的风险，生产环境配了公网 ossURL
 *    之后就不会再走这条。
 * 4) Kling v3 Omni（modelName: kling-v3-omni-video）是完全不同的请求 schema，照官方 OpenAPI
 *    （https://doc.imarouter.com/openapi/en.yaml，搜 KlingV3OmniVideoCreateRequest）核对过：
 *    `additionalProperties: false`，没有 Seedance 那套 metadata/resolution 字段，也不认识
 *    asset:// 引用（image/images/image_list 官方声明是 format:uri，只提到公网 url，没提到
 *    asset:// 这种协议）；画质档位不是靠传分辨率数字，是靠 mode 字段（std/pro，默认 std）；
 *    真实字段是 model/prompt/duration/aspect_ratio/mode/sound/image/images/image_list/
 *    video_url/video_list。**真实调用验证过：image 字段不接受 base64 data URI**——传了会导致
 *    ImaRouter 后端拿这段 base64 字符串去 wget 下载，命令行参数长度爆掉直接报错（cut 76 真实
 *    复现），不是等接口报"格式不对"这种干净的错。所以和 Seedance 不一样，Kling 这条路径完全没有
 *    "没有公网地址就退回 base64"这个后备选项——本机 dev 环境没配 ossURL 时，选 Kling 且需要传参考图
 *    会直接在 videoRequest 里提前抛出明确报错，不会真的把请求发出去。
 */
// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
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
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string; disabled?: boolean }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string; url?: string }
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
  mode: VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
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
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "imarouter",
  version: "1.0",
  author: "contextual-ad-agent",
  name: "ImaRouter (Seedance)",
  description: "ImaRouter 模型路由平台，视频生成接口，和 ads-gen-agent-main 使用同一个平台/同一套接口契约。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "ImaRouter API Key" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "https://api.imarouter.com" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.imarouter.com",
  },
  models: [
    {
      name: "Seedance 2.0",
      modelName: "seedance-2.0",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:1", "videoReference:1", "audioReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [4, 5, 6, 8, 10, 12, 15], resolution: ["480p", "720p", "1080p"] }],
    },
    // 时长照 ImaRouter 官方 OpenAPI 里 KlingV3VideoDuration 的确认值（3-15 秒任意整数）。
    // 分辨率这个模型的请求体里根本没有对应字段（不像 Seedance 能显式传 resolution）——画质是靠
    // mode（std/pro）控制的，这里的 720p/1080p 只是我们系统自己给用户看的近似档位标签，实际请求时
    // videoRequest 会把它映射成 mode=std/pro，不代表官方保证这两个 mode 分别精确对应这两个分辨率，
    // 没有真实调用验证过。参考图数量（最多 7 张图 + 1 段视频）是照抄可灵官方能力，但目前
    // videoGenAgent 的 Stage B 每次只传 1 张草案图，用不上这个上限。
    {
      name: "Kling v3 Omni",
      modelName: "kling-v3-omni-video",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:7", "videoReference:1"]],
      audio: "optional",
      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p", "1080p"] }],
    },
  ],
};
// ============================================================
// 辅助函数
// ============================================================
const TERMINAL_OK = ["succeeded", "completed", "success"];
const TERMINAL_FAIL = ["failed", "error", "cancelled", "canceled"];

const getBaseUrl = () => (vendor.inputValues.baseUrl || "https://api.imarouter.com").replace(/\/+$/, "");

const getHeaders = () => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
};

// 按具体模型自己声明的 durationResolutionMap clamp，不再用 Seedance 专属的硬编码档位——
// Kling v3 Omni 加进来之后，两个模型允许的时长/分辨率档位并不一样（Kling 没有 1080p，
// 时长档位也更密），clamp 逻辑必须按 model 走，不能所有模型共用一份档位表。
const clampToAllowed = (value: number, allowed: number[]): number => {
  if (allowed.length === 0 || allowed.includes(value)) return value;
  // 取最接近的一个允许值，而不是直接报错，体验更好
  return allowed.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best));
};

const clampResolution = (resolution: string, allowed: string[]): string => {
  if (allowed.length === 0 || allowed.includes(resolution)) return resolution;
  // 分辨率没有"数值最接近"的自然概念，退回这个模型支持的第一档（当前两个模型都只有一档以上时取最高档在前）
  return allowed[0];
};

const isPublicUrl = (url: string): boolean => /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(url);

// 素材分组——真实调用确认过 group_id 是必填项，没有枚举/查询已有分组的接口，每次请求建一个新分组，
// 接受这点小开销（几百毫秒的 HTTP 往返），换取不用操心 VM 沙箱执行之间能不能持久化缓存
async function createAssetGroup(headers: Record<string, string>): Promise<string> {
  const resp = await axios.post(
    `${getBaseUrl()}/v1/assets/group/create`,
    { name: "contextual-ad-agent", group_type: "AIGC", project_name: "default", model: "seedance-upload" },
    { headers },
  );
  const groupId = resp.data?.data?.Id;
  if (!resp.data?.success || !groupId) {
    throw new Error(`创建素材分组失败：${resp.data?.message || JSON.stringify(resp.data).slice(0, 300)}`);
  }
  return groupId;
}

const ASSET_TERMINAL_OK = ["active", "approved", "success"];
const ASSET_TERMINAL_FAIL = ["rejected", "failed", "error", "banned", "blocked"];

/**
 * 上传一张公网可访问的图片素材并等审核完成，返回 asset://<id> 引用——真实测试过这条流程，
 * 素材状态字段是 Status，只观察到过 "Active"（审核通过，几乎立即），没实测到过拒绝态的具体字符串，
 * 所以拒绝分支按常见命名保守匹配，真遇到没覆盖到的状态值就会超时报错，把原始状态带出来方便排查。
 */
async function uploadAssetAndGetReference(headers: Record<string, string>, url: string): Promise<string> {
  const groupId = await createAssetGroup(headers);
  const createResp = await axios.post(`${getBaseUrl()}/v1/assets/create`, { url, group_id: groupId }, { headers });
  const assetId = createResp.data?.data?.Id;
  if (!createResp.data?.success || !assetId) {
    throw new Error(`素材上传失败：${createResp.data?.message || JSON.stringify(createResp.data).slice(0, 300)}`);
  }

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const getResp = await axios.post(`${getBaseUrl()}/v1/assets/get`, { id: assetId }, { headers });
      const status = String(getResp.data?.data?.Status ?? "").toLowerCase();
      if (ASSET_TERMINAL_OK.includes(status)) return { completed: true, data: assetId };
      if (ASSET_TERMINAL_FAIL.includes(status)) return { completed: true, error: `素材未通过审核（状态：${status || "未知"}）` };
      return { completed: false };
    },
    2000,
    60000,
  );
  if (pollResult.error) throw new Error(pollResult.error);
  if (!pollResult.data) throw new Error("素材审核轮询超时，未拿到结果");
  return `asset://${pollResult.data}`;
}

const extractVideoUrl = (result: any): string | null => {
  const candidates: (string | undefined)[] = [];
  if (Array.isArray(result?.results)) {
    for (const item of result.results) {
      if (item && typeof item === "object" && item.url) candidates.push(item.url);
      else if (typeof item === "string") candidates.push(item);
    }
  }
  if (result?.metadata?.url) candidates.push(result.metadata.url);
  if (result?.video_url) candidates.push(result.video_url);
  if (result?.output) {
    if (typeof result.output === "object" && result.output.url) candidates.push(result.output.url);
    else if (typeof result.output === "string") candidates.push(result.output);
  }
  return candidates.find((c) => Boolean(c)) ?? null;
};

// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  throw new Error("ImaRouter 供应商目前只接了视频生成，文本模型请用 anthropic 等其他供应商。");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  return "";
};

const isKlingModel = (modelName: string): boolean => modelName.startsWith("kling");

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const headers = getHeaders();
  const allowed = model.durationResolutionMap[0] ?? { duration: [], resolution: [] };
  const duration = clampToAllowed(config.duration, allowed.duration);
  const kling = isKlingModel(model.modelName);

  const imageItems = (config.referenceList || []).filter((r): r is Extract<ReferenceList, { type: "image" }> => r.type === "image");
  const imageRefs: string[] = [];
  for (const item of imageItems) {
    if (kling) {
      // 真实调用验证过：Kling 这条路由不接受 base64 data URI——传了之后 ImaRouter 后端会拿这个
      // "url" 去做 wget 下载，一个几百 KB 的 base64 字符串当命令行参数直接把 wget 干爆（真实报错：
      // "wget download failed: fork/exec /usr/bin/wget: argument list too long"，cut 76 上真实
      // 复现过）。不像 Seedance 那样"没有公网地址就退回 base64 直传"还能勉强跑，Kling 没有任何
      // 退路——本机没配 ossURL 时就直接在这里报清楚的错，不要把一个必然失败的 base64 请求发出去，
      // 让用户在下游收到一个不知所云的 wget 报错。
      if (!item.url || !isPublicUrl(item.url)) {
        throw new Error("Kling v3 Omni 只接受公网可访问的图片 URL，不支持 base64 直传——这台机器还没配置公网 ossURL，暂时没法用这个模型生成参考图视频。");
      }
      imageRefs.push(item.url);
    } else if (item.url && isPublicUrl(item.url)) {
      imageRefs.push(await uploadAssetAndGetReference(headers, item.url));
    } else {
      imageRefs.push(`data:image/png;base64,${item.base64}`);
    }
  }
  const videoRefs = (config.referenceList || []).filter((r) => r.type === "video").map((r) => `data:video/mp4;base64,${r.base64}`);
  const audioRefs = (config.referenceList || []).filter((r) => r.type === "audio").map((r) => `data:audio/mp3;base64,${r.base64}`);

  let body: any;
  let resolutionLabel: string;
  if (kling) {
    // Kling v3 Omni 的请求体和 Seedance 完全不同（additionalProperties:false，字段名也不一样），
    // 详见文件顶部说明。没有 resolution 字段，画质档位靠 mode（std/pro）控制——用我们系统自己的
    // 720p/1080p 设置近似映射到 std/pro，不代表官方保证这个映射关系精确对应分辨率数值。
    resolutionLabel = clampResolution(config.resolution || "1080p", allowed.resolution);
    const mode = resolutionLabel === "1080p" ? "pro" : "std";
    body = { model: model.modelName, duration, mode, sound: config.audio ? "on" : "off" };
    if (config.prompt) body.prompt = config.prompt;
    if (config.aspectRatio) body.aspect_ratio = config.aspectRatio;
    if (videoRefs.length > 0) body.video_list = videoRefs.map((v) => ({ video_url: v }));
    else if (imageRefs.length === 1) body.image = imageRefs[0];
    else if (imageRefs.length > 1) body.image_list = imageRefs;
  } else {
    resolutionLabel = clampResolution(config.resolution || "1080p", allowed.resolution);
    body = { model: model.modelName, prompt: config.prompt || "", duration, metadata: { resolution: resolutionLabel } };
    if (config.aspectRatio) body.aspect_ratio = config.aspectRatio;
    if (videoRefs.length > 0) body.video_url = videoRefs[0];
    if (imageRefs.length > 0) body.images = imageRefs;
    if (audioRefs.length > 0) body.metadata.reference_audio_urls = audioRefs;
  }

  logger(`[ImaRouter 视频] 提交任务: ${model.modelName}, duration=${duration}, resolution=${resolutionLabel}, imageRefs=${imageRefs.length}`);
  const submitResp = await axios.post(`${getBaseUrl()}/v1/videos`, body, { headers });
  const taskId = submitResp.data?.id || submitResp.data?.task_id;
  if (!taskId) {
    throw new Error(`视频任务提交失败：未获取到任务ID。原始响应：${JSON.stringify(submitResp.data).slice(0, 500)}`);
  }

  const pollResult = await pollTask(
    async (): Promise<PollResult> => {
      const resultResp = await axios.get(`${getBaseUrl()}/v1/videos/${taskId}`, { headers });
      const data = resultResp.data;
      const status = String(data?.status ?? "").toLowerCase();

      if (TERMINAL_OK.includes(status)) {
        const videoUrl = extractVideoUrl(data);
        if (videoUrl) return { completed: true, data: videoUrl };
        return { completed: true, error: "任务成功但未返回视频地址" };
      }
      if (TERMINAL_FAIL.includes(status)) {
        const detail = data?.error?.message ? ` — ${String(data.error.message).slice(0, 500)}` : "";
        return { completed: true, error: `视频生成失败: ${status}${detail}` };
      }
      return { completed: false };
    },
    5000,
    900000,
  );

  if (pollResult.error) throw new Error(pollResult.error);
  if (!pollResult.data) throw new Error("视频生成失败：轮询未返回数据");
  return await urlToBase64(pollResult.data);
};

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: vendor.version, notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};
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
