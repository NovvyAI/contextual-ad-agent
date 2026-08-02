# 变更记录

M0-M6（原始 work-plan 的全部里程碑）完成之后，零散的修改意见和小改动记在这里，不再各自开一个里程碑文档。每条按时间倒序（最新的在最上面），格式：

```
## YYYY-MM-DD 标题

**用户意见 / 触发原因**：...
**改了什么**：...
**验证**：...
```

---

## 2026-08-02 视频生成模型新增 Veo 3.1 可选项，和图片模型一样支持用户选择

**用户意见 / 触发原因**：Seedance（通过 ImaRouter 中转）反复撞上"疑似真实人物"隐私拦截和网关超时问题，用户问 Google 有没有视频生成模型可以做备选。查了 Veo 3.1（Gemini API 官方直连）的技术细节后，用户明确要求照着图片模型选择的模式，把视频生成模型也做成用户可选——Seedance 和 Veo 3.1（固定8秒）二选一。

**改了什么**：
- 新增 `src/agents/shared/videoModel.ts`（结构上完全照抄 `imageModel.ts`）：`VIDEO_MODEL_OPTIONS`（`imarouter:seedance-2.0` / `google:veo-3.1-generate-preview`）+ `resolveVideoModelKey(creativePlanId)`，老数据/没选过的方案回退系统默认（Seedance）。
- `ab_creativePlan` 新增 `videoModelKey` 列（`fixDB.ts`/`initDB.ts`），和 `imageModelKey` 并列。
- `data/vendor/google.ts` 新增真正的 Veo 3.1 视频生成实现（原来 `videoRequest` 只是个空字符串占位）：`predictLongRunning` 提交任务 → 轮询 `GET {baseUrl}/{operation.name}` 直到 `done:true` → 从 `response.generateVideoResponse.generatedSamples[0].video.uri` 拿下载地址 → **就地authenticated 下载转 base64 返回**（这一步下载地址本身也需要 `x-goog-api-key`，不是公开直链，不能让上层 `AiVideo.run()` 的自动 `urlToBase64` 无鉴权下载，会 401）。图生视频（我们唯一会用的模式）官方强制固定 8 秒，不管调用方传入的 `durationS` 是多少，如实按 8 秒提交。
- `videoGenAgent/index.ts` 的 `performStageBRender` 去掉硬编码的 `VIDEO_MODEL_KEY` 常量，改成调 `resolveVideoModelKey(creativePlanId)`；`renderStageB`/`reviseStageBMotion` 都走这个共用函数，自动生效。
- `generateContentAction`/`bridgeCut:generate` socket 事件加 `videoModelKey` 参数，和 `imageModelKey` 一起落到方案上。
- `ActionBar.vue`"生成内容"按钮旁在图片模型下拉框之后再加一个视频模型下拉框（默认 Seedance），选定后传给后端。

**踩的坑**：Veo 的 `predictLongRunning` 是 Vertex 风格的 predict 接口，第一次照搬 `imageRequest`（`generateContent` 接口）里的 `inlineData` 字段传参考图，报错"`inlineData` isn't supported by this model"——查证后确认 predict 风格接口的图片字段是 `bytesBase64Encoded` + `mimeType`，不是 `inlineData`，两套接口字段名不通用。改完之后又报"`durationSeconds` needs to be a number"——官方文档给的 REST 示例里这个字段是字符串 `"8"`，实际接口要的是 JSON 数字 `8`，文档示例和真实接口对不上，以真实报错为准。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 均 clean。真实调用 `u.Ai.Video('google:veo-3.1-generate-preview').run(...)`，用项目自带的 SMPTE 测试图案（`data/test-assets/sample-ad-image.jpg`）当参考图，完整走完提交→轮询→鉴权下载全流程，`ffprobe` 确认产物是合法 MP4（h264+aac，1080×1920，时长精确 8.0 秒），抽帧确认画面是真实生成的动态内容（不是损坏文件）。另外单独验证了 `resolveVideoModelKey` 对老数据（没有 `videoModelKey` 的已有方案）正确回退到 Seedance，不影响现有行为。验证完清理了测试产物文件。

---

## 2026-08-01 新增 README.md，写清楚本地运行前需要装什么

**用户意见 / 触发原因**：用户问运行这个服务本地需要先装什么软件，要求写进 README。项目之前没有 README，环境要求只零散记在 `CLAUDE.md`（本机环境注意事项）里，没有一份面向"第一次在新机器上跑起来"的清单。

**改了什么**：新增根目录 `README.md`——列出本地依赖（Node >=20、Yarn、ffmpeg/ffprobe 系统命令、真实安装的 Google Chrome 供"自定义玩法生成"的自动化冒烟测试用，macOS 上原生依赖编译失败时需要 Xcode Command Line Tools），以及从 `yarn install`（后端+前端分别装）→ `cp .env.example .env` 填密钥 → 启动（`./start_server.sh` 或手动分两个终端跑）→ 默认账号登录（`admin`/`admin123`）的完整快速开始步骤，最后带上类型检查/生产构建等常用命令。

**验证**：按文档里的步骤在当前环境实际走了一遍（`yarn install`、`.env` 配置、`./start_server.sh` 启动、浏览器访问登录），确认每一步的命令和默认值（端口/账号密码）都和真实行为一致。

---

## 2026-08-01 新增 start_server.sh，一次性启动前后端

**用户意见 / 触发原因**：用户要求写一个脚本同时启动前端和后端，不用每次分别开两个终端手动跑 `yarn dev`。

**改了什么**：新增项目根目录下的 `start_server.sh`——用脚本自身所在路径定位项目根目录（不依赖调用时的当前目录），先 `pkill` 掉可能残留的旧 `tsx src/app.ts`/`frontend/vite` 进程再启动，避免端口被占用导致启动失败（这是这次会话里反复遇到的真实问题）；后端/前端分别启动，日志写到根目录的 `backend.log`/`frontend.log`，可以 `tail -f` 看；`trap` 挂了 EXIT 清理逻辑，Ctrl+C 或脚本退出时把两个子进程一起停掉。

