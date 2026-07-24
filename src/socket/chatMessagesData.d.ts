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
  formatSequence: string[];
  narrative: string;
  tone: string;
  planEvaluatorScore: number;
  status: 'draft' | 'approved' | 'rejected';
  evaluatorFeedback?: { narrativeFeasibility: number; formatFit: number; adAlignment: number; feedback: string };
}>;
// M3: BridgeVideoAgent Stage A 分镜草案卡片（逐张 review，"只重画这一张"revise 的对象）
export type StoryboardCutContent = ChatBaseContent<'storyboardCut', {
  bridgeCutId: number;
  index: number;
  imageUrl: string;
  prompt: string;
  status: 'draft' | 'draftConfirmed';
  evaluatorScore: number;
  evaluatorFeedback?: string;
}>;
// M3: BridgeVideoAgent Stage B 渲染成片候选
export type VideoCandidateContent = ChatBaseContent<'videoCandidate', {
  bridgeCutId: number;
  videoUrl: string;
  durationMs: number;
  evaluatorScore: number;
  evaluatorFeedback?: string;
}>;
// M3: PlayableAgent/OverlayAgent 共用的候选卡片（互动游戏包 / CTA 卡片）
export type ContentCandidateContent = ChatBaseContent<'contentCandidate', {
  bridgeCutId: number;
  type: 'playableGame' | 'ctaCard';
  previewUrl: string;
  ctaUrl?: string;
  evaluatorScore: number;
  evaluatorFeedback?: string;
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
  | ContentCandidateContent;
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