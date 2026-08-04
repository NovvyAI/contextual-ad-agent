// 从 Toonflow-web 的 src/utils/useChat.ts 移植，去掉了 XML 标签解析那套侧信道逻辑——
// 我们的业务数据都通过正规的 content:add/content:update 事件传递，不需要从 markdown/text 里
// 再解析嵌入的 XML 标签。保留的是协议层逻辑：连接管理、message/content:add/content:update/
// message:update 四个事件的处理、消息状态维护。
import { ref, shallowRef, onMounted, onUnmounted, computed } from "vue";
import { io, Socket } from "socket.io-client";
import type { ChatMessagesData, AIMessage, UserMessage, AIMessageContent, ChatMessageStatus } from "@/types/chatMessagesData";

export interface MessageEvent {
  id: string;
  role: "assistant" | "user" | "system";
  name?: string;
  status: ChatMessageStatus;
  datetime: string;
  content: any[];
  ext?: Record<string, any>;
}

export interface MessageUpdateEvent {
  id: string;
  status?: ChatMessageStatus;
  ext?: Record<string, any>;
}

export interface ContentAddEvent {
  messageId: string;
  content: AIMessageContent;
}

export interface ContentUpdateEvent {
  messageId: string;
  contentId: string;
  type: string;
  data?: any;
  strategy?: "merge" | "append";
  status?: ChatMessageStatus;
}

export interface ChatSocketEvents {
  chat: { content: string };
  stop: Record<string, never>;

  message: MessageEvent;
  "message:update": MessageUpdateEvent;
  "content:add": ContentAddEvent;
  "content:update": ContentUpdateEvent;
}

export interface UseChatOptions {
  url: string;
  auth?: Record<string, any> | (() => Record<string, any>);
  autoConnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  manageLifecycle?: boolean;
}

