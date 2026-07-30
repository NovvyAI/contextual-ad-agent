import { chromium } from "playwright";

export interface SmokeTestResult {
  ok: boolean;
  error?: string;
}

// 这台机器的 macOS 版本太旧，Playwright 自带的 Chromium 不支持（"Playwright does not support chromium on mac13"），
// 用 channel:"chrome" 直接驱动机器上已经装好的真实 Chrome，不下载 Playwright 自己的浏览器二进制。
const LAUNCH_OPTIONS = { channel: "chrome", headless: true } as const;

/**
 * 冒烟级别验证：只检查生成出的游戏 HTML 能不能正常加载、有没有抛未捕获异常、有没有在合理时间内发出 game_ready 信号。
 * 不验证玩法逻辑本身对不对——那类问题需要真的操作才能发现，这是这条路径承认的已知局限。
 */
export async function runGameSmokeTest(html: string, timeoutMs = 8000): Promise<SmokeTestResult> {
  const browser = await chromium.launch(LAUNCH_OPTIONS);
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`未捕获异常: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    let gameReady = false;
    await page.exposeFunction("__smokeTestSignal", (type: string) => {
      if (type === "game_ready") gameReady = true;
    });
    // page.setContent() 不会应用 addInitScript（试过，"message" 监听器从未被注册），
    // 改成把监听脚本直接拼在内容最前面——独立加载时 window.parent 就是自己，
    // 生成代码调用 parent.postMessage(...) 会原样触发同一个 window 上的 message 事件。
    const listenerScript = `<script>window.addEventListener("message", function (e) { if (e.data && e.data.type) window.__smokeTestSignal(e.data.type); });</script>`;
    await page.setContent(listenerScript + html, { waitUntil: "load", timeout: timeoutMs });

    const deadline = Date.now() + timeoutMs;
    while (!gameReady && errors.length === 0 && Date.now() < deadline) {
      await page.waitForTimeout(200);
    }

    if (errors.length > 0) return { ok: false, error: errors.join("; ") };
    if (!gameReady) return { ok: false, error: `${timeoutMs}ms 内没有收到 game_ready 信号，可能页面卡住或没有实现这个协议` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close();
  }
}
