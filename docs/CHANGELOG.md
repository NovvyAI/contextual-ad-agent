# 变更记录

M0-M6（原始 work-plan 的全部里程碑）完成之后，零散的修改意见和小改动记在这里，不再各自开一个里程碑文档。每条按时间倒序（最新的在最上面），格式：

```
## YYYY-MM-DD 标题

**用户意见 / 触发原因**：...
**改了什么**：...
**验证**：...
```

---

## 2026-07-29 把方案批准时的 narrative/tone 传给 VideoGenAgent/PlayableAgent/SupervisorAgent

**触发原因**：讨论"Episode→视频→游戏"要不要有一套共享的基调/context 时发现一个真实缺口——`shared/planContext.ts` 的 `loadPlanContext()` 只传 `episodeAnalysis`/`ad`，没有把这份方案自己被批准时的 `narrative`/`tone` 带上。用户在方案卡片上确认的具体创意方向，VideoGenAgent/PlayableAgent/SupervisorAgent 完全看不到，各自只能从 Episode 原始分析里重新猜一个基调，和实际批准的方案对不上。不是设计取舍，是漏传了。

**改了什么**：`PlanContext` 接口加 `narrative`/`tone` 两个字段，`loadPlanContext()` 从已经查出来的 `plan` 行里读取（顺带加了 `plan.narrative`/`plan.tone` 判空校验）。`videoGenAgent/prompt.ts`、`playableAgent/prompt.ts`、`supervisorAgent/prompt.ts` 的 `formatContext()` 都加上 `narrative`/`tone` 参数，在拼给模型的上下文最前面加一段"## 已批准的创意方向"；`buildStageADraftMessages`/`buildGenerateMessages`/`buildSupervisionMessages` 的指令文字也补一句"应该呼应上面已批准的创意方向"/"检查是否偏离了已批准的创意方向"。三个 agent 的 `index.ts` 对应的 `loadPlanContext()` 调用点都改成解构出 `narrative, tone` 再传下去。

**验证**：`npx tsc --noEmit -p .` clean。真实调用 `generateDraftCut`，靠现成的大模型调用日志直接看到实际发给模型的 prompt——"## 已批准的创意方向\n构思：...\n基调：..."正确出现在 Episode 结尾状态之前，确认数据真的传到了。这次调用因为上游服务临时抖动没有生成完，但和这次改动无关，不影响验证结论。

---

## 2026-07-26 聊天框也能触发"确认方案/生成内容/确认分镜草案/组装小游戏/确认内容"这五步

**用户意见**：确认方案现在只能点方案卡片上的按钮，在聊天框里说"我选方案1"不会有任何反应，希望按钮和聊天都能触发管线里每一步"下一步"动作。

**关键判断**：这个改动和之前讨论过、明确拒绝的"让 SessionAgent 自己判断要不要派发/要不要重新设计"不是一回事——不是让 LLM 去决定这些确定性动作要不要发生，只是让它多识别一种"用户已经用自然语言明确表达了这个意图"的说法，再委托给和按钮完全同一份、本来就有校验的确定性函数。状态机本身没有变化，只是多了一个触发入口。

**改了什么**：新增 `src/agents/sessionAgent/actions.ts`，把 `src/socket/routes/sessionAgent.ts` 里 `plan:approve`/`bridgeCut:generate`/`bridgeCut:confirm`/`bridgeCut:assemblePlayable`/`content:confirm` 五个 socket 事件处理器的编排逻辑（含 `generateCutContent` 这个按 cut 类型派发执行 Agent 的共用函数）抽成 5 个可复用的 action 函数，socket 层的处理器现在只是薄薄一层转发。`src/agents/sessionAgent/index.ts` 新增 5 个 tool（`run_confirm_plan`/`run_generate_content`/`run_confirm_draft_cuts`/`run_assemble_playable`/`run_confirm_content`），`execute()` 直接调用同一批 action 函数，返回给 LLM 的是一句通用 ack（真实结果照旧通过 resTool 推消息卡片，不依赖 LLM 复述）。`data/skills/session_agent_decision.md` 补充教 LLM 识别这五类"确认/下一步"意图，删掉了原来"结构化操作不会经过你""不要代替用户做确认方案决定"这两条现在已经不对的表述；`buildPlansContext()` 额外把 `episode.workflowStage` 加进注入给 LLM 的上下文，帮它判断当前阶段哪个动作有意义。`plan:generate`（选广告素材那步）保持纯按钮，没有加聊天入口——选哪些广告参与是多选操作，不适合塞进一句自由文字。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 均 clean。真实浏览器走了一遍：新建 Episode → 选广告生成方案 → 不点"确认这份方案"按钮，在聊天框输入"我选方案41"发送 → 页面顶部 `workflowStage` 从 `plan_review` 变成 `content_review`，ActionBar 正确切换成"生成内容"按钮；直接查库确认 `ab_creativePlan.status` 变成了 `approved`——和点按钮的效果完全一致。前端零改动（`plan:approve` 等事件名/payload 没变，只是服务端内部实现从内联逻辑换成调用共享函数）。