**踩的坑**：第一版只对启动时记下的两个子进程 PID 调 `kill`，实测发现前端那个残留了一个孤儿 `vite` 进程没被杀掉——因为 `yarn dev` 包了一层，不一定把收到的信号转发给它拉起的实际 `vite` 进程。改成 `kill` 完 PID 之后再按命令特征 `pkill -f` 兜底杀一遍（和启动前的清理用的是同一个特征串）。另外 `trap cleanup EXIT INT TERM` 会导致同一次退出触发两次 cleanup（INT/TERM 触发一次，进程退出时 EXIT 又触发一次），改成 INT/TERM 只负责 `exit`，实际清理逻辑只挂在 EXIT 上，只会跑一次。

**验证**：`bash -n start_server.sh` 语法检查通过。真实启动后用 `curl` 确认后端 `:10588`、前端 `:5173` 都能访问（200）；发 `SIGTERM` 给脚本进程，确认"正在停止服务..."只打印一次，且两个真实的 `tsx`/`vite` 进程都被清理干净，`ps aux` 里查不到残留。

---

## 2026-07-31 互动游戏预览框改成竖屏比例，不再把画面压扁

**用户意见 / 触发原因**：用户反馈聊天里互动游戏生成后弹出的预览框感觉游戏画面比较小，希望能调整预览框大小来改善游戏画面的显示效果。排查发现 `ContentCandidateCard.vue` 的预览 `iframe` 是 480×320（偏横向、矮的一个框），但小游戏本身从代码生成阶段就是按"手机竖屏 H5"设计的（约 375px 宽的竖屏版式）——横向矮框硬装一个竖屏页面，画面被压缩挤在一个小范围里，才是画面显得小的真正原因，不是简单调大整体尺寸就够。

**改了什么**：`frontend/src/components/chat/content/ContentCandidateCard.vue`——卡片 `max-width` 从 480px 调到 420px，预览 `iframe` 的 `height` 从 320px 提到 700px，让整体框贴近手机竖屏比例，游戏内容能完整、按比例地占满预览区域，不再被压扁。

**验证**：`npx vue-tsc -b --force` clean。用真实的自定义游戏包（cut 57，"剑落之前"找不同游戏）在浏览器里搭了一个和新样式完全一致的独立测试页面验证（因为聊天消息历史不跨页面刷新持久化，没法直接在原会话里重现旧卡片）：新尺寸下片头视频、Skip 按钮、游戏正式画面（顶部状态栏+倒计时+上下两张对比图+音效按钮）都完整清晰地显示在预览框内，不再有画面被压缩或大片空白的问题。验证完清理了临时测试文件。

---

## 2026-07-31 新建创意素材支持勾选多种形式（图片/视频/纯文字可以同时选）

**用户意见 / 触发原因**：用户要求新建创意素材时不再是图片/视频/纯文字三选一，而是可以三选多甚至三选三。排查了一下 `adType` 在系统里的实际用法——`AdLibraryAgent` 分析、`VideoGenAgent` 挑参考图都是按这一个字段做互斥分支的硬编码逻辑（要么是文件要么是文案，不能共存），真要让**一条记录同时具备**多种内容形式，需要改数据库结构、分析管线分支逻辑、参考图选取逻辑，改动面很大。和用户确认后采用了成本小得多的方案：勾选多种形式时，提交后端按每种形式各建一条**独立**的 `ab_ad` 记录，不改动现有的单一类型分析管线；用户接着问"拆开之后生成方案那一步还能不能一起选" —— 确认了 `ActionBar.vue` 的素材选择本来就是多选（`selectedAdIds` 数组），`generatePlans(episodeId, adIds[])` 也本来就支持一次传多个 id，所以拆开完全不损失"综合利用"的能力。用户进一步要求拆出来的这几条素材名称之间要有相关性，方便看出是同一次提交拆出来的。

**改了什么**：`AdListView.vue` 的"新建创意素材"表单——`t-select` 单选下拉换成 `t-checkbox-group` 三个复选框（图片/视频/纯文字，可以同时勾）；原来共用的 `newSourceFilePath` 拆成 `newImageFilePath`/`newVideoFilePath` 两个独立字段（因为图片和视频现在可能同时需要各自的文件路径），选中哪种形式就显示对应的输入框（图片/视频文件路径 + 选择本地文件，或者文案 textarea）。提交时按 `newAdTypes` 数组循环调用现有的 `POST /api/ad/createAd`（后端接口完全没改），勾了多种形式时每条的 `name` 自动加上形式后缀（如"XXX（图片）"/"XXX（视频）"/"XXX（纯文字）"），只勾一种时名称不加后缀（兼容原来的单选体验）；提交前会校验每种选中形式对应的内容字段都填了，避免建到一半报错、前面已经建好的记录和后面没建的记录混在一起。

顺带把创意素材创建/编辑表单里"纯文字"内容输入框的 placeholder 从"广告文案"改成"创意形式"（用户直接指定的文案）。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 均 clean。浏览器实测：勾选图片+视频+纯文字三种形式，分别填入真实的测试图片/视频路径（`data/test-assets/`）和一段文案，提交后正确生成 3 条独立记录——"多形式测试（图片）"/"多形式测试（视频）"/"多形式测试（纯文字）"，`adType` 分别是 image/video/text，状态都是 `uploaded`；只勾一种形式时名称不受影响，行为和改动前一致。验证完删除了这 3 条测试记录。

---

## 2026-07-31 创意素材列表新增编辑功能

