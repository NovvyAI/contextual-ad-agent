import { execFile } from "child_process";
import { promisify } from "util";
import u from "@/utils";

const execFileAsync = promisify(execFile);

// Seedance/Kling 这类走 ImaRouter 中转的视频模型需要真正公网可访问的图片 url（Seedance 走
// asset:// 素材审核流程、Kling 的 image 字段直接要求 format:uri），但这台机器 NODE_ENV 永远是
// "dev"、.env 没配 ossURL，u.oss.getFileUrl() 只会返回 http://localhost:10588/... （具体原因见
// CLAUDE.md 已知问题）。这个桶是这个 GCP 项目（novvy-dev）里已经建好、allUsers 有 objectViewer
// 权限的公开桶，本来就是给这类"需要临时公网直链喂给第三方视频生成 API"的场景用的，不是这个项目
// 专属——传的时候统一加 contextual-ad-agent/ 前缀，避免和同一个桶里其他项目的文件混在一起。
const GCS_PUBLIC_BUCKET = "novvy-seedance-public";

function isPublicHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(url);
}

/**
 * 确保拿到一个真正公网可访问的图片 url——u.oss.getFileUrl() 已经是公网地址（生产环境配了 ossURL）
 * 就直接用，不是的话（本机 dev 环境的常态）就把文件传到 GCS 公开桶，换一个真实公网直链。
 *
 * 没有装 @google-cloud/storage 这类 SDK、也没配 Application Default Credentials——直接复用这台
 * 机器上已经登录过的 gcloud CLI 身份（execFile 传参数数组，不走 shell，避免注入），比额外装依赖、
 * 配一套新的凭证体系更省事。这也意味着：换一台没有装 gcloud 或者没登录过的机器，这条路会直接报错，
 * 不是静默失败——生产环境如果要用这条路径，得确保部署环境也有 gcloud 或者换成真正的 ossURL 配置。
 *
 * 注意：传上去的图片在这个公开桶里是任何人都能访问的（allUsers:objectViewer），这是 ImaRouter/Kling
 * 官方接口本来就要求"公网可访问"这个前提决定的，不是这个函数额外引入的风险——Episode 草案图本身
 * 也只是 AI 生成的过渡画面，不是什么需要严格保密的素材。
 */
export async function ensurePublicImageUrl(relPath: string): Promise<string> {
  const localUrl = await u.oss.getFileUrl(relPath);
  if (isPublicHttpUrl(localUrl)) return localUrl;

  const absPath = u.getPath(["oss", relPath]);
  const destPath = `contextual-ad-agent/${relPath}`;
  await execFileAsync("gcloud", ["storage", "cp", absPath, `gs://${GCS_PUBLIC_BUCKET}/${destPath}`]);
  return `https://storage.googleapis.com/${GCS_PUBLIC_BUCKET}/${destPath}`;
}