---

## 2026-07-26 revise 工具返回给 LLM 决策层的确认语带上评分/评审意见

**触发原因**：讨论 SessionAgent 的 `run_sub_agent_*` 工具要不要参照 Toonflow-app 的模式，让 LLM 决策层"读懂"子 agent 的完整输出再自己决定怎么回复用户。结论是不需要引入这种不确定性——SessionAgent 现在唯一要做的判断（自由文字对应哪个具体 plan/cut）已经很窄，让 LLM 去"理解"变长的返回内容没有真实收益，还会让同一次调用换个措辞就可能产生不同行为。真正想要的"回复更具体"这个效果，代码直接拼出来就够了，不需要 LLM 参与这一步。

**改了什么**：`src/agents/sessionAgent/index.ts` 三个 revise 工具（`run_sub_agent_director_plan_revise`/`run_sub_agent_bridge_video_revise`/`run_sub_agent_playable_revise`）的 `execute()` 返回值，从"已根据反馈修改方案 X，新的方案已推送给用户查看"这种不带具体信息的模板，改成把 `evaluatorFeedback.feedback`/`evaluation.overallScore`/`evaluation.feedback` 这些已经算出来的评审结果拼进去，比如"已根据反馈修改方案 X，评分 88，评审意见：...。新的方案已推送给用户查看。"——这段字符串本身还是会被 LLM 看到（作为 tool result 进它的对话上下文），但内容是代码拼好的确定值，不依赖 LLM 去解读评审对象的原始结构。

**验证**：`npx tsc --noEmit -p .` clean。

---

## 2026-07-26 统一的大模型调用输入输出日志

**用户意见**：每次项目调用大模型的时候，输入输出都要用 log 打印到 terminal 上；如果输入输出是非文本（图片/视频/音频），只需要简单概述一下内容，不用打印原始数据。

**改了什么**：排查发现现有的 `o_tasks` 表只有部分 Agent（VideoGenAgent/PlayableAgent/SupervisorAgent）主动传了 `taskRecord` 才会记一条，且只记任务元数据（分类/耗时/成功失败），不含完整输入输出；另有一个默认关闭的 AI SDK DevTools 开关，只覆盖文本类调用且是调试工具不是持久化日志。这次直接在统一的模型调用入口 `src/utils/ai.ts` 里加日志，覆盖全部四种调用（`AiText.invoke/invokeObject/stream`、`AiImage.run`、`AiVideo.run`、`AiAudio.run`），不依赖调用方是否传了 `taskRecord`。新增 `summarizeForLog()` 递归遍历请求/响应对象，把 Buffer/Uint8Array 和 base64 字符串（含 `data:image/png;base64,...` 这种带前缀的形式）替换成"[图片/视频/音频 base64 数据，约 N 字符]"这样的简短描述，根据 key 名称或 data URI 的 mediaType 判断是图片/视频/音频，其余字段（system/messages/prompt 等文本内容）原样打印。`invoke`/`invokeObject` 是同步的一次性调用，直接在调用前后各打一次日志；`stream` 比较特殊——用一个透传的 async generator 包一层 `fullStream`，边转发给调用方边累积文本，等流真正消费完（或提前中断）再打印一次完整输出，不影响原有的流式消费方式。