**用户意见 / 触发原因**：用户要求给创意素材列表加一个编辑功能，可以对已经存在的创意素材进行编辑（此前只能创建/删除，改错了名字或文案只能删了重建）。

**改了什么**：新增 `POST /api/ad/updateAd`（`src/routes/ad/updateAd.ts`，路由由 `src/core.ts` 扫描 `src/routes/` 自动生成注册，不用手动改 `router.ts`），可改 `name`/`brandName`，以及按 `adType` 对应的内容字段（`text` 类型改 `textContent`，`video`/`image` 改 `sourceFilePath`，改后校验文件存在性，和 `createAd.ts` 一致）；**不允许改 `adType`**——三种类型的字段/校验/后续分析逻辑完全不同，改类型等于换一条新素材，让用户删了重建更干净。内容本身（`textContent`/`sourceFilePath`）真的变了才把 `status` 重置为 `uploaded` 并清空 `analysisResult`/`errorReason`——旧的分析结果是基于旧内容算出来的，内容换了不重置的话界面还显示"analyzed"但实际内容已经对不上；只改名称/品牌名不动分析结果。`getAdListAll` 顺带把 `sourceFilePath`/`textContent` 也带上，供编辑弹窗回填表单。前端 `AdListView.vue` 每行加"编辑"按钮，弹窗按 `adType` 展示对应的内容输入（文案 textarea 或文件路径+选择本地文件），保存成功后如果内容有变会提示"需要重新点击「开始分析」"。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 均 clean。浏览器实测：①只改品牌名（原本 `analyzed`），保存后状态不变，仍是 `analyzed`；②改文案内容，保存后收到"已保存，内容已变更，需要重新点击「开始分析」"提示，状态正确变回 `uploaded`，"开始分析"按钮重新出现。测试过程中一度误以为编辑弹窗渲染错位/未打开，排查后确认是自动化测试用的浏览器虚拟窗口尺寸（2560×1272）导致 TDesign 弹窗居中计算和截图缩放对不上，缩小窗口后弹窗完全正常居中，和这次改动无关。验证完把测试过程中改动的品牌名/文案改回原值，不留测试痕迹。

---

## 2026-07-31 首页导航"广告素材"改名为"创意素材"

**用户意见 / 触发原因**：用户要求把主页导航里的"广告素材"UI 改名为"创意素材"，"新建广告素材"也改成"新建创意素材"。

**改了什么**：`AppHeader.vue` 导航链接文案、`AdListView.vue` 的卡片标题/创建成功提示/删除确认文案，以及 `ActionBar.vue` 里生成创意方案下拉框的 placeholder，统一把"广告素材"改成"创意素材"（只改显示文案，路由 `/ads`、接口名、数据表字段等都不动，避免不必要的改动范围）。

**验证**：`npx vue-tsc -b --force` clean。浏览器实测导航栏和"新建创意素材"卡片标题均正确显示新文案。

---

## 2026-07-31 聊天触发的 revise 也加"正在处理"即时确认消息

**用户意见 / 触发原因**：用户反馈"每次用户提出修改意见，包括对分镜、对视频、对生成游戏的，用户点击完发送后，对话窗口下面最好显示服务器在干什么，因为发送完修改意见后页面没有反应，不知道背后的 agent 是否在运行、是什么状态"。排查发现聊天触发的 5 个 revise 工具（方案/分镜草案/运镜专用/默认互动游戏/自定义游戏）背后统一走 `safeRevise` 包装，这个函数原来只在失败时才会推消息，成功路径从"模型决定调用这个工具"到"revise 完成推结果卡片"之间完全没有任何反馈——如果模型在调用工具前没有先说点什么，这段时间（图片/视频生成常常要几十秒到几分钟）聊天框里就是纯空白，和按钮触发流程已经有的"已确认，正在生成...请稍候"即时确认消息不是一个体验。

**改了什么**：`src/agents/sessionAgent/index.ts` 的 `safeRevise(ctx, label, fn)` 在 `await fn()` 之前统一推一条 `已收到，正在${label}，请稍候...` 的 assistant 消息（复用 `resTool.newMessage().text().complete()` 这个和 `actions.ts` 里按钮触发流程完全一样的即时确认消息模式），5 个 revise 工具（`run_sub_agent_director_plan_revise`/`run_sub_agent_bridge_video_revise`/`run_sub_agent_bridge_video_revise_motion`/`run_sub_agent_playable_revise`/`run_sub_agent_custom_game_revise`）都走这一个函数，不用逐个加。

**验证**：`npx tsc --noEmit -p .` clean。用 Claude in Chrome 真实走一遍浏览器流程：对 cut 57（自定义生成的找不同小游戏）在聊天里发"把倒计时从20秒改成30秒"，确认发送后聊天框立刻出现"已收到，正在自定义游戏调整，请稍候..."，而不是像之前一样空白；等真实的素材重新生成（3张图）、代码重新生成、冒烟测试跑完后，收到"已将 cut 57 自定义小游戏的倒计时从 20 秒调整为 30 秒，新预览已生成"的结果卡片，参考分 100。查库确认新的 `finalRender` 段（id 78）正确替换成选中项，生成的 `game/index.html` 里倒计时确实是 30.0 秒。测试过程中第一次发送撞上了一次不相关的模型/中转临时抖动（`No output generated. The model stream ended without a finish chunk.`，和这次改动无关，模型自己的回复流都没走到工具调用这一步），重新发送后正常走完全程。

---

## 2026-07-31 修复终审代码级素材检查不认自定义游戏的素材命名，导致自定义游戏永远 0 分卡在"未调用模型审核"

