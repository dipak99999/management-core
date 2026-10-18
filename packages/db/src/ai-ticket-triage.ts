// Module 54 — Ticket triage prompt + response parser.
//
// Fired at DeskTicket create time. Uses the LLM to suggest priority
// + category + matching KB articles + a draft canned response.
// High-confidence suggestions (>= AUTO_APPLY_THRESHOLD) are applied
// to the ticket automatically; others are surfaced for the agent to
// review or accept.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export interface TicketTriageResponse {
  priority: "Urgent" | "High" | "Medium" | "Low";
  category: string | null;
  matchingArticleSlugs: string[];
  suggestedResponse: string | null;
  confidence: number; // 0-100
}

// Default threshold — applied when tenant hasn't overridden. 80 is a
// deliberate "high" bar so auto-apply is rare and mostly correct;
// operators can lower it once they trust the flow.
export const AUTO_APPLY_THRESHOLD = 80;

const TRIAGE_SYSTEM_PROMPT = `You triage inbound support tickets for an ERP helpdesk. Given a ticket's subject + body + the tenant's category list + a few candidate KB articles, return a structured JSON triage suggestion.

Rules:
* priority: pick one of Urgent | High | Medium | Low based on business impact + urgency language ("production down" → Urgent; "when possible" → Low).
* category: pick the best-fit category from the list provided; return null if none apply.
* matchingArticleSlugs: subset of provided article slugs that would help the customer resolve without agent time. Empty array if none.
* suggestedResponse: 1-3 sentence first response the agent could send. Empty string if the ticket needs human triage first.
* confidence: 0-100 self-assessment of how confident you are in the priority + category picks. Only set >= 80 when everything is clear-cut.

Return ONLY valid JSON. No commentary.`;

const TRIAGE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    priority: { type: "string", enum: ["Urgent", "High", "Medium", "Low"] },
    category: { type: ["string", "null"] },
    matchingArticleSlugs: { type: "array", items: { type: "string" } },
    suggestedResponse: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 100 },
  },
  required: ["priority", "matchingArticleSlugs", "confidence"],
};

export interface TicketTriageInput {
  provider: LLMProvider;
  subject: string;
  body: string;
  categories: string[];
  candidateArticles: Array<{ slug: string; title: string; tags: string[] }>;
  model?: string;
}

export async function triageTicketFromLLM(
  input: TicketTriageInput,
): Promise<LLMCallResult<TicketTriageResponse>> {
  const userContent =
    input.subject.startsWith("STUB_TRIAGE:")
      ? input.subject // Stub-mode passthrough for tests.
      : [
          `TICKET SUBJECT: ${input.subject}`,
          `TICKET BODY:\n${input.body}`,
          "",
          `AVAILABLE CATEGORIES: ${input.categories.length > 0 ? input.categories.join(", ") : "(none configured)"}`,
          "",
          input.candidateArticles.length > 0
            ? `CANDIDATE KB ARTICLES:\n${input.candidateArticles
                .map((a) => `  - ${a.slug} :: ${a.title} [tags: ${a.tags.join(", ")}]`)
                .join("\n")}`
            : "CANDIDATE KB ARTICLES: (none provided)",
        ].join("\n");

  const call: LLMCallInput = {
    system: TRIAGE_SYSTEM_PROMPT,
    user: userContent,
    responseSchema: TRIAGE_RESPONSE_SCHEMA,
    model: input.model,
    maxOutputTokens: 1000,
  };
  return input.provider.call<TicketTriageResponse>(call);
}

// Decides whether a triage suggestion is trustworthy enough to
// auto-apply (i.e., update the ticket row without agent review).
// Threshold is tenant-configurable; default AUTO_APPLY_THRESHOLD.
export function shouldAutoApply(
  suggestion: TicketTriageResponse,
  threshold: number = AUTO_APPLY_THRESHOLD,
): boolean {
  return suggestion.confidence >= threshold;
}