**验证**：`npx tsc --noEmit -p .` clean。真实调用验证了四种场景：① 纯文本 `invokeObject`，输入输出完整打印；② 消息里带 `Buffer` 类型图片（`analyzeAd`/`analyzeEpisode` 那种写法），正确摘要成"[二进制数据，约 9399 字节]"；③ `AiImage.run` 带 base64 参考图，输入摘要正确，但第一次验证发现输出的 `data:image/png;base64,...` 没有被摘要（正则没处理 data URI 前缀），修了 `looksLikeBase64` 之后重新验证，输出正确摘要成"[图片 base64 数据，约 1036442 字符]"；④ `stream` 流式调用，确认边打印输入、流真正消费完之后打印累积的完整输出文本，且不影响调用方拿到的实际文本内容。

**怎么看日志**：这些 `console.log` 直接打印到跑后端进程的 stdout，没有单独落盘到某张表或某个专门的日志文件。如果后端是自己在终端里直接跑 `yarn dev`，日志就直接显示在那个终端窗口里；如果是像本次这样用 `nohup yarn dev > /tmp/backend-dev.log 2>&1 &` 这种方式重定向到文件启动的，就用 `tail -f /tmp/backend-dev.log` 实时看。

---

## 2026-07-25 VideoGenAgent 分镜草案改成结构化字段 + 按 Stage 拆分两套 prompt 模板

**触发原因**：参考 Toonflow-app `data/modelPrompt/video/` 下的几份视频提示词模板研究"如何和用户交互生成视频"，发现它是按供应商/模型的参考图输入能力分成好几套模板——多参考图场景用 `@图N` 编号引用消歧，单参考图场景没有编号消歧的必要，用单段式散文表达。对照 VideoGenAgent 自己的两个 stage：Stage A（gpt-image-1 草案图）最多有 2 张参考图（Episode 结尾帧 + 广告参考图），天然需要消歧；Stage B（Seedance-2.0 成片渲染，`mode:["singleImage"]`）只有 1 张参考图（已确认的草案图本身），没有消歧问题。而 VideoGenAgent 原来的 `stageADraftSchema` 只有一个笼统的 `{prompt, framingNotes}`，两个 stage 共用同一段自由文本，没有体现这个结构性差异，讨论后决定现在就做这次重构（不算启动 M8，M8 里真正大头的真实截图提取、PlayableAgent 素材来源分支、SupervisorAgent 终审升级都还没动）。

**改了什么**：`src/agents/videoGenAgent/schema.ts` 的 `stageADraftSchema` 从 `{prompt, framingNotes}` 改成结构化字段：`shotSize`/`cameraMovement`（枚举，从固定选项里选，不再让模型自由发挥镜头语言）+ `subjectAction`/`lightingMood`/`emotionalTone`/`framingNotes`（自由文本，但职责更聚焦）。`src/agents/videoGenAgent/prompt.ts` 新增两个组装函数，替代原来"LLM 直接产出最终 prompt"的做法：`assembleStageAPrompt`（参考 Toonflow `universalMulti-parameterMode.md`，按实际存在的参考图数量动态编号 `@图1`/`@图2`，让模型明确知道每张参考图在画面里的角色）、`assembleStageBPrompt`（参考 Toonflow `wan2.6Single-imageFirstFrameMode.md`，单段式散文，不用编号）；两个函数都在景别/运镜后面附上标准英文镜头术语（如"近景（close-up）"），给生成模型一个更精确的锚点，但不整段翻译成英文——这个项目的中文 prompt 在 gpt-image-1/Seedance 上本来就跑得通，没必要改。`src/agents/videoGenAgent/index.ts`/`evaluator.ts` 相应改造：`renderDraftImage`/`renderStageB` 改用组装函数产出的 prompt 喂给模型，`DraftCutResult` 新增 `assembledPrompt` 字段；`evaluateDraft`/`evaluateRender` 的评估上下文改成拼接结构化字段。`src/socket/routes/sessionAgent.ts`/`src/agents/sessionAgent/index.ts` 里给 `storyboardCut` 卡片传 `prompt` 的地方从 `result.draft.prompt`（已不存在）改成 `result.assembledPrompt`。