**用户意见 / 触发原因**：用户点击"确认内容，进入终审与落地"后报错——`内容合规：0 · 品牌安全：0 · 技术规格：0`，`产物文件检查未通过，未调用模型审核。游戏包缺少配对素材图: bridgeCut/57/playable/game/assets/tiles/`。排查发现 cut 57 是走"自定义玩法生成"（M9）产出的找不同游戏，实际素材是 `game/assets/custom_0.png`/`custom_1.png`/`custom_2.png`，不在 `tiles/` 目录下；而 `supervisorAgent/index.ts` 的代码级预检查函数 `findTileFileName` 硬编码只认默认翻牌配对的 `game/assets/tiles/tile_src_N.*` 命名，找不到就直接判定"缺素材"，连模型审核都不调用直接返回三个 0 分——这是 M9 加自定义游戏功能时留下的遗漏，终审这一步一直没适配自定义游戏的素材命名约定，此前从未被真实触发过（第一次有自定义游戏真的走到终审这一步）。

**改了什么**：`src/agents/supervisorAgent/index.ts` 把 `findTileFileName` 换成 `findRepresentativeAssetRelPath`，两种命名约定都认——默认翻牌配对走 `assets/tiles/tile_src_N.*`，自定义游戏走 `assets/` 下直接的 `custom_N.png`。两处调用点都改了：代码级预检查（`codePreCheck`）、给模型审核用的参考图路径解析（`runSupervisionForCut` 里 `imageRelPath` 那段）。

**验证**：`npx tsc --noEmit -p .` clean。重启服务后对 cut 57 真实调用 `runSupervisionForCut(57)`，确认这次正确跳过了代码级拦截、真的调用了模型审核（`contentCompliance=94 / brandSafety=58 / technicalSpec=30`，不再是硬编码三个 0），返回了针对实际内容的具体审核意见（占位 CTA 链接、素材未做成对图、无可测试 H5 成品、演员肖像权确认等）——这些是游戏内容本身还没做完整，和这次修的代码 bug 无关。

---

## 2026-07-31 新增 Google 官方 Gemini 直连图片模型，替换掉 grsai 中转的 Nano Banana 选项

**用户意见 / 触发原因**：gpt-image-2 中转（napi.moretoken.ai）反复撞上"The origin web server did not return a complete response within the 120-second Proxy Read Timeout window"，用户问"其他的模型比如 gemini 的 image 模型能代替 gpt-image-2 么"，先接了 grsai 中转的 nano-banana-2 作为备选；之后用户在自己的 Google Cloud 项目里申请到了 AI Studio 官方 API Key，要求接一个不经过任何中转的官方直连选项，验证通过之后又明确要求把 grsai 这个选项去掉，只保留 gpt-image-2（中转）和 Google 官方直连两个。

**改了什么**：新增 `data/vendor/google.ts`——直连 `generativelanguage.googleapis.com/v1beta`，走 `generateContent` 接口的多模态图片输出（不是 Imagen 的 predict 接口），鉴权用 `x-goog-api-key` 请求头，同步加了 130 秒超时保护；请求地址做成可配置的 `baseUrl`（默认官方地址，`.env` 里的 `GOOGLE_BASE_URL` 可以覆盖，不填就用默认值）。`src/lib/syncEnvVendors.ts` 的 `ENV_VENDOR_MAP` 加一行 `google`。`src/agents/shared/imageModel.ts` 的 `IMAGE_MODEL_OPTIONS` 去掉 `grsai:nano-banana-2`，加上 `google:gemini-3.1-flash-image`；`ActionBar.vue` 的下拉框同步更新。

**验证**：真实调用 `u.Ai.Image('google:gemini-3.1-flash-image').run(...)`，纯文生图和带参考图编辑（Nano Banana 风格的图片编辑）均一次成功，参考图保真度良好；把 `baseUrl` 从硬编码改成可配置之后重启服务、重新调用一次确认默认地址依然正常工作。`npx tsc --noEmit -p .` clean。

---

## 2026-07-31 内容生成前新增图片模型选择——选定后分镜草案/游戏素材全程沿用同一个模型

**用户意见 / 触发原因**：gpt-image-2 中转反复超时失败，用户明确要求"在内容生成阶段前，给用户按钮或者下拉框让用户选择用 gpt-image-2 模型还是 gemini 模型，然后一旦选定后，后续的分镜草案，生成游戏都用这个 image 模型"，不要每次调用各自决定。

**改了什么**：`ab_creativePlan` 新增 `imageModelKey` 列（`fixDB.ts`/`initDB.ts`）。新增 `src/agents/shared/imageModel.ts`，统一维护可选模型列表 + `resolveImageModelKey(creativePlanId)`（老数据/没选过的方案没有这一列，回退到系统默认 `gpt-image-2`）。`videoGenAgent`（Stage A 草案图）、`playableAgent`（游戏素材、AI 兜底 tile 生成）里原来硬编码 `IMAGE_MODEL_KEY` 常量的调用点全部改成读这个函数。`ActionBar.vue`"生成内容"按钮旁加下拉框，选定的值随 `bridgeCut:generate` 事件传给后端，写入 `imageModelKey`。

**验证**：浏览器走查选择不同模型后触发生成，确认 `ab_creativePlan.imageModelKey` 正确写入；查大模型调用日志确认分镜草案图/游戏素材生成都用了选定的模型，不是默认值。`npx tsc --noEmit -p .` clean。

---

## 2026-07-31 如何让生成的游戏画面衔接视频结尾——候选素材新增视频分镜草案图

**用户意见 / 触发原因**：用户问"生成的视频画面风格可以延续到游戏里么，怎么延续"，发现这个方向完全没做——候选素材机制（M9）只支持 Episode 帧，游戏生成和视频生成两边画面完全断开。用户明确要求把 video cut 已经生成好的分镜草案图、以及渲染完成片抽的几帧（不只是首帧）都作为自定义玩法生成的参考素材/参考图。做完之后进一步问"如果想要生成的游戏正好能衔接住生成的视频结尾，该怎么做"，把已经做好的几个能力汇总成一份实操指引，记在这里。

