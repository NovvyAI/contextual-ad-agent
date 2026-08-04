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

M9 之后规划了 M10，目前包含两块：

① **各 Agent 的 prompt 拆分不够干净——`buildXxxMessages` 里混进了本该属于 skill 文件的指令句**。同事 code review 时指出：`buildPlanGenerationMessages` 结尾那句"请针对上面每一条候选广告，各构思一份创意方案（adId 必须严格取自上面列出的广告 id）"是任务指令，不是数据，应该挪进 `director_creative.md`；`buildPlanEvaluationMessages` 结尾"评估结果需要和输入方案顺序一一对应"甚至和 `director_evaluator.md` 结尾那句原样重复，是真实存在的重复隐患（改一处另一处没同步就会不一致）；`buildReviseMessages` 结尾"adId 保持不变，仅调整 narrative / tone"也是通用行为约束，不是这一次调用特有的数据。排查发现 `VideoGenAgent/prompt.ts` 的 `buildStageADraftMessages` 也有同样写法。计划做法：message builder 只负责把结构化数据（Runtime Context Envelope）拼成文本，不掺"请做什么"这类指令，指令性内容全部收进对应的 skill markdown（`data/skills/*.md`）——这样 system prompt 定"要做什么/怎么判断"，message 只放"这次基于什么数据做"，改行为不用碰代码，走已有的 `skillManagement` 管理路由就行。先在 DirectorAgent 验证这个模式（`director_creative.md`/`director_evaluator.md` + 精简 `prompt.ts`），跑通之后再排查是不是其他 agent（VideoGenAgent 已知有这个问题，PlayableAgent/SupervisorAgent 等还没查）也要一起改。

② **评审的打分维度写死在各自的 Zod schema 里，且四份评审（DirectorAgent 的 PlanEvaluator、VideoGenAgent 的 `evaluateDraft`/`evaluateRender`、PlayableAgent 的 `evaluatePlayable`、SupervisorAgent）代码结构高度重复**。同事进一步指出：评分维度应该支持持续调优、不该写死在代码里；同时应该把评审从 DirectorAgent 里解耦出来，单独设一个 Evaluation Agent。排查确认：`narrativeFeasibility`/`gameRelevance`/`adAlignment`（Plan）、`narrativeContinuity`/`visualConsistency`/...（Video，6 个维度）、`interactionExperience`/`functionalCompleteness`（Playable）都是 Zod schema 里硬编码的字段名，`*_evaluator.md` 只描述"这个字段怎么打分"，维度本身能不能存在完全不受 markdown 控制，不是真的可持续调优；四处实现也几乎是"读 skill 文件→拼待评估内容→`invokeObject`→返回"的同一套代码抄了四遍（`evaluatePlayable` 里也有①同款"指令混进 message"的问题）。计划做法：
   - 子维度不做成完全动态 schema（会牺牲 `invokeObject` 结构化输出的类型安全），改成通用的 `dimensions: {name, score}[]` 数组——具体有哪些维度、怎么描述，全部交给对应 skill markdown 的 prompt 决定，代码不用关心叫什么名字。这个改法风险低，因为 M2 milestone 早就记录过"子分不落库，只有 overallScore 进数据库、子分和点评只在 socket 消息里临时传一次"，子维度本来就是纯展示、非持久化的。
   - 抽一个独立的 `src/agents/evaluationAgent/`，提供通用的 `evaluate(skillFile, content) → {dimensions, overallScore, feedback}`，Plan/Video/Playable 三处评审改成调用这个共享实现，各自只传自己的 skill 文件名和待评估内容格式化文本，顺带去掉重复代码。
   - **明确排除 SupervisorAgent**，不把它并进这个通用 Evaluation Agent——前三者都是"仅供参考、不作为自动拦截依据"，SupervisorAgent 的 `passed: boolean` 是真正的拦截判定（不通过会打回内容环节要求重新生成），性质不同，混在一起会把"建议性打分"和"强制性拦截"这两个语义搅到一起。

具体实现细节还没有展开，等真正开始做的时候再规划。

这一节会随进度更新，其余里程碑的详细内容不重复贴在这里，去 `docs/milestones/` 看。

## 已知问题

