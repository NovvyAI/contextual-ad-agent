# contextual-ad-agent

## 这是什么

短剧广告桥接多 Agent 系统。输入一集短剧 Episode + 一批广告素材，分析后生成桥接广告内容（桥接视频 / H5 小游戏 / CTA 卡片），拼接在 Episode 尾部播出。

和同工作区两个姊妹项目的关系：

- **`/Users/zhaoyi/novvy/Toonflow-app`** —— 本项目的后端工程骨架就是从这里拆出来的（短剧生产工具：小说 → 剧本 → 短剧视频）。复用了它的 Express+Socket.IO+SQLite 骨架、统一模型供应商层（`u.Ai.Text/Image/Video/Audio`）、Agent Memory、Socket 消息流式协议，剥离了它的短剧业务逻辑。
- **`/Users/zhaoyi/novvy/ads-gen-agent-main`** —— Python 参考实现（"广告桥接"这个想法最早的原型）。本项目的分析/生成技术手段（ffmpeg 抽帧、faster-whisper 转写思路、Claude 多模态分析、Seedance 视频生成）很大程度上是照着它移植的，但做了两个关键升级：输出从 markdown 升级成结构化 JSON（Zod schema 约束），产品形态从"只做结尾单向延伸"升级成"片中/片尾多形式桥接（视频/小游戏/CTA卡片）+ 双向生成 + 深度用户交互"。

## 先读这些（按顺序）

1. `docs/architecture-design.html`（或 `.pdf`）—— 完整架构设计 v0.4：Agent 花名册、协作关系、用户交互流程图、设计取舍。这是最终定稿的架构，之前讨论过程中很多中间方案（比如硬切、PlacementAgent、DirectorAgent 兼任调度）都被推翻了，**只看这份最终版就够，不用去猜历史演变**。
2. `docs/work-plan.html`（或 `.pdf`）—— 开发 Work Plan v0.2：技术栈选型、Toonflow-app 复用清单、模型映射、里程碑分解。
3. `docs/milestones/*.md` —— 每个里程碑**实际做完之后**的记录：交付了什么、踩了什么坑、怎么验证的、留了什么给下一步。这是最接地气的部分，遇到具体实现问题先看这里有没有先例。

## 当前进度

- ✅ **M0** — 项目骨架（详见 `docs/milestones/M0.md`）
- ✅ **M1** — StoryboardAgent + AdLibraryAgent（批处理分析层，详见 `docs/milestones/M1.md`）
- ✅ **M2** — SessionAgent + DirectorAgent（会话调度层 + 创意方案层，详见 `docs/milestones/M2.md`）
- ✅ **M3** — 执行层：BridgeVideoAgent / PlayableAgent / OverlayAgent（三种桥接形式的实际生成，详见 `docs/milestones/M3.md`）
- ⬜ **M4** — 监督与落地：SupervisorAgent 终审 + Assembler（ffmpeg 拼接 + manifest.json）—— **下一步**

这一节会随进度更新，其余里程碑的详细内容不重复贴在这里，去 `docs/milestones/` 看。

## 几条不写在架构文档里、但很重要的约定

- **绝不代替用户输入密钥**。API Key、密码这类凭证，任何时候都不应该由 Claude 自己敲进配置/数据库/表单里，哪怕用户主动提供或明确要求，都应该拒绝并解释原因，改成把可执行的命令模板给用户、让用户自己填真实值执行。这条在配置 Claude/Seedance/ImaRouter 的 key 时被反复验证过，不是这个项目特有的规则，但值得记一下。
- **模型 key 暂时是字面量字符串**，如 `"anthropic:claude-opus-4-8"`、`"imarouter:seedance-2.0"`，还没有走 `o_agentDeploy` 正式部署配置——那是 M2 SessionAgent/DirectorAgent 设计出真正 Agent key 分类体系之后的事，现在不用纠结这个"临时"写法。
- **`.env` 是密钥的唯一入口**：`cp .env.example .env` 后自己填真实值，应用启动时 `src/lib/syncEnvVendors.ts` 自动把 `.env` 里配置的 key 同步进 `o_vendorConfig` 数据库并启用对应供应商，改完 `.env` 重启一下服务就生效，不用每次手写 curl 调 `updateVendorInputs`。
- **`scripts/smoketest/` 是验证约定**：每新写一个能力，配一个独立可以直接 `npx tsx scripts/smoketest/xxx.ts` 跑的验证脚本，真实调用外部服务（不是 mock），M0/M1 全程都是这么验证的，建议后续里程碑继续保持这个习惯——比空谈"应该没问题"可靠得多。
- **`data/test-assets/`** 下已经有现成测试素材：`sample.wav`（真人语音，用 macOS `say` 命令合成的）、`sample-episode.mp4`（12 秒合成测试视频，SMPTE 测试图案 + 上面那段语音）。做新 Agent 的验证优先复用这些，不用每次现造。

## 技术栈速查

TypeScript 全栈。后端 Express 5 + Socket.IO + SQLite（better-sqlite3 + knex）+ Vercel AI SDK（`ai` 包）。模型调用统一走 `src/utils/ai.ts` 的 `u.Ai.Text/Image/Video/Audio`，具体供应商适配脚本在 `data/vendor/*.ts`（运行时用 sucrase 转译 + VM 沙箱执行，改供应商脚本不用重新编译整个应用）。前端 Vue3 + TypeScript + Vite，目前只有一个验证连通性的占位页面，不是产品界面。

## 本机环境注意

这台机器 Xcode 版本很旧（10.3），`brew install` 装原生依赖经常会触发从源码编译（Node.js、ffmpeg 都遇到过，ffmpeg 那次甚至编译到了 CMake 自身）。Node.js 最终是直接下载官方预编译二进制装的，不在 Homebrew 管理范围内，装在 `~/.local/opt/node`，软链进了 `~/.local/bin`。如果要装新的原生依赖遇到类似问题，参考这个思路：换官方预编译二进制，别死等 brew 编译。