**改了什么**：`playableAgent/index.ts` 新增 `resolveVideoCutReferenceImages(creativePlanId)`——自动从同方案 video cut 的渲染成片里均匀抽 3 帧（`sampleFrames(..., {mode:"count", count:3, includeLast:false})`），线程进 `generateCustomGame`/`reviseCustomGame` 的参考图列表，不需要用户操作。分镜草案图本身则反过来做成**用户可见可选**的候选素材——新增 `VIDEO_DRAFT_CANDIDATE_KEY` 特殊 key，和 Episode 帧文件名区分开，选中后从 video cut 自己的产物里取图（不是查 episode 帧目录），在 `ActionBar.vue` 的候选素材勾选列表里排在最前面，"自定义玩法生成"和"确认组装小游戏"两个弹窗共用。草案图是 gpt-image-2 直出的无损 PNG（未压缩约 2-3MB base64），当参考图体积过大，顺手加了压缩（`zipImage` 压到 300KB 以内的 JPEG），降低撞上供应商 120 秒网关超时的概率。

**怎么用（给用户/未来自己的操作指引）**：
1. 生成游戏时，在候选素材列表里勾选"视频分镜草案图"，让模型真的看到视频结尾定格长什么样，照着去衔接画风/构图。
2. 走"自定义玩法生成"会自动多带 3 张成片截图（不用手动选，静默生效），进一步强化风格延续。
3. 自定义玩法描述里直接写清楚要怎么衔接（比如"游戏开场画面要衔接视频结尾定格的场景，棋盘/卡面要像是从那个画面直接过渡出来的"）——生成 GameSpec 的模型本来就看得到 Episode 结尾状态和创意方向，描述里点明衔接需求，模型才会针对性设计，光靠参考图本身不保证画面一定会照着画（下面"验证"里就遇到了这种情况）。
4. 如果游戏生成完之后发现视频结尾其实没完全呼应上游戏的实际样子，可以反过来对视频提修改意见（比如"结尾画面呼应一下小游戏卡面素材"），触发 `reviseDraftCut` 用游戏已经生成好的真实素材重画最后一帧，形成双向衔接（这条路径是 M9 已经做好的）。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 全程 clean。真实调用 `generateCustomGame(bridgeCutId, description, [VIDEO_DRAFT_CANDIDATE_KEY])`：确认候选 key 正确解析出 video cut 的草案图（不是 Episode 帧），素材生成成功、游戏组装完成、`fallback:false`。压缩前后对比：未压缩时（约 3.38M 字符）图片编辑请求连续两次撞上 120 秒网关超时，压缩到约 371K 字符后重试即成功。浏览器走查确认候选素材勾选列表正确展示"视频分镜草案图"选项，和 Episode 候选帧共用同一套勾选/展示逻辑。诚实记录一点局限：一次真实测试里，虽然参考图正确带上了视频草案图，但最终生成的素材画风偏向广告本身的糖果主题、没有明显带出草案图里的戏剧化场景——说明参考图只是提供风格线索，最终画面还是由素材描述文字主导，这也是上面"怎么用"第 3 点强调要在描述里写清楚衔接需求的原因。

---

## 2026-07-31 生成/revise 加进程内并发锁，修复并发调用互相覆盖状态的真实 bug

**用户意见 / 触发原因**：用户报告一个真实现象——"bridgeCut 42 当前状态为 rendering，不是 failed，无法重试"，但之前的消息又说这个 cut 状态是 failed。排查发现是并发触发（几乎同时点两次重试，或按钮+聊天各触发一次）导致的竞态：两次调用都在查完 `cut.status` 之后才开始跑耗时的模型调用，谁的结果后写入数据库谁生效——已经生成好的草案被后到的失败结果错误覆盖成 `failed`。

**改了什么**：新增 `src/agents/shared/cutLock.ts`，用内存 `Set<number>` 在函数最开始、没有任何 `await` 之前做同步检查+占用（利用 JS 单线程特性关闭这个竞态窗口，比"先查数据库状态再判断"更可靠；只对单进程部署场景生效，够用）。包进 `videoGenAgent` 的 4 个入口（`generateDraftCut`/`reviseDraftCut`/`renderStageB`/`reviseStageBMotion`）和 `playableAgent` 的 4 个入口（`assemblePlayable`/`revisePlayable`/`generateCustomGame`/`reviseCustomGame`）。为避免 `generateCustomGame` 失败兜底调用 `assemblePlayable` 时把自己锁死，把 `assemblePlayable` 拆成不加锁的 `assemblePlayableInner`（核心逻辑）+ 加锁的 `assemblePlayable`（对外入口），兜底路径直接调 `assemblePlayableInner`。

**验证**：真实触发两个几乎同时的 `generateDraftCut` 调用，一个正常成功、另一个立刻收到"正在生成中，请稍候"的拒绝；确认锁在成功/失败后都正确释放（紧接着的第三次调用能正常执行）。`npx tsc --noEmit -p .` clean。

---

## 2026-07-31 图片生成请求加超时保护，修复请求卡住无限等待且不报错的问题

**用户意见 / 触发原因**：一次自定义小游戏素材生成卡住 24 分钟以上，连中转本身的 120 秒网关超时报错都没能触发——排查发现 `data/vendor/openai.ts` 的 `imageRequest` 对 axios/fetch 请求完全没配置超时，请求方会一直挂着等，永远不会主动放弃。

**改了什么**：`/images/edits`（axios）加 130 秒 `timeout` 选项，`/images/generations`（fetch）加 `AbortSignal.timeout(130000)`，超时后抛出明确的中文错误信息而不是无限挂起。验证过程中发现 VM 沙箱（`src/utils/vm.ts`）没有把 `AbortSignal` 加进允许访问的全局变量白名单，导致新代码报"AbortSignal is not defined"，一并修复（加进沙箱对象）。

