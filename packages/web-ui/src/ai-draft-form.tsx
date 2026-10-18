"use client";

import { useState } from "react";
import { AIDiffModal, AISlashInput, useSaveAsRule, type AIDiff, type SlashCommand } from "./ai";
import { useOptionalUIBackends } from "./backends";

/**
 * Generic AI-draft slash input + diff modal for any create form. The
 * caller supplies:
 *   - `scope`     — a stable key for save-as-rule bucket, e.g. "po-draft"
 *   - `before`    — serialized current form state passed to the AI
 *   - `fields`    — allowlist of field names the AI should populate
 *   - `doctypeHint` — short description of what the form represents
 *   - `apply`     — function that receives the resolved patch
 *   - `post`      — the auth-service POST client (shared / per-app)
 *
 * This keeps each app's `components/ai-<doctype>-draft.tsx` down to a
 * thin shell that only knows how to translate `AIDiff.rows` into the
 * form's actual state setters.
 */
export function AiDraftForm({
  scope,
  before,
  fields,
  doctypeHint,
  placeholder,
  apply,
  post,
}: {
  scope: string;
  before: Record<string, unknown>;
  fields: string[];
  doctypeHint: string;
  placeholder?: string;
  apply: (rows: AIDiff["rows"]) => void;
  post: <T>(path: string, body: unknown) => Promise<T>;
}) {
  const [diff, setDiff] = useState<AIDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backends = useOptionalUIBackends();
  const { saveRule } = useSaveAsRule<AIDiff>(scope, backends?.rules);

  const commands: SlashCommand[] = [
    {
      prefix: "/ai",
      description: "Draft this form from a natural-language description",
      run: async (prompt: string) => {
        setError(null);
        setBusy(true);
        try {
          const result = await post<AIDiff & { costUsd?: number; model?: string }>(
            "/ai/draft",
            { prompt, scope, before, fields, doctypeHint },
          );
          setDiff(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : "AI draft failed");
        } finally {
          setBusy(false);
        }
      },
    },
  ];

  return (
    <div className="mb-4 space-y-2">
      <AISlashInput
        commands={commands}
        placeholder={placeholder ?? "Type /ai to draft this form"}
      />
      {busy && <p className="text-xs text-ink-muted">Drafting with AI…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <AIDiffModal
        open={!!diff}
        onClose={() => setDiff(null)}
        diff={diff}
        onApprove={(edited) => {
          apply(edited.rows);
          setDiff(null);
        }}
        onReject={() => setDiff(null)}
        onSaveAsRule={async (name, b, a) => {
          await saveRule(name, b, a);
        }}
      />
    </div>
  );
}
