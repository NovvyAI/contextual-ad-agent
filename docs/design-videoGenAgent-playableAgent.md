# VideoGenAgent / PlayableAgent 详细设计：用户交互 / LLM 调用 / 数据交换

这是 M7 固定两段式管线里紧挨着的两个执行 Agent——VideoGenAgent 产出 cut#1（过渡视频），PlayableAgent 产出 cut#2（H5 配对小游戏，内嵌 cut#1 的成片）。本文档覆盖 M8（真实截图/参考帧重定向/终审视觉升级）之后的当前设计，不是历史演变记录，读这份就够，不用去猜之前的版本。

## 0. 两者在整条管线里的位置

```
DirectorAgent 产出并批准一份 ab_creativePlan（narrative/tone/adId）
        │
        ├─ createBridgeCuts() 硬编码建两行 ab_bridgeCut：index0=video，index1=playableGame
        │
        ▼
  ┌─────────────────┐        ┌──────────────────┐
  │  VideoGenAgent   │──成片──▶│  PlayableAgent    │
  │  （cut#1 video） │        │ （cut#2 playableGame）│
  └─────────────────┘        └──────────────────┘
        │                            │
        ▼                            ▼
   ab_generatedSegment         ab_generatedSegment
   （draftImage/finalRender）  （finalRender = 整个游戏包目录）
                                     │
                                     ▼
                              SupervisorAgent 终审 → Assembler 落地 ab_manifest
```

两者都不是自己决定"什么时候跑"——由 SessionAgent 的确定性 action 函数（`src/agents/sessionAgent/actions.ts`）在用户明确表达意图后调用，用户表达意图的方式有两种，效果完全等价：点界面按钮，或者在聊天框里说一句能被识别的话（如"生成吧""确认分镜""组装小游戏"）。

---

## 一、VideoGenAgent

### 1.1 职责与产出物

分两个 Stage，产出同一个 `ab_bridgeCut` 行的两个阶段性状态：

- **Stage A**：构思一份结构化的分镜草案（`StageADraft`），并用 gpt-image-1 渲染出一张静态草案图，供用户确认。
- **Stage B**：草案确认后，用 Seedance（图生视频）把草案图渲染成一段 6 秒的过渡成片。

### 1.2 用户交互流程

| 用户动作 | 按钮触发 | 聊天触发（等价） | 对应函数 |
|---|---|---|---|
| 开始生成内容 | "生成内容" | "开始生成内容""生成吧" → `run_generate_content` | `generateDraftCut(bridgeCutId)` |
| 确认分镜草案，渲染成片 | "确认分镜草案，开始渲染成片" | "草案可以，渲染成片吧""确认分镜" → `run_confirm_draft_cuts` | `confirmAllCuts(creativePlanId)` 通过后接着调 `renderStageB(bridgeCutId)` |
| 对草案提修改意见（画面内容问题） | 无专属按钮，走聊天框 | 反馈涉及画面内容（如"头发乱了""场景不对"）→ `run_sub_agent_bridge_video_revise` | `reviseDraftCut(bridgeCutId, feedback)` |
| 对成片提修改意见（运镜/节奏问题） | 无专属按钮，走聊天框 | 仅当 cut 已渲染出成片（status=done）且反馈明确是运镜/节奏问题（如"运镜太快了"）→ `run_sub_agent_bridge_video_revise_motion` | `reviseStageBMotion(bridgeCutId, feedback)` |

**revise 走哪条路径不是 LLM 猜的**——`data/skills/session_agent_decision.md` 明确教 SessionAgent：反馈模糊、看不出是画面内容问题还是运镜/节奏问题时，直接用文字问用户"是画面内容需要重新设计，还是只是运镜/节奏需要调整"，等用户明确回答后再调用对应工具。这是本项目一贯的原则——确定性分支不该由 LLM 隐式决定，该问就问。

失败重试（`bridgeCut:retry`，仅按钮）：如果草案图已确认过（`ab_generatedSegment` 有已选定的 `draftImage`），只重试 Stage B，不会推翻已确认的草案重新走一遍 Stage A。

### 1.3 LLM / 模型调用清单