**验证**：真实测试 fetch 和 axios 两条路径，超时场景下都能正确抛出错误、不再无限挂起；确认沙箱内正常代码路径（非超时场景）未受影响，图片生成照常成功。`npx tsc --noEmit -p .` clean。

---

## 2026-07-31 成片时长从固定 6 秒改成模型自己在 6-15 秒范围内决定

**用户意见 / 触发原因**：用户问"为什么成片是 6 秒"，得知是硬编码的 `STAGE_B_DURATION_S=6` 之后，明确要求"把这个 6 秒设置改成一个范围，比如 6 到 15 秒，具体时间让生成视频 agent 自由发挥"。

**改了什么**：`videoGenAgent/schema.ts` 的 `stageADraftSchema` 新增 `durationS` 字段（`z.number().min(6).max(15)`，describe 里明确要求模型根据画面信息量/运镜复杂度/情绪过渡自己判断，不要不假思索地固定选某个值）；`performStageBRender` 用 `draft.durationS ?? 6`（老数据兼容）替代硬编码常量。运镜专用 revise（`reviseStageBMotion`/`buildMotionReviseMessages`）允许连带调整 `durationS`，因为时长本质上是"节奏"的一部分，和运镜/情绪基调放在一起改。`data/skills/video_gen_agent.md`、`session_agent_decision.md` 同步补充说明。

**验证**：真实生成多条分镜草案，确认 `durationS` 落在 6-15 范围内且随画面内容变化（不是固定值）；渲染出的成片实际时长和 `durationS` 对应。`npx tsc --noEmit -p .` clean。

---

## 2026-07-30 新增"自定义玩法生成"独立入口——LLM 现场写游戏代码 + 自动化冒烟测试 + 失败回退翻牌配对

**用户意见 / 触发原因**：PlayableAgent 的互动小游戏一直是翻牌配对（M3 照搬 Python 参考实现的模板），用户希望小游戏"多种多样，根据用户自己设计的"。讨论了三条路径（`docs/design-playable-game-type-options.md`）——多模板+确定性选型、LLM 现场生成游戏代码、外部 H5 包模式——用户在充分了解"LLM 写代码"这条路的安全/正确性/可维护性风险后，明确选择推进这条路径。设计过程中定下几个关键取舍：不做多轮追问式设计会话（成本太高），改成"确认组装小游戏"按钮旁边一个平级的独立入口，不接 SessionAgent 聊天路由；用户描述可长可短，不限定"一句话"；LLM 做了假设/默认选择时要如实告诉用户（`assumptions` 字段），不悄悄替用户做决定。

**改了什么**：
- 新依赖 `playwright`（这台机器 macOS 版本太旧，Playwright 自带 Chromium 不支持，改用 `channel:"chrome"` 驱动机器上已装的真实 Chrome，见 CLAUDE.md）。
- `src/agents/playableAgent/customGameSchema.ts`/`customGamePrompt.ts`（新增）：`gameSpecSchema`（`title`/`ctaUrl`/`gameType`/`objective`/`boardLayout`/`interactionRules`/`assetsNeeded`/`assumptions`），`buildGameSpecMessages`（用户描述 + 广告 `coreMechanic` 展开成结构化规格）、`buildGameCodeMessages`（按规格生成游戏代码，支持把上一次失败原因喂回去重试）。新增技能文件 `playable_custom_gamespec.md`/`playable_custom_codegen.md`。
- `src/utils/gameSmokeTest.ts`（新增）：`runGameSmokeTest(html)` 用 Playwright 加载生成出的 HTML，监听 `pageerror`/`console.error`，等待 `game_ready` postMessage 或超时，只做冒烟级别验证（页面能不能正常跑），不验证玩法逻辑本身对不对——这是这条路径承认的已知局限。
- `src/agents/playableAgent/index.ts`：`assemble()` 里"组装收尾"那部分（拷贝片头视频、注入容器页、落库）抽成共用的 `finalizePlayablePackage()`；新增 `generateCustomGame(bridgeCutId, description)`——GameSpec 生成 → 素材获取（按规格里每条具体描述单独用 gpt-image-1 生成，不复用 `tileCandidates`，见下面"踩的坑"）→ 代码生成 → 冒烟测试，不通过就把报错喂回去重试（最多 2 次），重试耗尽或任何一步意外失败都直接调用现有的 `assemblePlayable()` 兜底，保证总有产物可交付。
- `data/templates/playable/container.html`：游戏 iframe 加 `sandbox="allow-scripts"`（不给 `allow-same-origin`），缩小万一生成代码有问题时的影响范围。
- `src/socket/routes/sessionAgent.ts` + `src/agents/sessionAgent/actions.ts`：新增 `bridgeCut:customGameGenerate` 事件 + `generateCustomGameAction`，推卡片时带上是否自定义/是否回退的标记，`assumptions` 非空时额外发一条文字消息告诉用户做了哪些假设。
- 前端：`ActionBar.vue` 在"确认组装小游戏"旁边加平级的"自定义玩法生成"按钮，弹窗收集描述（鼓励详细描述，不限定一句话）；`ContentCandidateCard.vue` 展示"自定义生成"/"已回退默认版本"标签。`ContentCandidateContent` 类型（`src/socket/chatMessagesData.d.ts` + `frontend/src/types/chatMessagesData.ts`）加 `custom`/`fallback`/`fallbackReason` 可选字段。