**验证**：`npx tsc --noEmit -p .` 全程 clean。真实调用 `scripts/smoketest/videoGenAgent.ts` 验证 Stage A：`generateDraftCut`/`reviseDraftCut` 均成功，日志里 `assembledPrompt` 正确按实际找到的参考图数量编号（这次只找到广告参考图，正确编成唯一的 `@图1`，没有虚标不存在的 `@图2`），revise 反馈"画面再明亮一点，突出产品本身"后 `cameraMovement` 从"静止"变成"推进"、`lightingMood` 明显提亮，评估分从 57 升到 72，说明结构化字段确实在正确响应用户反馈。Stage B 验证：`confirmAllCuts` 这一步因为方案 4 底下有一条很早以前遗留的 `done` 状态旧 cut（和这次改动无关的历史脏数据）而报错，绕过后直接调用 `renderStageB` 单独验证——真实调用 Seedance 渲染出 6 秒成片，`videoUrl` 正常返回，终审评分合理（`narrativeContinuity` 94、`visualConsistency` 92）。

---

## 2026-07-25 业务表 id 迁移成 AUTOINCREMENT，修复删除后 id 复用导致的串号

**触发原因**：用户删除一个 Episode 后新建一个，进入会话发现里面显示的是旧 Episode 早就失败的 bridgeCut/creativePlan 数据，随后生成创意方案时还报了一次 `FOREIGN KEY constraint failed`。排查确认：`ab_episode` 等业务表的 `id` 只是普通 `integer` 主键，没有声明 `AUTOINCREMENT`——SQLite 对这种主键的默认行为是"删除后号码可以被回收"，新建的 Episode 恰好复用了刚删掉的旧 Episode 的 id，导致前端按 id 缓存的会话状态（Pinia store）和后端在某个时间窗口内对不上号。这是加了删除功能（M6 之后新增）才第一次暴露出来的问题，此前项目里从来没有删除过任何数据，id 从未被复用过。

**改了什么**：`ab_episode`/`ab_ad`/`ab_creativePlan`/`ab_bridgeCut`/`ab_generatedSegment`/`ab_manifest` 六张有删除功能牵连到的表，`id` 列全部从"`integer` + `primary`/`unique`"改成 `increments()`（即 `AUTOINCREMENT`）。`src/lib/initDB.ts` 改的是新装库的建表定义；`src/lib/fixDB.ts` 新增 `convertToAutoIncrement()` 辅助函数，对已有的活库做迁移——建一张同结构的临时表（关掉 `PRAGMA foreign_keys` 避免搬数据时报外键错）、把原表数据原样搬过去（显式指定 `id` 搬运，不是重新生成，所以所有已有的 id 值和外键引用完全不变）、删掉原表、把临时表改名回原名。用 `sqlite_master` 里的建表 SQL 判断表是否已经迁移过，保证这个函数每次启动调用都是幂等的，不会重复迁移。

**验证**：迁移前先手动备份了一份 `db2.sqlite`。跑迁移后核对了迁移前后六张表的行数完全一致（没有丢数据），抽查了几条 `ab_creativePlan`/`ab_episode` 的外键关联和具体字段内容，确认数据没有损坏；查 `sqlite_sequence` 表确认六张表的自增序号都正确初始化成了各自当前的最大 id。然后真实做了一次"删除 Episode → 新建 Episode"，确认新 Episode 拿到的是全新的 id（19），不是被删掉的那个 id（18）——问题复现场景验证通过。`npx tsc --noEmit` 通过。

---

## 2026-07-25 修复 bridgeCut:confirm 静默吞掉 Stage B 渲染失败

**触发原因**：用户反馈"已确认全部分镜草案，开始渲染成片"一直卡在"内容生成中..."。排查发现不是真的卡住——Seedance 已经真实失败了两次（各耗时 30~40 秒），报错是 `InputImageSensitiveContentDetected.PrivacyInformation`（判定分镜草案图"可能包含真人"，拒绝拿它做图生视频，供应商内容安全限制，不是服务故障）。但 `bridgeCut:confirm` 这个 socket 处理器和 M6 修复前的 `bridgeCut:generate` 犯了同一个错——`Promise.allSettled` 的结果从没被检查过，Stage B 失败后前端完全收不到任何消息，界面永远卡在"生成中"，用户既不知道失败了、也没法重试。

