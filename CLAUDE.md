# contextual-ad-agent

## 这是什么

短剧广告桥接多 Agent 系统。输入一集短剧 Episode + 一条游戏类广告素材（游戏视频或游戏文字），分析后生成固定两段式的桥接内容——一段从 Episode 结尾过渡到游戏开场的视频，紧接一个真实反映该游戏的 H5 配对小游戏——拼接在 Episode 尾部播出。M0-M6 时期是"桥接视频/H5 小游戏/CTA 卡片"三选一的架构，M7 起改成了这个固定两段式管线，详见 `docs/milestones/M7.md`。

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
- ✅ **M4** — 监督与落地：SupervisorAgent 终审 + Assembler（详见 `docs/milestones/M4.md`）
- ✅ **M5** — 前端：Vue3+TDesign+Pinia 界面，端到端跑通完整链路（详见 `docs/milestones/M5.md`）
- ✅ **M6** — 联调与验收：用 AI 生成的虚构真实感素材（不是技术测试图案）真实跑通完整案例，补上分阶段耗时统计，修复两个模型调用层兼容性 bug（详见 `docs/milestones/M6.md`）

**M0-M6 是原始 work-plan 规划的全部里程碑**——从"上传 Episode+广告素材"到"落地一个真实可访问的最终交付物"的完整链路已经端到端跑通并验证，M5（浏览器界面）是规划之外但一直明确知道要做的追加里程碑，M6 补上了"用真实感素材验收"这最后一环。

- ✅ **M7** — 重新设计桥接流程：三选一形式（video/playableGame/ctaCard）改成固定两段式管线（过渡视频→H5 小游戏），Episode 分析加了观众情绪维度，新增手动确认组装小游戏的交互点（详见 `docs/milestones/M7.md`）
- ✅ **M8** — 真实游戏内容管线：AdLibraryAgent 分析视频广告时顺带挑出真实游戏截图（`tileCandidates`），PlayableAgent 配对小游戏素材优先用这些真实截图（不够才回退 AI 生成），VideoGenAgent 选广告参考图优先用这些已验证的帧，SupervisorAgent 对 `playableGame` 的终审这次真的会看一张实际画面（详见 `docs/milestones/M8.md`）
- ✅ **M9** — 前端展示精修（删掉 M7 遗留的 ctaCard 死代码）、自定义游戏 revise（`PlayableAgent.reviseCustomGame`，失败时保留原有可玩游戏不动）、Episode/视频/游戏视觉素材传承（StoryboardAgent 新增候选素材 `tileCandidates`，生成游戏素材时让用户勾选这些真实画面作为参考图，游戏组装完成后视频 revise 能回头呼应已生成的真实游戏素材）（详见 `docs/milestones/M9.md`）

这一节会随进度更新，其余里程碑的详细内容不重复贴在这里，去 `docs/milestones/` 看。

## 几条不写在架构文档里、但很重要的约定