| 步骤 | 模型 | 调用方式 | System Prompt | 输入 messages 构造函数 | 输出 Schema |
|---|---|---|---|---|---|
| Stage A 分镜文案 | `anthropic:claude-opus-4-8` | `invokeObject` | `data/skills/video_gen_agent.md` | `buildStageADraftMessages(episodeAnalysis, ad, narrative, tone)` | `stageADraftSchema` |
| Stage A 分镜预筛评分 | 同上（`evaluator.ts` 内部） | `invokeObject` | 评估专用 system prompt | 拼接结构化字段文本 | `bridgeVideoEvaluationSchema` |
| Stage A 草案图渲染 | `openai:gpt-image-1` | `Ai.Image.run` | — | `assembleStageAPrompt(draft, hasEpisodeFrame, hasAdFrame)`，参考图按 `@图N` 编号（最多2张：Episode结尾帧、广告参考帧） | 图片 |
| Stage A revise 文案 | `anthropic:claude-opus-4-8` | `invokeObject` | 同 Stage A | `buildReviseMessages(..., existing, feedback)`，**全部 6 个字段**都可能被重新给出 | `stageADraftSchema` |
| 运镜专用 revise 文案 | `anthropic:claude-opus-4-8` | `invokeObject` | 同 Stage A | `buildMotionReviseMessages(..., existing, feedback)`，指令明确要求只重新考虑 `cameraMovement`/`emotionalTone`，其余字段原样返回 | `stageADraftSchema`（但代码层再强制锁定 `shotSize`/`subjectAction`/`lightingMood`/`framingNotes` 为原值，双重保险） |
| Stage B 成片渲染 | `imarouter:seedance-2.0` | `Ai.Video.run` | — | `assembleStageBPrompt(draft)`（单段散文，不编号——Seedance `singleImage` 模式只有 1 张参考图，不存在多图消歧），`referenceList=[草案图 base64]`，`mode:["singleImage"]`，`duration:6` | 视频 |
| Stage B 成片预筛评分 | `anthropic:claude-opus-4-8`（`evaluator.ts`） | `invokeObject` | 同评估 prompt | 拼接结构化字段 + 时长 | `bridgeVideoEvaluationSchema` |

`StageADraft` 的 6 个字段：`shotSize`（景别，枚举）、`cameraMovement`（运镜，枚举）、`subjectAction`（主体动作/过渡呈现，自由文本）、`lightingMood`（光影氛围）、`emotionalTone`（情绪基调）、`framingNotes`（构图补充说明）。景别/运镜附中英文对照表（如"推进→dolly in / push in"）给生成模型一个标准化锚点，不完全交给模型自由发挥镜头语言。

### 1.4 数据交换

**输入（读）**：

- `loadPlanContext(creativePlanId)`（`src/agents/shared/planContext.ts`，VideoGenAgent/PlayableAgent/SupervisorAgent 共用）——查 `ab_creativePlan` 拿 `narrative`/`tone`（方案批准时的具体创意方向，不是 Episode/广告的原始分析），再关联查出 `episodeAnalysis`（`JSON.parse(ab_episode.episodeAnalysis)`）和 `ad`（`JSON.parse(ab_ad.analysisResult)`，类型 `AdEntry`）。
- 参考图（本地文件系统，非 OSS）：
  - Episode 结尾帧：`data/episode/<episodeId>/frames/frame_last.jpg`（或 `frame_near_end.jpg`），StoryboardAgent 早前抽好。
  - 广告参考帧：图片类广告直接用 `ab_ad.sourceFilePath`；视频类广告优先取 `ad.tileCandidates[0]`（M8 新增，AdLibraryAgent 已经用视觉判断挑出的代表性帧，文件不存在才回退到 `data/ad/<adId>/frames/` 里按文件名排序取第一张）。
- revise 时额外读 `JSON.parse(cut.scriptText)` 作为"当前草案"喂给模型对照修改。
- Stage B 渲染时读 `ab_generatedSegment` 里 `stage="draftImage" AND isSelected=1` 的那一行，通过 `u.oss.getFile()` 取出草案图字节转 base64。

**输出（写）**：

- `ab_bridgeCut.scriptText` = `JSON.stringify(StageADraft)`——每次生成/revise 都整行覆盖（不保留旧版本，本体本身没有版本历史，历史另见下面 `ab_reviseHistory`）。
- `ab_bridgeCut.prompt` = Stage A 实际拼给 gpt-image-1 的完整 prompt 文本（供 SupervisorAgent 终审时复用展示，不是给用户看的）。
- `ab_bridgeCut.status` 状态机：`pending → draft`（Stage A 完成）`→ draftConfirmed`（用户确认全部 video cut）`→ rendering → done`（Stage B 完成）；任一步异常 `→ failed`。运镜专用 revise 是 `done → rendering → done`，**不经过 `draft`**，不需要用户重新确认分镜。
- `ab_generatedSegment`：`stage="draftImage"` 和 `stage="finalRender"` 各自独立做版本管理——每次新生成，旧的同 stage 行 `isSelected` 置 0，插入新行 `isSelected=1`（旧文件本身不删除，理论可追溯，只是没有专门的"查看历史版本"UI）。
- `ab_reviseHistory`（新增于 M8 之前的一次改动，见 `docs/CHANGELOG.md` 2026-07-29）：`reviseDraftCut`/`reviseStageBMotion` 每次都会写一条 `{targetType:"bridgeCutDraft"|"bridgeCutMotion", targetId:bridgeCutId, feedback, beforeState, afterState}`，`beforeState`/`afterState` 就是 revise 前后的 `StageADraft` 对象，留给以后做训练数据用。