**踩的坑**：第一版 `acquireCustomGameAssets` 复用了翻牌配对路径"真实截图优先"的逻辑，把 `tileCandidates`（AdLibraryAgent 挑出的完整游戏界面截图）直接塞进 GameSpec 的结构化素材槽位。真实测试一个三消游戏时，发现棋盘上有 2 颗"糖果"实际上是缩小的完整游戏界面截图，和其他棋子风格完全不搭——翻牌配对的素材槽位是同质的（随便一张有辨识度的图都行），但自定义游戏的槽位有具体描述（"单个独立糖果图标"/"棋盘背景"），不能用通用截图硬填。修复：自定义游戏的素材永远按每条具体描述单独用 gpt-image-1 生成，不复用 `tileCandidates`。

**验证**：`npx tsc --noEmit -p .`、`npx vue-tsc -b --force` 全程 clean。真实调用 `generateCustomGame`：①"找不同"描述（无需素材，纯 SVG/CSS）首次尝试即通过冒烟测试，浏览器实际通关验证——5 处差异全部能正确点选识别、完成后弹出"信号恢复"结束卡，`sandbox="allow-scripts"` 的 iframe 里交互和跨帧 `postMessage` 均正常；②"三消"描述（需要 12 张素材图，走真实 gpt-image-1 生成），发现并修复了上述截图错配问题后，重新验证棋盘素材全部是风格一致的 AI 生成图标，swap 交互和"不成对就自动复位不扣步数"的规则均符合规格。重试反馈机制单独验证：用一个环境变量临时让冒烟测试强制失败（验证完后已移除），确认失败原因正确地被拼进下一次生成的 prompt（"上一次生成失败的原因：……请修正这个问题"）。这次验证过程中连续 5 次撞到同一个上游服务临时不可用的报错（`Upstream service temporarily unavailable`），和这次改动无关——每次都能看到代码正确走到了预期的重试/兜底分支，只是兜底调用本身也需要真实模型调用，撞上了当时确实存在的服务不稳定；后续应该找一个 API 更稳定的时间窗口，再补一次"冒烟测试失败 → 干净地回退成功"的完整链路验证。

---

## 2026-07-30 修复 ActionBar 卡死显示"内容生成中"——cut 状态判断没有按当前 approved 方案过滤

**用户意见 / 触发原因**：用户反馈 ActionBar 一直显示"内容生成中..."，即使实际内容已经生成完毕。排查发现一个 episode 理论上不该同时存在两份 approved 方案，但实际数据里出现过（历史遗留/反复测试导致）——原来的 cut 状态相关 computed 是对 `sessionState.bridgeCuts` 全量判断，混进了另一份（已经 done 的）approved 方案的 cut，把当前方案的按钮状态判断全部打乱。

**改了什么**：`frontend/src/components/chat/ActionBar.vue` 新增 `currentPlanCuts` computed，按 `approvedPlan.id` 过滤 `bridgeCuts` 之后，所有后续状态判断（`videoDraftsReadyToConfirm`/`gameCut`/`readyToAssemblePlayable`/`allCutsDone`/`failedCuts`）全部基于这个过滤后的列表，不再用全量 `bridgeCuts`。

**验证**：浏览器实测确认按钮状态恢复正常，正确显示"确认内容，进入终审与落地"而不是卡在"内容生成中"。

---

## 2026-07-30 生成创意方案/生成内容点击后加即时反馈消息，避免用户以为没有响应

**用户意见 / 触发原因**：用户反馈点击"生成创意方案"和内容生成按钮之后界面没有任何反馈，容易以为点击没生效——实际上是模型调用本身需要一段时间，只是没有任何中间状态提示。

**改了什么**：`src/socket/routes/sessionAgent.ts` 的 `plan:generate` 处理器、`src/agents/sessionAgent/actions.ts` 的 `generateContentAction`，在触发耗时的生成流程之前先发一条 assistant 消息（"已确认，正在生成分镜草案，请稍候..."之类）作为即时确认，不用等生成完才看到第一条回复。

**验证**：浏览器实测点击后立刻出现确认消息，生成完成后再收到正式结果消息，两条消息不冲突。

---

## 2026-07-29 四条 revise 流程统一加历史记录，留给以后做训练数据

**用户意见 / 触发原因**：讨论方案 revise 是"原地覆盖，旧版本不保留"时，用户问能不能想办法保留，以后做训练用。排查发现问题比方案这一处更大——四条 revise 流程（方案/分镜草案/运镜专用/小游戏配置）里，用户反馈的原文本身哪里都没有落库，只是喂给模型就丢了；方案的 revise 还是直接 `UPDATE` 覆盖旧值。这两个缺口都会让"根据反馈修改内容"这个任务将来没有干净的训练样本可用。

**改了什么**：新增 `ab_reviseHistory` 表（`initDB.ts` 里加的，走既有的"新表自动建表"机制，不需要额外写 `fixDB.ts` 迁移），列为 `targetType`（`plan`/`bridgeCutDraft`/`bridgeCutMotion`/`playable`）+ `targetId`（方案 revise 是 planId，其余三种是 bridgeCutId，不建外键，因为指向两张不同的表）+ `feedback`（用户反馈原文）+ `beforeState`/`afterState`（JSON，revise 前后的内容对象）+ `createTime`。新增 `src/agents/shared/reviseHistory.ts` 导出唯一的 `recordRevise()` 写入函数，四个 revise 函数（`directorAgent.revisePlan`、`videoGenAgent.reviseDraftCut`、`videoGenAgent.reviseStageBMotion`、`playableAgent.revisePlayable`）各自在拿到新旧状态之后调用一次——`beforeState`/`afterState` 只存"会变化的创意内容"本身（方案是 `{narrative,tone,planEvaluatorScore}`，分镜草案/运镜专用是 `StageADraft`，小游戏是 `PlayableConfig`），不混入 URL、prompt 这些派生的操作性数据，四种类型的记录结构保持对称，方便以后统一读取。

