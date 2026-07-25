// 后端 src/socket/chatMessagesData.d.ts 的前端副本——前端不能直接 import 后端 src/，
// 手动保持同步（文件小且协议稳定，不做自动化同步机制）。

export type ChatMessageStatus = "pending" | "streaming" | "complete" | "stop" | "error";

export interface ChatBaseContent<T extends string, D> {
  type: T;
  data: D;
  status?: ChatMessageStatus;
  id?: string;
  strategy?: "merge" | "append";
  ext?: Record<string, any>;
}

export type TextContent = ChatBaseContent<"text", string>;
export type MarkdownContent = ChatBaseContent<"markdown", string>;
export type ImageContent = ChatBaseContent<"image", { name?: string; url?: string; width?: number; height?: number }>;
export type ThinkingContent = ChatBaseContent<"thinking", { text?: string; title?: string }>;
export type SearchContent = ChatBaseContent<
  "search",
  { title?: string; references?: { title: string; icon?: string; type?: string; url?: string; content?: string; site?: string; date?: string }[] }
>;
export type SuggestionContent = ChatBaseContent<"suggestion", { title: string; prompt?: string }[]>;
export type ToolCallContent = ChatBaseContent<
  "toolcall",
  { toolCallId: string; toolCallName: string; eventType?: string; parentMessageId?: string; args?: string; chunk?: string; result?: string }
>;
export type ActivityContent<T = Record<string, any>> = ChatBaseContent<
  "activity",
  { activityType: string; messageId?: string; content: T; deltaInfo?: { fromIndex: number; toIndex: number } }
>;
export type ReasoningContent = ChatBaseContent<"reasoning", AIMessageContent[]>;

// M2：DirectorAgent 产出的创意方案候选卡片
export type PlanCandidateContent = ChatBaseContent<
  "planCandidate",
  {
    id: number;
    adId: number;
    adName?: string;
    formatSequence: string[];
    narrative: string;
    tone: string;
    planEvaluatorScore: number;
    status: "draft" | "approved" | "rejected";
    evaluatorFeedback?: { narrativeFeasibility: number; formatFit: number; adAlignment: number; feedback: string };
  }
>;
// M3：BridgeVideoAgent Stage A 分镜草案卡片
export type StoryboardCutContent = ChatBaseContent<
  "storyboardCut",
  {
    bridgeCutId: number;
    index: number;
    imageUrl: string;
    prompt: string;
    status: "draft" | "draftConfirmed";
    evaluatorScore: number;
    evaluatorFeedback?: string;
  }
>;
// M3：BridgeVideoAgent Stage B 渲染成片候选
export type VideoCandidateContent = ChatBaseContent<
  "videoCandidate",
  { bridgeCutId: number; videoUrl: string; durationMs: number; evaluatorScore: number; evaluatorFeedback?: string }
>;
// M3：PlayableAgent/OverlayAgent 共用的候选卡片
export type ContentCandidateContent = ChatBaseContent<
  "contentCandidate",
  { bridgeCutId: number; type: "playableGame" | "ctaCard"; previewUrl: string; ctaUrl?: string; evaluatorScore: number; evaluatorFeedback?: string }
>;
// M4：SupervisorAgent 落地前终审结果——真正的拦截判定，不是参考分
export type SupervisorResultContent = ChatBaseContent<
  "supervisorResult",
  { bridgeCutId: number; passed: boolean; contentCompliance: number; brandSafety: number; technicalSpec: number; issues: string[]; feedback: string }
>;
// M4：Assembler 组装完成后的最终交付物
export type ManifestContent = ChatBaseContent<
  "manifest",
  { manifestId: number; episodeId: number; creativePlanId: number; type: string; deliverableUrl: string; ctaUrl?: string }
>;

export type AIMessageContent =
  | TextContent
  | MarkdownContent
  | ImageContent
  | ThinkingContent
  | SearchContent
  | SuggestionContent
  | ReasoningContent
  | ToolCallContent
  | ActivityContent
  | PlanCandidateContent
  | StoryboardCutContent
  | VideoCandidateContent
  | ContentCandidateContent
  | SupervisorResultContent
  | ManifestContent;

export type UserMessageContent = TextContent | ChatBaseContent<"attachment", { fileType: string; size?: number; name?: string; url?: string }[]>;

export interface ChatBaseMessage {
  id: string;
  status?: ChatMessageStatus;
  datetime?: string;
  ext?: any;
}

export interface UserMessage extends ChatBaseMessage {
  role: "user";
  content: UserMessageContent[];
}

export interface AIMessage extends ChatBaseMessage {
  role: "assistant";
  content?: AIMessageContent[];
  name?: string;
}

export interface SystemMessage extends ChatBaseMessage {
  role: "system";
  content: TextContent[];
}

export type ChatMessagesData = UserMessage | AIMessage | SystemMessage;