**跨 Agent 数据依赖**：

- 上游依赖：AdLibraryAgent 的 `ad.tileCandidates`/`ad.game`，StoryboardAgent 的 `episodeAnalysis`（含 `endingState`/`viewerEmotionalState`）和 Episode 帧文件，DirectorAgent 批准方案时定下的 `narrative`/`tone`。
- 下游消费：PlayableAgent 组装游戏包时直接读同一 `creativePlanId` 下 video cut 的 `finalRender` 段（`u.oss.getFile()` 整份拷进游戏包当 `bridge.mp4`）；SupervisorAgent 终审 video cut 时复用 Stage A 的草案图（不为了终审重新抽帧/重新渲染）。

---

## 二、PlayableAgent

### 2.1 职责与产出物

产出一个完整的、可独立打开的 H5 静态包（`bridgeCut/<id>/playable/` 目录），包含：外层 `index.html`（品牌容器，负责"先放 `bridge.mp4` 过渡视频，播完/超时后展示游戏或 CTA"）+ `game/index.html`（真正的配对小游戏）+ `game/assets/tiles/`（配对素材图）。

### 2.2 用户交互流程

| 用户动作 | 按钮触发 | 聊天触发（等价） | 对应函数 |
|---|---|---|---|
| 确认组装小游戏（video 成片渲染完之后的手动确认点，M7 定的，不自动直通） | "确认组装小游戏" | "组装小游戏""继续吧" → `run_assemble_playable` | `assemblePlayable(bridgeCutId)` |
| 对小游戏内容提修改意见 | 无专属按钮，走聊天框 | 用户针对这个具体 cut 提出修改意见 → `run_sub_agent_playable_revise` | `revisePlayable(bridgeCutId, feedback)` |

组装小游戏这一步之所以需要用户手动点一下而不是 video 渲完自动往下跑，是 M7 里明确定下的产品决策——让用户先看到过渡视频的效果，主动确认后才继续，不是无感知地自动生成下一段内容。

组装/revise 完成后都会推一张 `contentCandidate` 卡片（含预览 URL、评审分数、评审意见）给用户，用户下一步是"确认内容，进入终审与落地"（`run_confirm_content`），触发 SupervisorAgent + Assembler。

### 2.3 LLM / 模型调用清单

| 步骤 | 模型 | 调用方式 | System Prompt | 输入 messages 构造函数 | 输出 Schema |
|---|---|---|---|---|---|
| 生成游戏配置 | `anthropic:claude-opus-4-8` | `invokeObject` | `data/skills/playable_agent.md` | `buildGenerateMessages(episodeAnalysis, ad, narrative, tone)` | `playableConfigSchema` |
| 配置预筛评分 | 同上（`evaluator.ts`） | `invokeObject` | 评估专用 system prompt | 拼接 `title`/`ctaUrl`/`tilePrompts` 文本 | `playableEvaluationSchema` |
| 配对素材图生成（**仅在没有足够真实截图时才会被调用**） | `openai:gpt-image-1` | `Ai.Image.run` | — | `config.tilePrompts[i]`（LLM 写的独立 prompt，2-6 条） | 图片（每条 prompt 一张） |
| revise 游戏配置 | `anthropic:claude-opus-4-8` | `invokeObject` | 同生成 | `buildReviseMessages(..., existing, feedback)` | `playableConfigSchema` |

`PlayableConfig` 只有三个字段：`title`（标题，也是结束卡标题）、`ctaUrl`（跳转链接）、`tilePrompts`（2-6 条配对素材图片生成提示词）。**这三个字段永远由 LLM 产出，不因为有没有真实截图而改变**——即使最终用了真实截图，`tilePrompts` 依然会被生成、只是被闲置不用，这是为了不给"生成配置"这次调用引入"是否有真实素材"的条件分支，保持简单。

### 2.4 数据交换

**输入（读）**：

- 同样通过 `loadPlanContext(creativePlanId)` 拿 `episodeId`/`adId`/`episodeAnalysis`/`ad`/`narrative`/`tone`。
- revise 时读 `JSON.parse(cut.scriptText)` 作为"当前配置"喂给模型对照修改。
- **配对素材的两条来源分支**（`assemble()` 内部，M8 新增判断）：
  1. **真实截图分支**（优先，需要 `ad.tileCandidates.length >= 2`）：从 `data/ad/<adId>/frames/<filename>` 逐个读本地文件字节，直接 `u.oss.writeFile()` 拷进 `<relDir>/game/assets/tiles/tile_src_<i>.jpg`。
  2. **AI 生成回退分支**（真实素材不存在或不够 2 张才触发）：遍历 `config.tilePrompts` 逐条调 `gpt-image-1`，存成 `tile_src_<i>.png`。
  - **两条分支唯一的可观察区别是文件扩展名**（`.jpg` = 真实截图，`.png` = AI 生成），这也是验证时判断走了哪条分支的依据。
  - 无论走哪条分支，产出的 `tileUrls[]` 都会被循环填充到固定 `DEFAULT_PAIRS=8` 格（`tileUrls[i % tileUrls.length]`），`game.html` 内部再把这 8 张图各复制一份、洗牌，拼成 16 张卡片的 4x4 配对棋盘。