**验证**：`npx tsc --noEmit -p .` clean；直接查库确认 `ab_reviseHistory` 首次启动时被自动建出来。真实调用验证了两条路径：`revisePlan(39, "基调再幽默一点...")`——历史记录里 `beforeState`/`afterState` 的 `narrative`/`tone`/`planEvaluatorScore` 和方案表实际改动前后的值完全对应；`reviseDraftCut(22, "画面再暗一点，情绪基调更神秘")`——历史记录里的 `StageADraft` 完整对应 revise 前后的分镜草案。另外两条路径（运镜专用 revise、小游戏 revise）复用的是同一个 `recordRevise()` 函数，且上一条改动（运镜专用 revise）已经做过真实的完整链路验证，这次直接用 `recordRevise()` 的独立单元调用确认了写入/JSON 序列化正确，没有再重复跑一遍完整的 Seedance/gpt-image-1 生成流程。

---

## 2026-07-29 SessionAgent 不再把运行时状态伪装成 assistant 消息

**触发原因**：同事指出 `runDecisionAI` 把 `buildPlansContext()` 现查出来的运行时状态（workflowStage/方案列表/cut 列表）塞进一条 `role:"assistant"` 消息里喂给模型，语义上不干净——`assistant` 角色代表"模型之前说过的话"，不是"框架提供的可信状态"，长期会有三个问题：模型可能把状态当成自己的既有结论、用户内容和系统状态的信任边界不清、调试时分不清真实对话和系统注入。第三条这次直接能验证——查现成的大模型调用日志，`messages` 里确实原样打印出一条看起来像模型说过的假 assistant 消息，容易误导看日志的人。同事同时提议一套结构化的 Runtime Context Envelope（`schemaVersion`/`runId`/各类 revisionId/`workflowInvariants` 等），评估下来这套 schema 里的"版本化""run 追踪"这些概念在这个项目里都还不存在，照搬需要先建一整套版本化基础设施，对这次要解决的"消息角色语义不干净"这个问题来说是过度设计。

**改了什么**：`src/agents/sessionAgent/index.ts` 的 `runDecisionAI`——`plansContext` 不再塞进一条伪造的 `{role:"assistant"}` 消息，改成拼进 `system` 字符串（技能文件内容 + 换行 + 这段动态状态），`messages` 数组只保留真实的 `{role:"user", content: 用户原话}`。"每次现查现拼" 这个已经做对的部分完全不受影响，只是运行时状态挪了个位置。

**验证**：`npx tsc --noEmit -p .` clean。真实调用 `runDecisionAI`（用假 socket 的 `ResTool` 触发真实的 LLM 调用），查大模型调用日志确认：`system` 字段末尾正确追加了 `## 当前阶段\nworkflowStage=content_review\n\n## 当前创意方案\n...\n\n## 当前内容 cut\n...`，`messages` 数组只有一条真实的用户消息，没有伪造的 assistant 消息；模型基于 `system` 里的状态正确回答了"现在方案状态怎么样了"，方案/cut 的状态描述和真实 DB 数据一致，证明挪位置之后模型依然能正确读取这段上下文。

---

## 2026-07-29 新增"只改运镜/节奏"的成片 revise 路径，和"重新生成草案"并列为用户可选的两种 revise

**用户意见 / 触发原因**：追问 revise 机制时发现一个真实缺口——成片渲染完之后，任何反馈（不管是"头发乱了"这种画面内容问题，还是"运镜太快了"这种纯运镜/节奏问题）都只能走 `reviseDraftCut`，即整份分镜草案重新生成、图片重新画一遍、还要用户重新走一遍确认分镜→渲染成片的流程。对于纯运镜/节奏类反馈这是不必要的开销——草案图已经确认过，画面内容没有问题，理论上只需要重新渲染 Stage B。用户明确要求给用户一个显式的二选一（只改运镜节奏 / 重新生成草案），不要让 SessionAgent 自己猜该走哪条路径。

**改了什么**：`videoGenAgent/index.ts` 把 `renderStageB` 里"调 Seedance、存新 finalRender 段、把 cut 标记 done"的部分抽成公共函数 `performStageBRender(bridgeCutId, creativePlanId, draft)`；新增 `reviseStageBMotion(bridgeCutId, feedback)`，要求 `cut.status==="done"`，只让 LLM 重新考虑 `cameraMovement`/`emotionalTone` 两个字段（`prompt.ts` 新增 `buildMotionReviseMessages`，指令里明确要求其余字段原样返回），代码层再强制锁定 `shotSize`/`subjectAction`/`lightingMood`/`framingNotes` 为已确认草案的原值（双重保险，防止模型不听指令），跳过 Stage A 图片重新生成，直接复用已选定的草案图调用 `performStageBRender`，成功后 `cut.status` 直接回到 `"done"`，不经过 `"draft"`。`sessionAgent/index.ts` 新增聊天工具 `run_sub_agent_bridge_video_revise_motion`，和已有的 `run_sub_agent_bridge_video_revise` 分工写进各自的 `description` 里；`session_agent_decision.md` 教会 SessionAgent 两者的区别——反馈涉及画面内容用前者，纯运镜/节奏且成片已渲染用后者，**反馈含糊分不清是哪种时，直接用文字问用户，不允许自己猜**。

**验证**：`npx tsc --noEmit -p .` clean。真实调用 `reviseStageBMotion(22, ...)`：第一次命中了 Seedance 供应商的内容策略拒绝（`OutputAudioSensitiveContentDetected`，和本次改动无关），验证了失败路径下草案图段和旧 finalRender 段都完好未被破坏、`cut.status` 正确落到 `failed`；重置状态后第二次真实调用成功，`cameraMovement` 按反馈从"推进"改成"甩镜"，`shotSize`/`subjectAction`/`lightingMood`/`framingNotes` 逐字节保持不变，草案图 segment 全程未变（同一个 id），新的 finalRender 段插入且旧段被置为未选中，`cut.status` 直接回到 `done`，全程没有经过 `draft`/重新确认。

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
