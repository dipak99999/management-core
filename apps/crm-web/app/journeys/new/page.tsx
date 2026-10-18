"use client";

// New-journey form. Captures name + description + triggerType + optional
// triggerConfig (list/form/tag id). POSTs to /journeys and redirects to the
// builder for the new record so the user can lay out the graph immediately.

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  Toast,
} from "../../../components/ui";

type TriggerType =
  | "Manual"
  | "ListAdd"
  | "LeadCreated"
  | "FormSubmit"
  | "TagAdded"
  | "ScheduledDate";

const TRIGGER_OPTIONS: { value: TriggerType; label: string; description: string }[] = [
  { value: "Manual", label: "Manual", description: "Enroll contacts one-by-one via the API or UI." },
  { value: "ListAdd", label: "On list add", description: "When a contact is added to the selected list." },
  { value: "LeadCreated", label: "On lead created", description: "When a new lead is captured." },
  { value: "FormSubmit", label: "On form submit", description: "When a specific web form is submitted." },
  { value: "TagAdded", label: "On tag added", description: "When a specific tag is applied to a contact." },
  { value: "ScheduledDate", label: "On scheduled date", description: "One-shot enrollment on a chosen date." },
];

interface ContactList {
  id: string;
  name: string;
}
interface WebForm {
  id: string;
  name: string;
}

export default function NewJourneyPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<TriggerType>("Manual");
  const [triggerListId, setTriggerListId] = useState("");
  const [triggerFormId, setTriggerFormId] = useState("");
  const [triggerTag, setTriggerTag] = useState("");
  const [triggerDate, setTriggerDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [lists, setLists] = useState<ContactList[]>([]);
  const [forms, setForms] = useState<WebForm[]>([]);

  // Smart defaults: operators building multiple journeys usually reuse the
  // same trigger type (e.g. ListAdd) across experiments. Pre-fill.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ triggerType: TriggerType }>(
    "crm-web:journey-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (smart.last?.triggerType) setTriggerType(smart.last.triggerType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.triggerType]);

  useEffect(() => {
    api.get<ContactList[]>("/contact-lists").then(setLists).catch(() => {});
    api.get<WebForm[]>("/web-forms").then(setForms).catch(() => {});
  }, []);

  function buildTriggerConfig(): Record<string, unknown> | undefined {
    if (triggerType === "ListAdd" && triggerListId) return { listId: triggerListId };
    if (triggerType === "FormSubmit" && triggerFormId) return { formId: triggerFormId };
    if (triggerType === "TagAdded" && triggerTag.trim()) return { tagName: triggerTag.trim() };
    if (triggerType === "ScheduledDate" && triggerDate) return { scheduledFor: triggerDate };
    return undefined;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // Seed the graph with a single trigger node so the builder opens ready
      // to extend rather than empty. The backend accepts nodesJson/edgesJson.
      const triggerNode = {
        id: `trigger_${Date.now().toString(36)}`,
        type: "journey",
        position: { x: 250, y: 60 },
        data: { kind: "trigger", label: TRIGGER_OPTIONS.find((t) => t.value === triggerType)?.label ?? "Trigger" },
      };
      const created = await api.post<{ id: string }>("/journeys", {
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType,
        triggerConfig: buildTriggerConfig(),
        nodesJson: [triggerNode],
        edgesJson: [],
      });
      smart.remember({ triggerType });
      window.location.href = `/crm/journeys/${created.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create journey");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New journey"
        subtitle="Give the journey a name and pick how contacts get enrolled."
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Journeys", href: "/crm/journeys" },
          { label: "New" },
        ]}
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card className="p-6 max-w-2xl">
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              autoFocus
              className="input"
              placeholder="Trial nurture, Winback, Welcome series…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          {showAdvanced && (
            <FormField label="Description">
              <textarea
                className="input"
                rows={3}
                placeholder="Optional — what this journey is for"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          )}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-ink-muted hover:text-ink-soft transition-colors"
            >
              {showAdvanced ? "− Hide" : "+ Add"} description
            </button>
          </div>

          <FormField label="Trigger" hint="How contacts enter the journey">
            <select
              className="input"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as TriggerType)}
            >
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-ink-muted mt-1">
              {TRIGGER_OPTIONS.find((t) => t.value === triggerType)?.description}
            </p>
          </FormField>

          {triggerType === "ListAdd" && (
            <FormField label="Contact list" required>
              <select
                required
                className="input"
                value={triggerListId}
                onChange={(e) => setTriggerListId(e.target.value)}
              >
                <option value="">Select a list…</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {triggerType === "FormSubmit" && (
            <FormField label="Web form" required>
              <select
                required
                className="input"
                value={triggerFormId}
                onChange={(e) => setTriggerFormId(e.target.value)}
              >
                <option value="">Select a form…</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {triggerType === "TagAdded" && (
            <FormField label="Tag name" required>
              <input
                required
                className="input"
                placeholder="e.g. hot-lead"
                value={triggerTag}
                onChange={(e) => setTriggerTag(e.target.value)}
              />
            </FormField>
          )}

          {triggerType === "ScheduledDate" && (
            <FormField label="Enroll on" required>
              <input
                required
                type="datetime-local"
                className="input"
                value={triggerDate}
                onChange={(e) => setTriggerDate(e.target.value)}
              />
            </FormField>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => history.back()}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button variant="brand" type="submit" disabled={saving || !name.trim()}>
              {saving ? "Creating…" : "Create & open builder"}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