export function useChat(options: UseChatOptions) {
  const { url, auth, autoConnect = true, onConnect, onDisconnect, manageLifecycle = true } = options;

  const socket = shallowRef<Socket | null>(null);
  const connected = ref(false);
  const connecting = ref(false);
  const messages = ref<ChatMessagesData[]>([]);
  const currentMessageId = ref<string | null>(null);
  const status = ref<"idle" | "pending" | "streaming">("idle");

  const isGenerating = computed(() => {
    const lastMsg = messages.value[messages.value.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return false;
    const s = lastMsg.status;
    if (s === "pending" || s === "streaming") return true;
    const aiMsg = lastMsg as AIMessage;
    return aiMsg.content?.some((c) => c.status === "pending" || c.status === "streaming") ?? false;
  });

  const lastMessage = computed(() => messages.value[messages.value.length - 1]);

  const findMessage = (id: string): ChatMessagesData | undefined => messages.value.find((m) => m.id === id);
  const findMessageIndex = (id: string): number => messages.value.findIndex((m) => m.id === id);
  const findContent = (msg: AIMessage, contentId: string): AIMessageContent | undefined => msg.content?.find((c) => c.id === contentId);

  const isEmptyMessageContent = (msg: ChatMessagesData | undefined): boolean => {
    if (!msg || msg.role !== "assistant") return false;
    const aiMsg = msg as AIMessage;
    if (!aiMsg.content || aiMsg.content.length === 0) return true;
    return aiMsg.content.every((item) => {
      if (item.data === null || item.data === undefined) return true;
      if (typeof item.data === "string") return item.data.trim() === "";
      return false;
    });
  };

  const deepMerge = <T extends Record<string, any>>(target: T, source: Partial<T>): T => {
    if (typeof source !== "object" || source === null) return source as T;
    const result: Record<string, any> = { ...target };
    for (const key in source) {
      const sourceVal = source[key];
      const targetVal = result[key];
      if (Array.isArray(sourceVal)) {
        result[key] = [...(Array.isArray(targetVal) ? targetVal : []), ...sourceVal];
      } else if (typeof sourceVal === "object" && sourceVal !== null) {
        const base = typeof targetVal === "object" && targetVal !== null ? targetVal : {};
        result[key] = deepMerge(base as Record<string, any>, sourceVal as Record<string, any>);
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
    return result as T;
  };

  const appendStringData = (content: AIMessageContent, delta: string) => {
    if (typeof content.data === "string") {
      content.data += delta;
    } else if (typeof content.data === "object" && content.data !== null) {
      if ("text" in content.data && typeof delta === "string") {
        (content.data as any).text = ((content.data as any).text || "") + delta;
      }
    }
  };

  const handleContentUpdate = (event: ContentUpdateEvent) => {
    const { messageId, contentId, data, strategy, status: eventStatus } = event;
    const msg = findMessage(messageId) as AIMessage;
    if (!msg || msg.role !== "assistant") return;
    const content = findContent(msg, contentId);
    if (!content) return;

    if (eventStatus) content.status = eventStatus;

    if (eventStatus === "streaming" || (strategy === "append" && data)) {
      if (msg.status === "pending") msg.status = "streaming";
      if (currentMessageId.value === messageId) status.value = "streaming";
    }

    if (data === undefined || data === null) return;

    if (strategy === "append") {
      if (typeof data === "string") appendStringData(content, data);
      else if (typeof data === "object") content.data = deepMerge(content.data as any, data);
    } else {
      if (typeof content.data === "object" && typeof data === "object") content.data = { ...content.data, ...data };
      else content.data = data;
    }

    if (!eventStatus && strategy === "append") content.status = "streaming";
  };

  const removeMessage = (id: string) => {
    const idx = findMessageIndex(id);
    if (idx > -1) messages.value.splice(idx, 1);
  };

  // 下面四个 handleXxx 是处理 message/message:update/content:add/content:update 四类协议事件的
  // reducer，既用来处理实时 socket 事件，也用来重放历史（hydrateHistory）——两条路径必须是同一份
  // 逻辑，不然聊天记录持久化重建出来的样子会和当时实时看到的不一致。
  const handleMessage = (data: MessageEvent) => {
    const newMessage: ChatMessagesData = {
      id: data.id,
      role: data.role,
      name: data.name,
      status: data.status || "pending",
      datetime: data.datetime,
      content: data.content || [],
      ext: data.ext,
    } as ChatMessagesData;

    if (newMessage.status === "complete" && isEmptyMessageContent(newMessage)) return;

    messages.value.push(newMessage);

    if (data.role === "assistant") {
      currentMessageId.value = data.id;
      status.value = data.status === "streaming" ? "streaming" : "pending";
    }
  };

  const handleMessageUpdate = (data: MessageUpdateEvent) => {
    const msg = findMessage(data.id);
    if (!msg) return;
    if (data.status) msg.status = data.status;
    if (data.ext) msg.ext = { ...msg.ext, ...data.ext };

    if (data.status === "complete" && isEmptyMessageContent(msg)) {
      removeMessage(data.id);
      if (currentMessageId.value === data.id) {
        currentMessageId.value = null;
        status.value = "idle";
      }
      return;
    }

    if (data.status === "streaming") status.value = "streaming";

    if (data.status === "complete" || data.status === "error" || data.status === "stop") {
      if (currentMessageId.value === data.id) {
        currentMessageId.value = null;
        status.value = "idle";
      }
    }
  };

  const handleContentAdd = (data: ContentAddEvent) => {
    const msg = findMessage(data.messageId) as AIMessage;
    if (!msg || msg.role !== "assistant") return;
    if (!msg.content) msg.content = [];

    const content = {
      ...data.content,
      status: data.content.status || "pending",
      ...(data.content.type === "thinking" ? { ext: { collapsed: true, ...data.content.ext } } : {}),
    };

    if (content.type === "thinking") {
      const firstNonThinkingIndex = msg.content.findIndex((c: any) => c.type !== "thinking");
      if (firstNonThinkingIndex === -1) msg.content.push(content);
      else msg.content.splice(firstNonThinkingIndex, 0, content);
    } else {
      msg.content.push(content);
    }

    if (content.status === "streaming" && msg.status === "pending") msg.status = "streaming";
  };

  const setupHandlers = () => {
    if (!socket.value) return;

    socket.value.on("message", handleMessage);
    socket.value.on("message:update", handleMessageUpdate);
    socket.value.on("content:add", handleContentAdd);
    socket.value.on("content:update", handleContentUpdate);

    socket.value.on("connect", () => {
      connected.value = true;
      connecting.value = false;
      onConnect?.();
    });

    socket.value.on("disconnect", (reason) => {
      connected.value = false;
      connecting.value = false;
      onDisconnect?.();
      console.log("[Chat Disconnected]", reason);
    });

    socket.value.on("connect_error", (error) => {
      connected.value = false;
      connecting.value = false;
      console.error("[Chat Connect Error]", error);
    });
  };

  const connect = () => {
    if (socket.value?.connected || connecting.value) return;
    connecting.value = true;

    if (!socket.value) {
      socket.value = io(url, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        auth: { token: localStorage.getItem("token"), ...(typeof auth === "function" ? auth() : auth) },
      });
      setupHandlers();
    } else {
      socket.value.connect();
    }
  };

  const disconnect = () => {
    socket.value?.disconnect();
    connected.value = false;
    connecting.value = false;
  };

  const emit = <E extends keyof ChatSocketEvents & string>(event: E, data?: ChatSocketEvents[E]) => {
    if (!socket.value?.connected) {
      console.warn("[Chat] Socket not connected");
      return false;
    }
    socket.value.emit(event, data);
    return true;
  };

  const chat = (content: string) => {
    if (!content.trim()) return false;

    const userMessage: UserMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      status: "complete",
      datetime: new Date().toISOString(),
      content: [{ type: "text", data: content, status: "complete" }],
    };
    messages.value.push(userMessage);

    return emit("chat", { content });
  };

  const stopGenerate = () => {
    const id = currentMessageId.value;
    const msg = id ? findMessage(id) : undefined;
    if (msg) msg.status = "stop";
    currentMessageId.value = null;
    status.value = "idle";
    return emit("stop", {});
  };

  const clearMessages = () => {
    messages.value = [];
    currentMessageId.value = null;
    status.value = "idle";
  };

  /**
   * 用持久化的历史事件重建聊天面板——按落库顺序把 message/message:update/content:add/content:update
   * 四类事件喂给和处理实时事件完全相同的 handler，不用另外维护一套"最终状态长什么样"的拼装规则。
   * 必须在 connect() 之前调用（页面加载时先拉历史、回放完再连 socket），不然历史回放和刚连上就可能
   * 到来的实时事件会交错，顺序就乱了。
   */
  const hydrateHistory = (events: { eventType: string; payload: any }[]) => {
    for (const event of events) {
      switch (event.eventType) {
        case "message":
          handleMessage(event.payload as MessageEvent);
          break;
        case "message:update":
          handleMessageUpdate(event.payload as MessageUpdateEvent);
          break;
        case "content:add":
          handleContentAdd(event.payload as ContentAddEvent);
          break;
        case "content:update":
          handleContentUpdate(event.payload as ContentUpdateEvent);
          break;
      }
    }

    // 回放完之后最后一条消息如果还卡在 pending/streaming，说明上次生成中途服务器重启/异常退出了，
    // 从来没有真正 complete/error 过——不主动纠正的话 isGenerating 会一直读到这个假的"生成中"状态，
    // 界面会显示"停止"按钮，但背后根本没有真实请求在跑
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && (lastMsg.status === "pending" || lastMsg.status === "streaming")) {
      lastMsg.status = "error";
      (lastMsg as any).ext = { ...(lastMsg as any).ext, error: "连接中断，未能生成完整回复" };
    }

    currentMessageId.value = null;
    status.value = "idle";
  };

  if (manageLifecycle) {
    onMounted(() => {
      if (autoConnect) connect();
    });
    onUnmounted(() => {
      disconnect();
      socket.value?.removeAllListeners();
      socket.value = null;
    });
  } else if (autoConnect) {
    connect();
  }

  return {
    socket,
    connected,
    connecting,
    status,
    messages,
    currentMessageId,
    isGenerating,
    lastMessage,
    connect,
    disconnect,
    emit,
    chat,
    stopGenerate,
    clearMessages,
    removeMessage,
    findMessage,
    hydrateHistory,
  };
}

export type UseChatReturn = ReturnType<typeof useChat>;
