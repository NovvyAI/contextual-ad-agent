# contextual-ad-agent

短剧广告桥接多 Agent 系统。输入一集短剧 Episode + 一条游戏类广告素材，分析后生成固定两段式的桥接内容——一段从 Episode 结尾过渡到游戏开场的视频，紧接一个真实反映该游戏的 H5 配对小游戏——拼接在 Episode 尾部播出。

架构设计、开发计划、各里程碑详情见 `docs/`；项目约定、技术栈速查见 `CLAUDE.md`。

## 本地需要先装什么

- **Node.js >= 20**（`package.json` 的 `engines` 字段要求）
- **Yarn**（包管理器用的是 Yarn，不是 npm——项目里 `@rmp135/sql-ts` 和 `sqlite3` 之间有一个 npm 会报 `ERESOLVE` 冲突但 yarn 能正常处理的 peer dependency，装依赖统一用 `yarn add`/`yarn install`）
- **ffmpeg / ffprobe**（`src/utils/video.ts` 里直接调用这两个系统命令做抽帧/转码/时长探测，不是 npm 包，需要自己装）
  ```bash
  brew install ffmpeg   # macOS
  ```
- **Google Chrome**（真实安装的浏览器，不是 Playwright 自带的 Chromium）——"自定义玩法生成"功能里的自动化冒烟测试（`src/utils/gameSmokeTest.ts`）用 `channel: "chrome"` 直接驱动这个已安装的 Chrome。没装的话这一步会失败，但不影响其余功能，失败后会自动回退到默认翻牌配对小游戏。
- macOS 上如果原生依赖（`better-sqlite3`/`sqlite3` 等）在 `yarn install` 时触发源码编译，需要装好 **Xcode Command Line Tools**（`xcode-select --install`）。

其余依赖（`@huggingface/transformers` 里的 Whisper 语音转写模型等）都是 npm 包自带或首次使用时自动下载，不需要额外安装。

## 快速开始

1. 安装依赖（后端、前端是两个独立子工程，要分别装）：
   ```bash
   yarn install
   cd frontend && yarn install && cd ..
   ```
2. 配置密钥：
   ```bash
   cp .env.example .env
   ```
   打开 `.env` 填入真实的 API Key（至少需要一个能用的文本模型供应商如 `ANTHROPIC_API_KEY` 和一个图片模型供应商如 `OPENAI_API_KEY`/`GOOGLE_API_KEY`，视频生成需要 `IMAROUTER_API_KEY`）。启动时会自动把 `.env` 里的值同步进数据库并启用对应供应商，不用手动调接口配置。
3. 启动服务（二选一）：
   - **一次性启动前后端**（推荐）：
     ```bash
     ./start_server.sh
     ```
     日志分别写到根目录的 `backend.log`/`frontend.log`，`tail -f` 可以看；`Ctrl+C` 会把两个服务一起停掉。
   - **手动分别启动**（两个终端窗口）：
     ```bash
     yarn dev                        # 后端，默认 http://localhost:10588
     cd frontend && yarn dev         # 前端，默认 http://localhost:5173
     ```
4. 浏览器打开前端地址（默认 `http://localhost:5173`），用默认账号登录：
   - 用户名：`admin`
   - 密码：`admin123`

## 使用教程

1. **上传并分析 Episode**——顶部导航"Episodes"页，"新建 Episode"表单填标题 + 服务器本地文件路径（一段短剧视频），点击"创建"；创建后点这一行的"开始分析"，等状态变成 `analyzed`（StoryboardAgent 会抽帧、转写台词、分析剧情/结尾悬念/候选素材，需要一点时间）。
2. **添加创意素材**——顶部导航"创意素材"页，"新建创意素材"表单填名称，勾选形式（图片/视频/纯文字，可以同时勾多种，会按形式拆成多条独立记录），对应填文件路径或文案，点击"创建"；同样创建后点"开始分析"，等状态变成 `analyzed`（AdLibraryAgent 会分析游戏玩法/视觉素材/品牌安全等信息）。
3. **进入会话，生成创意方案**——回到"Episodes"页，对已经 `analyzed` 的 Episode 点"进入会话"；在底部输入框上方的下拉框里勾选一个或多个已分析完成的创意素材，点击"生成创意方案"，DirectorAgent 会生成几份候选方案，选一份满意的确认。
4. **生成内容并确认分镜草案**——方案确认后，选一个图片生成模型（gpt-image-2 / Gemini），点击"生成内容"；VideoGenAgent 会生成分镜草案图，确认没问题后点击"确认分镜草案，开始渲染成片"进入正式渲染。**目前建议优先选 Gemini**——gpt-image-2 走的是 moretoken 中转，经常撞上 120 秒网关超时导致生成失败；Gemini（官方直连或 grsai 中转）更稳定。
5. **组装/自定义小游戏**——视频渲染完成后，点击"确认组装小游戏"走默认的翻牌配对玩法，或者点"自定义玩法生成"按自己描述的玩法现场生成一个专属小游戏（可以勾选候选画面作为参考图）。
6. **确认内容，进入终审与落地**——小游戏生成完成后，点击这个按钮触发 SupervisorAgent 终审，通过后组装出最终可交付的 H5 页面。

以上每一步也都可以直接在底部聊天框里打字表达（比如"我选方案1""这个分镜头发太乱了，重新画""把倒计时改成30秒"），SessionAgent 会识别意图自动调用对应操作或 revise 流程，不一定要点按钮。

## 其他常用命令

```bash
yarn lint                     # 后端类型检查（tsc --noEmit）
cd frontend && npx vue-tsc -b --force   # 前端类型检查
yarn build                    # 生产构建
```