**改了什么**：`src/socket/routes/sessionAgent.ts`——① `bridgeCut:confirm` 现在检查 `allSettled` 结果，Stage B 失败会记日志并推 `error` 消息给用户；② `bridgeCut:retry` 增加判断：如果是 video 类型的 cut、且已经有确认过的分镜草案图（说明失败发生在 Stage B），重试时只重跑 `renderStageB`（成片渲染），不会重新走 Stage A 覆盖掉已确认的草案（原来的逻辑会不分青红皂白地调 `generateCutContent`，对 video 类型等于重新生成草案，需要用户重新确认一遍分镜，语义不对）。

**验证**：写了个临时 socket 脚本直接对真实卡住的 cut（id 18）触发 `bridgeCut:retry`，确认：只重跑了 Stage B（没有产生新的 Stage A 草案）；这次失败被正确推送成 `message:update {status:"error", ...}` 而不是静默消失。这条 cut 背后的图片本身会被 Seedance 稳定拒绝（不是瞬时抖动），所以重试预期还会失败，需要重新生成一版不同的分镜草案图才能绕过去——但这属于内容问题，不是这次要修的代码 bug。`npx tsc --noEmit`/`npx vue-tsc -b --force` 均通过。

---

## 2026-07-25 服务器本地文件路径加"选择本地文件"上传弹窗

**用户意见**：`/#/episodes` 和 `/#/ads` 页面的"服务器本地文件路径"输入框旁边加一个能从电脑本地选文件的弹窗功能。

**改了什么**：浏览器出于安全限制不会把 `<input type="file">` 选中文件的真实绝对路径暴露给页面 JS，所以做不到"选完直接读到服务器路径"——唯一可行的方式是真的把文件传上去。新增后端路由 `src/routes/upload/uploadFile.ts`（用 `multer` 处理 multipart 上传，落到 `data/uploads/` 下，文件名前缀时间戳防重名，返回一个可以直接填进 `sourceFilePath` 的相对路径）；新增依赖 `multer`/`@types/multer`；`data/uploads/` 加进 `.gitignore`（用户上传的文件不进仓库）。前端新增可复用组件 `frontend/src/components/common/LocalFilePicker.vue`（隐藏的 `<input type="file">` + "选择本地文件"按钮，选中后自动上传并把返回路径填回文本框），`EpisodeListView.vue`/`AdListView.vue` 都在路径输入框旁边加了这个组件。

**验证**：原生文件选择弹窗是浏览器标准行为，没有再单独验证；重点验证了上传接口本身——用 curl 真实上传一张图片，确认文件正确落到 `data/uploads/` 下（用 `file` 命令验证是合法图片、大小和原文件一致），再用返回的路径真实调 `createAd` 建了一条广告，验证全链路走得通，最后清理掉测试数据。`npx tsc --noEmit`/`npx vue-tsc -b --force` 均通过。

---

## 2026-07-25 Episode/广告列表加删除按钮

**用户意见**：`/#/episodes` 和 `/#/ads` 页面里每一项都要加一个删除按钮。

**改了什么**：新增 `src/routes/episode/deleteEpisode.ts` 和 `src/routes/ad/deleteAd.ts` 两个后端路由，级联删除关联的 `ab_creativePlan`/`ab_bridgeCut`/`ab_generatedSegment`/`ab_manifest`（只删数据库记录，不动 `sourceFilePath` 指向的原始文件——那是用户机器上的文件，不归这个 App 管）。前端 `EpisodeListView.vue`/`AdListView.vue` 各加一个"删除"按钮，用 `t-popconfirm` 包一层二次确认（"关联的创意方案/内容也会一起删除"），确认后调用删除接口并刷新列表。

**验证**：真实浏览器分别删除一条广告和一个 Episode，列表正确刷新掉对应行；直接查数据库确认级联删除生效（`ab_episode`/`ab_ad`/`ab_creativePlan` 相关行都清空了）。`npx tsc --noEmit`/`npx vue-tsc -b --force` 均通过。

---

## 2026-07-25 广告选择下拉框显示真实名称 + 悬浮显示完整摘要

**用户意见**：会话页"选择要参与创意方案的广告素材"下拉框里显示的名字应该是广告素材的名称，不是别的；光标移到某个选项上，要在旁边显示这条广告的完整内容摘要。

