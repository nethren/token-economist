import type { ScaleAssumptions } from "./types";
import { DEFAULT_ASSUMPTIONS } from "./types";

/**
 * Feature templates: one-click starters that prefill a realistic prompt AND
 * the scale-assumption shape that workflow actually has (RAG = retrieved
 * context per turn, agent = tool loops + reasoning, summarizer = batch).
 * The first screen should show a result, not a blank form — and "my feature
 * isn't one prompt" should have a starting answer.
 */

export interface FeaturePreset {
  id: string;
  /** Button label. */
  name: string;
  /** One-line description shown as a tooltip/hint. */
  blurb: string;
  featureName: string;
  prompt: string;
  assumptions: ScaleAssumptions;
}

export const CLASSIFIER_PROMPT = `You are a customer support ticket classifier.

Classify each incoming ticket into exactly one category: billing, technical, account, sales, abuse, other.
Respond with JSON only: {"category": string, "confidence": "high" | "low"}.

Example
Input: "I was charged twice for my subscription this month."
Output: {"category": "billing", "confidence": "high"}`;

const SUPPORT_BOT_PROMPT = `You are the support assistant for Acme, a project-management SaaS.

Answer the user's question about their account, billing, or how to use the product.
Rules:
- Be concise: 2-4 sentences unless the user asks for steps.
- If the question involves refunds over $100, account deletion, or legal topics, hand off: reply exactly "Let me connect you with a human agent." and stop.
- Never invent product features. If unsure, say you are unsure and link the docs at https://docs.acme.example.
- Ask at most one clarifying question before attempting an answer.`;

const RAG_ASSISTANT_PROMPT = `You are a documentation assistant. Answer strictly from the retrieved passages below; if the answer is not in them, say "I don't have that in the docs" and suggest the closest covered topic.

Cite the source section title after each claim in square brackets, e.g. [Billing / Invoices].
Keep answers under 150 words unless the user asks for a walkthrough.

Retrieved passages:
{{retrieved_passages}}  <!-- injected per request by the retriever -->`;

const AGENT_PROMPT = `You are an operations agent that resolves data-hygiene tasks in our CRM.

For each task, work step by step:
1. Use the search_records tool to find the records involved.
2. Use get_record to inspect candidates; decide merge / update / no-action.
3. Apply changes with update_record or merge_records. Never delete.
4. Finish with a one-paragraph summary of what changed and why.

Constraints: max 8 tool calls per task; if you can't resolve within that budget, stop and report what a human should check. Prefer no-action over risky writes.`;

const SUMMARIZER_PROMPT = `Summarize the provided document for a busy executive.

Output exactly three sections, in Markdown:
**TL;DR** - one sentence.
**Key points** - 3-5 bullets, each under 20 words, numbers preserved.
**Risks / open questions** - up to 3 bullets; write "none identified" if empty.

Do not add opinions or information that is not in the document.`;

export const PRESETS: FeaturePreset[] = [
  {
    id: "classifier",
    name: "Ticket classifier",
    blurb: "Single-shot classification: short JSON output, capped, cheap tiers usually pass.",
    featureName: "Support ticket classifier",
    prompt: CLASSIFIER_PROMPT,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 10_000,
      avgUserInputTokens: 150,
      turnsPerConversation: 1,
      expectedOutputTokens: 30,
      maxOutputTokens: 100,
    },
  },
  {
    id: "support-bot",
    name: "Support chatbot",
    blurb: "Multi-turn chat: history resend dominates, static prefix cached.",
    featureName: "Support chatbot",
    prompt: SUPPORT_BOT_PROMPT,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 20_000,
      avgUserInputTokens: 80,
      turnsPerConversation: 4,
      expectedOutputTokens: 180,
      maxOutputTokens: 400,
      useCaching: true,
    },
  },
  {
    id: "rag-assistant",
    name: "RAG assistant",
    blurb: "Retrieval per turn: the retrieved passages are modeled as tool-call tokens.",
    featureName: "Docs RAG assistant",
    prompt: RAG_ASSISTANT_PROMPT,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 15_000,
      avgUserInputTokens: 60,
      turnsPerConversation: 2,
      expectedOutputTokens: 200,
      maxOutputTokens: 500,
      toolCallsPerTurn: 1,
      tokensPerToolCall: 1500,
      useCaching: true,
    },
  },
  {
    id: "agent",
    name: "Agent / workflow",
    blurb: "Tool loops + thinking: several tool calls and hidden reasoning tokens per task.",
    featureName: "CRM data-hygiene agent",
    prompt: AGENT_PROMPT,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 2_000,
      avgUserInputTokens: 200,
      turnsPerConversation: 1,
      expectedOutputTokens: 400,
      maxOutputTokens: 1_000,
      toolCallsPerTurn: 6,
      tokensPerToolCall: 700,
      reasoningTokensPerTurn: 2_000,
      retryRate: 0.05,
    },
  },
  {
    id: "summarizer",
    name: "Summarizer",
    blurb: "Long input, short output, non-interactive: Batch API halves the bill.",
    featureName: "Document summarizer",
    prompt: SUMMARIZER_PROMPT,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      requestsPerMonth: 5_000,
      avgUserInputTokens: 6_000,
      turnsPerConversation: 1,
      expectedOutputTokens: 250,
      maxOutputTokens: 400,
      useBatch: true,
    },
  },
];