- 组装 `bridge.mp4` 时，查同一 `creativePlanId` 下 `type="video"` 的 cut，取它 `finalRender` 段（`isSelected=1`）的文件，`u.oss.getFile()` 读出整段视频字节直接写进游戏包。

**输出（写）**：

- 三个静态文件全部写进 OSS（`u.oss.writeFile`），走的是"模板 + `/*INJECT*/{}/*END*/` 占位符替换成 `JSON.stringify(配置对象)`"这套注入机制（`inject()` 函数）：
  - `game/index.html` 注入 `{ title, tiles: manifestTiles（8张URL）, sounds: {} }`。
  - 外层 `index.html` 注入 `{ title, cta_url, app_icon: null, external_game: false, has_video, fallback_cta_after_s: 30 }`。
- `ab_bridgeCut.scriptText` = `JSON.stringify(config)`（`PlayableConfig`，覆盖式，不保留旧版本）。
- `ab_bridgeCut.status`：`pending → generating → done`（组装过程中先标 `generating`，写完文件才标 `done`）；异常 `→ failed`。
- `ab_generatedSegment`：只有一个 `stage="finalRender"` 段（没有像 video cut 那样的 draft 中间态），`filePath` 存的是整个 `<relDir>` 目录路径（不是单个文件），后续 Assembler/SupervisorAgent 都是在这个目录路径基础上拼具体子路径。
- `ab_reviseHistory`：`revisePlayable` 每次写一条 `{targetType:"playable", targetId:bridgeCutId, feedback, beforeState:旧config, afterState:新config}`。

**跨 Agent 数据依赖**：

- 上游依赖：AdLibraryAgent 的 `ad.tileCandidates`（M8 新增，真实素材来源）、VideoGenAgent 的 video cut `finalRender` 产物（`bridge.mp4` 来源）、DirectorAgent 批准方案的 `narrative`/`tone`。
- 下游消费：SupervisorAgent 终审时，`codePreCheck` 检查这个目录下 `index.html`/`game/index.html`/`game/assets/tiles/tile_src_*` 是否存在（M8 加强，此前只查最外层 `index.html`）；`runSupervisionForCut` 会找到第一张 `tile_src_*` 文件挂进终审的 LLM 消息，让终审真的能看一眼配对素材长什么样（M8 新增，此前 playableGame 的终审是纯文字）。Assembler 落地时只关心这个目录路径本身，不关心里面用的是真实截图还是 AI 生成。

---

## 三、两者共有的设计原则（贯穿全文的几条约定）

1. **`narrative`/`tone` 永远来自"这份方案被批准时的具体创意方向"，不是重新去读 Episode/广告的原始分析**——`loadPlanContext` 统一保证这一点，两个 Agent 的所有 prompt 组装函数第一段都是"## 已批准的创意方向"。
2. **prompt 永远现查现拼，DB 里从不存"prompt 字符串"这种东西**——`ab_bridgeCut.prompt` 存的是 Stage A 实际发给图片模型的最终文本（供终审复用/debug），不是"下次调用要用的模板"；每次调用都重新调 `buildXxxMessages()` 现场拼装。
3. **revise 是"整行覆盖"而不是"追加新版本"**——`ab_bridgeCut.scriptText` 本体没有版本历史；`ab_generatedSegment`（实际生成的图片/视频/游戏包）走的是"插入新行 + 旧行 `isSelected=0`"的版本化写法，理论上可追溯；`ab_reviseHistory` 单独记录每次 revise 的完整前后状态 + 用户原始反馈，是三者里唯一系统性保留"改前/改后/为什么改"这个完整三元组的地方。
4. **确定性分支不该由 LLM 隐式决定**——revise 走哪条路径、要不要触发下一步，含糊时都是"直接问用户"，不是让 SessionAgent 自己猜。这条原则在 M7 讨论"要不要让 SessionAgent 做开放式分支决策"时被明确立下，此后一直遵守。
5. **评估分数只做预筛参考，真正拦截权在 SupervisorAgent**——`evaluateDraft`/`evaluateRender`/`evaluatePlayable` 都不会阻止流程继续，纯粹是给用户看的参考分；只有 SupervisorAgent 终审的 `passed:false` 才会真正拦下内容不让落地。