- **（已解决）Seedance（ImaRouter 中转）反复触发"疑似真实人物"隐私拦截，根因是本机拿不到公网 url，现在靠 GCS 兜底解决了**。真实报错例子（cut 56/58 都遇到过）：`InputImageSensitiveContentDetected.PrivacyInformation`——"The request failed because the input image 'content[1]' may contain real person"，这个检测发生在 Seedance **真正生成视频**那一步（不是提交阶段），即使参考图是 AI 生成的虚构角色也可能被判定。
  - **根因**：`data/vendor/imarouter.ts` 的 `videoRequest` 给参考图传 `asset://`（走 `/v1/assets/create` 预审核，官方推荐路径、更不容易触发这个拦截）还是退回 base64 直传（未经审核，更容易被拦），取决于 `isPublicUrl(item.url)` 的判断。而这个 `url` 本来来自 `u.oss.getFileUrl()`，这台机器 `NODE_ENV` 只有跑在 Electron 里才会变成 `"prod"`（`src/env.ts`），这个项目是普通网页部署不是 Electron 打包，`NODE_ENV` **永远是 `"dev"`**，`.env` 里又没配 `ossURL`，所以 `getFileUrl()` 永远返回 `http://localhost:10588/...`——而且光配 `ossURL` 还不够：`getFileUrl()` 是按顺序几个 `if` 判断，`NODE_ENV=="dev"` 那条判断写在 `ossURL` 判断**后面**，只要 `NODE_ENV` 还是 `"dev"`（正常开发一直是）就会无条件把 url 覆盖回 localhost，`ossURL` 配了也白配。真要让 `ossURL` 生效，还得让 `NODE_ENV` 不是 `"dev"`，但这样会连带跳过 `buildRoute()`/`initKnexType()` 这两个开发期自动生成路由/类型的便利，不适合日常开发长期这么跑。
  - **实际解法**：不再纠结 `ossURL`/`NODE_ENV` 这条路，新增 `src/agents/shared/publicImageUrl.ts` 的 `ensurePublicImageUrl()`——`u.oss.getFileUrl()` 不是公网地址时，直接把文件传到 GCP 项目 `novvy-dev` 下已经建好、`allUsers` 有 `objectViewer` 权限的公开桶 `novvy-seedance-public`（这个桶本来就是给这类场景用的，不是这个项目专属），换一个真实公网直链（`gcloud storage cp`，复用本机已登录的 `gcloud` CLI 身份，没有另外装 `@google-cloud/storage` SDK 或配 Application Default Credentials）。`videoGenAgent/index.ts` 的 `performStageBRender` 里，`videoModelKey` 以 `imarouter:` 开头（Seedance/Kling）时才调用这个函数，Veo 直接吃 base64 不需要 url，不用白跑一次上传。真实验证过（cut 76 相关的草案图）：上传成功、返回的公网直链真实可访问（HTTP 200，字节数和原图一致）。
  - **代价/注意**：这条路径要求部署环境也有 `gcloud` CLI 且已登录，换一台没登录过的机器会直接报错（不是静默失败）；传上去的图片在这个公开桶里任何人都能访问（`allUsers:objectViewer`），这是 ImaRouter/Kling 官方接口本来就要求"公网可访问"这个前提决定的。真要有了正式的公网 `ossURL` 部署，`ensurePublicImageUrl()` 会自动跳过 GCS 上传直接用那个地址，不需要再改代码。
- **Veo 的内容审核不只看画面，连 prompt 文字里的人名也可能被当成"疑似真人/明星"拦截**。真实报错例子：`"Sorry, we can't create videos with real people's names or likenesses. Please remove the celebrity reference and try again."`——排查确认是 `assembleStageBPrompt` 拼出来的 prompt 里直接带了 StoryboardAgent 分析出的角色名（比如"Lucien""Vera"这类虚构角色名），Veo 判定成疑似真实姓名/明星引用而拒绝，和参考图片本身是不是真人没关系。这和 Seedance 那条"只审画面"的隐私拦截是两种不同机制：Seedance 审的是 `content[1]`（图片），Veo 这次审的是 prompt 文本本身。同一条内容反复测试时命中率不是 100%（有时候同样带人名的 prompt 又能过），说明和 Seedance 一样是非确定性的审核，不是硬性关键词拉黑。**还没有修**——如果这个问题变得频繁，可以考虑的方向是 `assembleStageBPrompt` 组装时把具体角色名换成"男主角""女主角"这类通用代称，不直接把 StoryboardAgent 分析出的人名喂给视频生成模型。
- **Veo 3.1 会自动生成和画面同步的音效/配音，这条音频轨道也会被单独审核，和画面、prompt 人名审核是第三种不同的拦截机制**。真实报错例子（cut 74）：任务本身 `done:true` 跑完了，但最终响应里没有视频地址，只有 `raiMediaFilteredReasons`：`"We encountered an issue with the audio for your prompt, which means we could not create your video."`——`submitVideoAndPoll` 目前只检查 `video?.uri` 存不存在，取不到时统一报"视频生成任务已完成但未返回视频地址"，这类音频审核拦截也会落进这个分支，报错文案不够精确但不影响用户理解（错误信息里带了 Google 原始的 `raiMediaFilteredReasons`）。当次 cut 74 的分镜文案里写了"刀锋落下的破空声""清脆金属碰撞声"这类武器音效描述，猜测是触发点，但目前只有这一次样本，还没有像人名拦截那样反复验证出稳定复现的模式。**还没有修，先只记录**——用户明确要求暂时不改 prompt，等这类拦截变频繁、能确认稳定触发条件之后再考虑要不要在 `assembleStageBPrompt` 里避免明确要求武器碰撞类音效描述。
- **（已解决）Kling v3 Omni（ImaRouter 中转）参考图完全没有"没有公网地址就退回 base64"这条后备路径，本机 dev 环境选它生成图生视频一度必然报错**，和上面 Seedance 的问题是同一个根因（本机拿不到公网 url）但表现完全不同：Seedance 好歹能退回 base64 直传跑通（带隐私拦截风险），Kling 这条路由的 `image`/`image_list` 字段**真实验证过不接受 base64**——传了之后 ImaRouter 后端会拿这段 base64 字符串去 `wget` 下载，命令行参数长度直接把 `wget` 干爆，真实报错例子（cut 76）：`"视频生成失败: failed — wget download failed: fork/exec /usr/bin/wget: argument list too long"`，报错本身完全看不出是"没有公网地址"这个根因。`data/vendor/imarouter.ts` 的 `videoRequest` 里加了前置判断：Kling + 没有公网 url 的参考图时，直接抛出"只接受公网可访问的图片 URL，不支持 base64 直传"这类明确报错，不会再把注定失败的请求真的发出去——这条防御性检查即使有了下面的 GCS 兜底也留着，防止 `ensurePublicImageUrl()` 万一出问题时又退回一次会崩的 base64。**实际解法和上面 Seedance 那条一样**：`videoGenAgent/index.ts` 调用同一个 `ensurePublicImageUrl()`，自动传 GCS 换公网直链。真实调用验证过：用真实上传到 GCS 的公网 url 让 Kling 生成，成功产出一段真实 720×1280、约 10 秒的视频。

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
