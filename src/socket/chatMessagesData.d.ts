import type { ToolCallEventType } from './adapters/agui/types/events';

export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'stop' | 'error';
export type AttachmentType = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'ppt' | 'txt';
export type ChatComment = 'good' | 'bad' | '';

// 基础内容接口
export interface ChatBaseContent<T extends string, D> {
  type: T;
  data: D;
  status?: ChatMessageStatus;
  id?: string;
  strategy?: 'merge' | 'append';
  ext?: Record<string, any>;
}

// 内容类型定义
export type TextContent = ChatBaseContent<'text', string>;
export type MarkdownContent = ChatBaseContent<'markdown', string>;
export type ImageContent = ChatBaseContent<'image', { name?: string; url?: string; width?: number; height?: number }>;
export type ThinkingContent = ChatBaseContent<'thinking', { text?: string; title?: string }>;
export type SearchContent = ChatBaseContent<'search', { title?: string; references?: { title: string; icon?: string; type?: string; url?: string; content?: string; site?: string; date?: string }[] }>;
export type SuggestionContent = ChatBaseContent<'suggestion', { title: string; prompt?: string }[]>;
export type AttachmentContent = ChatBaseContent<'attachment', { fileType: AttachmentType; size?: number; name?: string; url?: string; isReference?: boolean; width?: number; height?: number; extension?: string; metadata?: Record<string, any> }[]>;
export type ToolCallContent = ChatBaseContent<'toolcall', { toolCallId: string; toolCallName: string; eventType?: ToolCallEventType; parentMessageId?: string; args?: string; chunk?: string; result?: string }>;
export type ActivityContent<T = Record<string, any>> = ChatBaseContent<'activity', { activityType: string; messageId?: string; content: T; deltaInfo?: { fromIndex: number; toIndex: number } }>;
// M2: DirectorAgent 产出的创意方案候选卡片。
export type PlanCandidateContent = ChatBaseContent<'planCandidate', {
  id: number;
  adId: number;
  adName?: string;
  narrative: string;
  tone: string;
  planEvaluatorScore: number;
  status: 'draft' | 'approved' | 'rejected';
  evaluatorFeedback?: { narrativeFeasibility: number; gameRelevance: number; adAlignment: number; feedback: string };
}>;
// M3: VideoGenAgent Stage A 分镜草案卡片（逐张 review，"只重画这一张"revise 的对象）
export type StoryboardCutContent = ChatBaseContent<'storyboardCut', {
  bridgeCutId: number;
  index: number;
  imageUrl: string;
  prompt: string;
  status: 'draft' | 'draftConfirmed';
  evaluatorScore: number;
  evaluatorFeedback?: string;
}>;
// M3: VideoGenAgent Stage B 渲染成片候选
export type VideoCandidateContent = ChatBaseContent<'videoCandidate', {
  bridgeCutId: number;
  videoUrl: string;
  durationMs: number;
  evaluatorScore: number;
  evaluatorFeedback?: string;
}>;
// PlayableAgent 产出的互动游戏包候选卡片
export type ContentCandidateContent = ChatBaseContent<'contentCandidate', {
  bridgeCutId: number;
  type: 'playableGame';
  previewUrl: string;
  ctaUrl?: string;
  evaluatorScore: number;
  evaluatorFeedback?: string;
  custom?: boolean; // 是否走了自定义玩法生成（LLM 现场写游戏代码），不是默认的翻牌配对
  fallback?: boolean; // 自定义生成失败，已回退到默认的翻牌配对
  fallbackReason?: string;
}>;
// M4: SupervisorAgent 落地前终审结果——真正的拦截判定，不是参考分
export type SupervisorResultContent = ChatBaseContent<'supervisorResult', {
  bridgeCutId: number;
  passed: boolean;
  contentCompliance: number;
  brandSafety: number;
  technicalSpec: number;
  issues: string[];
  feedback: string;
}>;
// M4: Assembler 组装完成后的最终交付物
export type ManifestContent = ChatBaseContent<'manifest', {
  manifestId: number;
  episodeId: number;
  creativePlanId: number;
  type: string;
  deliverableUrl: string;
  ctaUrl?: string;
}>;

// 聚合内容类型
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
export type ReasoningContent = ChatBaseContent<'reasoning', AIMessageContent[]>;
export type UserMessageContent = TextContent | AttachmentContent;

// 消息类型定义
export interface ChatBaseMessage {
  id: string;
  status?: ChatMessageStatus;
  datetime?: string;
  ext?: any;
}

export interface UserMessage extends ChatBaseMessage {
  role: 'user';
  content: UserMessageContent[];
}

export interface AIMessage extends ChatBaseMessage {
  role: 'assistant';
  content?: AIMessageContent[];
  history?: AIMessageContent[][];
  comment?: ChatComment;
}

export interface SystemMessage extends ChatBaseMessage {
  role: 'system';
  content: TextContent[];
}

export type ChatMessagesData = UserMessage | AIMessage | SystemMessage;