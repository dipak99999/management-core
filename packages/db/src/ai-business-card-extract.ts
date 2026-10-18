// AI extraction: business card photo → CRM lead shape.
//
// Mirrors ai-invoice-extract.ts / ai-receipt-extract.ts.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export interface ExtractedBusinessCard {
  // Person
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  // Company
  companyName: string | null;
  companyWebsite: string | null;
  companyIndustry: string | null; // free-form; LLM best-guess
  // Contact
  email: string | null;
  mobile: string | null;
  phone: string | null; // landline
  address: string | null;
  linkedinUrl: string | null;
  // Notes — the LLM can note anything odd it saw (tag line, department,
  // multiple emails/phones). Appended to the Lead's remarks.
  notes: string;
}

const CARD_SYSTEM_PROMPT = `You are a business-card scanner for a CRM. Given a business card (image or OCR text), extract the person + company contact details into strict JSON matching the schema.

Rules:
* firstName / lastName: split the full name sensibly. If only a single name is printed, put it in firstName and leave lastName null. For names with 3+ parts (e.g. "Maria del Carmen García"), put the final word in lastName and the rest in firstName.
* jobTitle: role as printed. Null if the card has no title.
* companyName: the business entity. Not the chain parent (e.g. "Mastercard" not "Mastercard International Inc.").
* companyWebsite: URL. Prepend "https://" if the card shows just a domain. Null if none.
* companyIndustry: best-guess from the role + company name. Short free-form (e.g. "fintech", "law firm", "logistics").
* email: use the first business email if multiple are listed.
* mobile: prefer the one labelled "M:" / "mobile" / "cell". International format (+countrycode) if visible.
* phone: landline if separate from mobile. Null if the only number is clearly a mobile.
* address: concatenated street + city + state + country as a single line.
* linkedinUrl: full URL or just the handle (we accept both).
* notes: anything you noticed that doesn't fit the above — tag lines, multiple departments listed, membership logos, etc. Keep ≤ 30 words.

If a field is genuinely missing, use null. For \`notes\`, use empty string if nothing to add.

Return ONLY valid JSON matching the schema. No commentary.`;

const CARD_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    firstName:       { type: ["string", "null"] },
    lastName:        { type: ["string", "null"] },
    jobTitle:        { type: ["string", "null"] },
    companyName:     { type: ["string", "null"] },
    companyWebsite:  { type: ["string", "null"] },
    companyIndustry: { type: ["string", "null"] },
    email:           { type: ["string", "null"] },
    mobile:          { type: ["string", "null"] },
    phone:           { type: ["string", "null"] },
    address:         { type: ["string", "null"] },
    linkedinUrl:     { type: ["string", "null"] },
    notes:           { type: "string" },
  },
  required: ["notes"],
};

export interface BusinessCardExtractInput {
  provider: LLMProvider;
  sourceText?: string;
  attachment?: { mimeType: string; base64Data: string };
  model?: string;
}

export async function extractBusinessCardFromLLM(
  input: BusinessCardExtractInput,
): Promise<LLMCallResult<ExtractedBusinessCard>> {
  const call: LLMCallInput = {
    system: CARD_SYSTEM_PROMPT,
    user: input.sourceText ?? "See attached business card.",
    attachments: input.attachment ? [input.attachment] : undefined,
    responseSchema: CARD_RESPONSE_SCHEMA,
    model: input.model,
    maxOutputTokens: 800,
  };
  return input.provider.call<ExtractedBusinessCard>(call);
}

// Validation: at minimum we need SOMETHING to identify the person
// (name OR email OR mobile). An empty extraction = unusable card.
export function validateExtractedBusinessCard(c: ExtractedBusinessCard | Record<string, unknown>): string[] {
  const warnings: string[] = [];
  if (!c || typeof c !== "object" || !("firstName" in c || "email" in c || "mobile" in c)) {
    return ["Business card could not be read. Configure an AI provider in Settings → AI, or fill the fields manually."];
  }
  const card = c as ExtractedBusinessCard;
  if (!card.firstName && !card.lastName && !card.email && !card.mobile) {
    warnings.push("Could not identify any name, email, or phone — card may be illegible or an unusual format.");
  }
  if (card.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(card.email)) {
    warnings.push(`Extracted email "${card.email}" doesn't look valid — double-check before saving.`);
  }
  return warnings;
}