**改了什么**：排查发现下拉框显示的名字之前一直是 AI 分析结果里 `summary` 字段的前 20 个字（`getAdList` 只返回分析结果 `AdEntry`，没带 `ab_ad` 表自己的 `name` 字段），不是创建广告时填的名称。`src/routes/ad/getAdList.ts` 现在额外查出 `name` 字段拼进返回结果（`AdEntry` 本身形状不变，`directorAgent/index.ts` 走的是直接查 `ab_ad`，不消费这个接口，加字段不影响它）；`frontend/src/views/SessionView.vue` 的 `loadAds()` 改用 `a.name` 做下拉框标签，同时保留 `summary` 字段；`ActionBar.vue` 给每个 `t-option` 加 `:title="ad.summary"`，用浏览器原生 title 提示悬浮展示完整摘要。

**验证**：真实浏览器打开下拉框，选项名称变成真实广告名称（"Lumira Radiance Serum"/"Nova Brew Cold Brew Coffee"等，不再是截断的摘要句子）；用 JS 读取 DOM 确认每个选项的 `title` 属性都带着完整摘要文本。`npx tsc --noEmit`/`npx vue-tsc -b --force` 均通过。

---

## 2026-07-25 Episode 创建表单必填校验

**用户意见**：标题、服务器本地文件路径两个框都加个 `*` 表示必填；不填就点创建要给必填提示；路径填的文件不存在，点创建也要给提示。

**改了什么**：`frontend/src/views/EpisodeListView.vue` 的"新建 Episode"表单，两个输入框上方各加一行带红色 `*` 的标签；`handleCreate` 里把原来"两个都不填就静默不做事"改成明确的 `MessagePlugin.warning` 提示（区分"两个都没填"/"标题没填"/"路径没填"三种情况）。文件不存在的提示不用新增——后端 `createEpisode.ts` 本来就会返回 `文件不存在: ...`，前端 `catch` 块本来就会把这个 message 弹出来，之前只是没被注意到。

**验证**：真实浏览器操作三种场景——都不填、只填路径不填标题、填了标题但路径指向不存在的文件——分别弹出对应提示文案，没有一种是静默失败。`npx vue-tsc -b --force` 通过。

---

## 2026-07-25 会话页展示 Episode 剧情分析结果

**用户意见**：进入会话后希望能看到 Episode 的分析结果（之前分析完只存进数据库，界面上完全看不到）。

**改了什么**：`src/routes/episode/getSessionState.ts` 的 `episode` 字段里加上 `episodeAnalysis`（解析自 `ab_episode.episodeAnalysis` 这个 JSON 列）；前端新增 `frontend/src/components/session/EpisodeAnalysisPanel.vue`，默认折叠展示"剧情梗概/人物（主角/配角标签）/情绪曲线/结尾状态"，结尾是悬念钩子时额外显示一个"悬念结尾"标签；挂载到 `SessionView.vue` 的消息列表上方。`SessionState`/`EpisodeAnalysis` 类型同步加进 `frontend/src/stores/sessionAgent.ts`。

**验证**：真实浏览器打开 M6 的 Episode 16 会话页，展开面板，剧情梗概/人物/情绪曲线/结尾状态全部正确渲染出真实分析内容，"悬念结尾"标签正确显示。`npx tsc --noEmit`/`npx vue-tsc -b --force` 均通过。

---

## 2026-07-25 Episode/广告列表页"开始分析"后自动刷新状态

**用户意见**：点击"开始分析"后希望页面能自动刷新，不用手动刷新才能看到分析结果。

**改了什么**：`frontend/src/views/EpisodeListView.vue` 和 `AdListView.vue` 的 `handleAnalyze` 触发分析后，先立即刷新一次列表，再起一个 3 秒间隔的轮询，直到列表里没有 `analyzing` 状态的行为止自动停止；页面挂载时如果已经有正在分析的行也会自动接上轮询；组件卸载时清理定时器。

**验证**：真实浏览器里新建一条广告素材（复用 M6 的 `m6-ad-skincare.jpg`）触发分析，全程没有手动刷新页面，状态从 `uploaded` → `analyzing` → `analyzed` 自动更新。`npx vue-tsc -b --force` 类型检查通过。
