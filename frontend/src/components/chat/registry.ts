import type { Component } from "vue";
import type { AIMessageContent } from "@/types/chatMessagesData";
import TextContent from "./content/TextContent.vue";
import MarkdownContent from "./content/MarkdownContent.vue";
import ThinkingContent from "./content/ThinkingContent.vue";
import GenericContent from "./content/GenericContent.vue";
import PlanCandidateCard from "./content/PlanCandidateCard.vue";
import StoryboardCutCard from "./content/StoryboardCutCard.vue";
import VideoCandidateCard from "./content/VideoCandidateCard.vue";
import ContentCandidateCard from "./content/ContentCandidateCard.vue";
import SupervisorResultCard from "./content/SupervisorResultCard.vue";
import ManifestCard from "./content/ManifestCard.vue";

export const contentRegistry: Record<AIMessageContent["type"] | "attachment", Component> = {
  text: TextContent,
  markdown: MarkdownContent,
  thinking: ThinkingContent,
  image: GenericContent,
  attachment: GenericContent,
  search: GenericContent,
  suggestion: GenericContent,
  toolcall: GenericContent,
  activity: GenericContent,
  reasoning: GenericContent,
  planCandidate: PlanCandidateCard,
  storyboardCut: StoryboardCutCard,
  videoCandidate: VideoCandidateCard,
  contentCandidate: ContentCandidateCard,
  supervisorResult: SupervisorResultCard,
  manifest: ManifestCard,
};