- **绝不代替用户输入密钥**。API Key、密码这类凭证，任何时候都不应该由 Claude 自己敲进配置/数据库/表单里，哪怕用户主动提供或明确要求，都应该拒绝并解释原因，改成把可执行的命令模板给用户、让用户自己填真实值执行。这条在配置 Claude/Seedance/ImaRouter 的 key 时被反复验证过，不是这个项目特有的规则，但值得记一下。
- **模型 key 暂时是字面量字符串**，如 `"anthropic:claude-opus-4-8"`、`"imarouter:seedance-2.0"`，还没有走 `o_agentDeploy` 正式部署配置——那是 M2 SessionAgent/DirectorAgent 设计出真正 Agent key 分类体系之后的事，现在不用纠结这个"临时"写法。
- **`.env` 是密钥的唯一入口**：`cp .env.example .env` 后自己填真实值，应用启动时 `src/lib/syncEnvVendors.ts` 自动把 `.env` 里配置的 key 同步进 `o_vendorConfig` 数据库并启用对应供应商，改完 `.env` 重启一下服务就生效，不用每次手写 curl 调 `updateVendorInputs`。
- **`scripts/smoketest/` 是验证约定**：每新写一个能力，配一个独立可以直接 `npx tsx scripts/smoketest/xxx.ts` 跑的验证脚本，真实调用外部服务（不是 mock），M0/M1 全程都是这么验证的，建议后续里程碑继续保持这个习惯——比空谈"应该没问题"可靠得多。
- **`data/test-assets/`** 下已经有现成测试素材：`sample.wav`（真人语音，用 macOS `say` 命令合成的）、`sample-episode.mp4`（12 秒合成测试视频，SMPTE 测试图案 + 上面那段语音，终审面对这份素材永远会诚实判定不通过）。做新 Agent 的验证优先复用这些，不用每次现造。`m6-episode.mp4`/`m6-ad-*.jpg` 是 M6 新生成的、更接近真实观感的虚构素材（AI 生成的插画风格短剧片段 + 三个虚构广告品牌），需要验证终审在有真实叙事内容素材上的表现时用这套，见 `docs/milestones/M6.md`。
- **M0-M6 全部完成之后，零散的修改意见和小改动记在 `docs/CHANGELOG.md`**，不再各自开一个里程碑文档——每次改完东西（不管是用户反馈驱动的还是顺手修的），照着文件里的格式加一条新记录（时间倒序，最新的放最上面）。
- **每次调用大模型都会把输入输出打印到 terminal**（`src/utils/ai.ts` 统一加的，见 `docs/CHANGELOG.md` 2026-07-26 那条），非文本内容（图片/视频/音频）只打印摘要，不会刷屏原始 base64。这些日志就是普通的 `console.log`，没有落盘成单独的日志文件——自己在终端里跑 `yarn dev` 就直接看终端；如果是用 `nohup yarn dev > xxx.log 2>&1 &` 这种方式重定向到文件启动的，用 `tail -f` 那个文件看。

## 技术栈速查

TypeScript 全栈。后端 Express 5 + Socket.IO + SQLite（better-sqlite3 + knex）+ Vercel AI SDK（`ai` 包）。模型调用统一走 `src/utils/ai.ts` 的 `u.Ai.Text/Image/Video/Audio`，具体供应商适配脚本在 `data/vendor/*.ts`（运行时用 sucrase 转译 + VM 沙箱执行，改供应商脚本不用重新编译整个应用）。前端 Vue3 + TypeScript + Vite，`frontend/` 独立子工程（`tdesign-vue-next` 组件库 + Pinia + `vue-router` + `socket.io-client`），M5 起是真正的产品界面，详见 `docs/milestones/M5.md`。

## 本机环境注意

这台机器 Xcode 版本很旧（10.3），`brew install` 装原生依赖经常会触发从源码编译（Node.js、ffmpeg 都遇到过，ffmpeg 那次甚至编译到了 CMake 自身）。Node.js 最终是直接下载官方预编译二进制装的，不在 Homebrew 管理范围内，装在 `~/.local/opt/node`，软链进了 `~/.local/bin`。如果要装新的原生依赖遇到类似问题，参考这个思路：换官方预编译二进制，别死等 brew 编译。

这台机器的 macOS 版本是 13.2.1，`playwright install chromium` 会报 "Playwright does not support chromium on mac13"（Playwright 自带的 Chromium 构建不支持这个系统版本）。机器上已经装了真实的 Google Chrome（`/Applications/Google Chrome.app`），Playwright 启动时加 `channel: "chrome"` 就能直接驱动这个已安装的 Chrome，不需要另外下载 Playwright 自带的浏览器二进制。

包管理器用的是 **Yarn**（`yarn.lock` 存在，没有 `package-lock.json`），装新依赖用 `yarn add`，不要用 `npm install`——这个项目的 `@rmp135/sql-ts`（DB 类型生成用）和 `sqlite3` 之间有一个 npm 会报 `ERESOLVE` 冲突但 yarn 能正常处理的 peer dependency 不一致，不是新引入的问题。
