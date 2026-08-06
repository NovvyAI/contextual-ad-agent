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
    narrative: string;
    tone: string;
    planEvaluatorScore: number;
    status: "draft" | "approved" | "rejected";
    evaluatorFeedback?: { narrativeFeasibility: number; gameRelevance: number; adAlignment: number; feedback: string };
    // 生成时的初始反馈状态，点击后不会实时改这张卡片本身（和"确认这份方案"按钮同样的已知取舍）
    feedback?: "like" | "dislike" | null;
  }
>;
// M2：一次生成恰好 2 份创意方案，供用户并排比较
export type PlanCandidatePairContent = ChatBaseContent<"planCandidatePair", { plans: PlanCandidateContent["data"][] }>;
// M3：VideoGenAgent Stage A 分镜草案卡片
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
// M3：VideoGenAgent Stage B 渲染成片候选
export type VideoCandidateContent = ChatBaseContent<
  "videoCandidate",
  { bridgeCutId: number; videoUrl: string; durationMs: number; evaluatorScore: number; evaluatorFeedback?: string }
>;
// PlayableAgent 产出的互动游戏包候选卡片
export type ContentCandidateContent = ChatBaseContent<
  "contentCandidate",
  {
    bridgeCutId: number;
    type: "playableGame";
    previewUrl: string;
    ctaUrl?: string;
    evaluatorScore: number;
    evaluatorFeedback?: string;
    custom?: boolean; // 是否走了自定义玩法生成（LLM 现场写游戏代码），不是默认的翻牌配对
    fallback?: boolean; // 自定义生成失败，已回退到默认的翻牌配对
    fallbackReason?: string;
  }
>;
// M4：SupervisorAgent 落地前终审结果——真正的拦截判定，不是参考分
export type SupervisorResultContent = ChatBaseContent<
  "supervisorResult",
  { bridgeCutId: number; passed: boolean; contentCompliance: number; brandSafety: number; technicalSpec: number; issues: string[]; feedback: string }
>;
// M4：Assembler 组装完成后的最终交付物
export type ManifestContent = ChatBaseContent<
  "manifest",
  { manifestId: number; episodeId: number; creativePlanId: number; type: "video" | "playableGame"; deliverableUrl: string; ctaUrl?: string }
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
  | PlanCandidatePairContent
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
