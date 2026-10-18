"use client";

// Right-side config panel for the selected journey node. Renders a different
// form per node kind, and calls onChange with the updated `data` blob.
// Deletes the node via onDelete (except trigger — a journey must have one).
//
// Template + list fetches are fire-and-forget: if the endpoint doesn't exist
// (WhatsApp templates, email templates) we degrade to a free-form input.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, FormField } from "./ui";
import { nodeKindMeta, type NodeKind } from "./journey-node-palette";

// Whitelisted contact fields for the Branch node. Mirrors the segmentation
// DSL's allowed field list — never accept a raw column name from the user.
export const BRANCH_FIELDS = [
  { value: "email", label: "Email" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "customerGroup", label: "Customer group" },
  { value: "territory", label: "Territory" },
  { value: "tags", label: "Tags" },
  { value: "country", label: "Country" },
  { value: "language", label: "Language" },
];

export const BRANCH_OPS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "notContains", label: "does not contain" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "isSet", label: "is set" },
  { value: "isNotSet", label: "is not set" },
];

interface EmailTemplate {
  id: string;
  name: string;
  subject?: string | null;
}
interface SmsTemplate {
  id: string;
  name: string;
  body?: string | null;
}
interface WhatsappTemplate {
  id: string;
  name: string;
  status?: string;
}
interface ContactList {
  id: string;
  name: string;
}

export interface JourneyNodeData {
  kind: NodeKind;
  label?: string;
  [key: string]: unknown;
}

export interface JourneyNodeConfigProps {
  node: { id: string; data: JourneyNodeData } | null;
  onChange: (id: string, nextData: JourneyNodeData) => void;
  onDelete: (id: string) => void;
}

export function JourneyNodeConfig({ node, onChange, onDelete }: JourneyNodeConfigProps) {
  // Cached remote lookups. Each endpoint is loaded once per mount; failures
  // degrade silently (empty list → free-form input path).
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[] | null>(null);
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplate[] | null>(null);
  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsappTemplate[] | null>(null);
  const [contactLists, setContactLists] = useState<ContactList[] | null>(null);

  useEffect(() => {
    api.get<EmailTemplate[]>("/email-templates").then(setEmailTemplates).catch(() => setEmailTemplates([]));
    api.get<SmsTemplate[]>("/sms-templates").then(setSmsTemplates).catch(() => setSmsTemplates([]));
    api.get<WhatsappTemplate[]>("/whatsapp/templates").then(setWhatsappTemplates).catch(() => setWhatsappTemplates([]));
    api.get<ContactList[]>("/contact-lists").then(setContactLists).catch(() => setContactLists([]));
  }, []);

  if (!node) {
    return (
      <div className="p-4 text-xs text-ink-muted">
        Select a node on the canvas to edit its configuration.
      </div>
    );
  }

  const meta = nodeKindMeta(node.data.kind);
  if (!meta) {
    return <div className="p-4 text-xs text-red-600">Unknown node kind: {String(node.data.kind)}</div>;
  }

  // Type-narrowed shorthand for updating a single field on this node's data.
  function set<K extends string>(key: K, value: unknown) {
    if (!node) return;
    onChange(node.id, { ...node.data, [key]: value });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-ink-muted/10 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className={`w-7 h-7 rounded-md grid place-items-center shrink-0 ${meta.tint}`}>
            {meta.icon}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink truncate">{meta.label}</div>
            <div className="text-[10px] text-ink-muted">Node config</div>
          </div>
        </div>
        {node.data.kind !== "trigger" && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onDelete(node.id)}
            className="text-red-600 hover:text-red-700"
          >
            Delete
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <FormField label="Label" hint="Shown on the canvas node">
          <input
            className="input"
            value={(node.data.label as string) ?? ""}
            placeholder={meta.label}
            onChange={(e) => set("label", e.target.value)}
          />
        </FormField>

        {node.data.kind === "trigger" && (
          <p className="text-xs text-ink-muted">
            The trigger fires based on the journey&apos;s trigger type
            (configured on the journey itself, not per-node).
          </p>
        )}

        {node.data.kind === "exit" && (
          <p className="text-xs text-ink-muted">
            The contact&apos;s enrollment is marked <b>Completed</b> when it
            reaches this node.
          </p>
        )}

        {node.data.kind === "wait" && (
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Amount" required>
              <input
                type="number"
                min={1}
                className="input"
                value={Number(node.data.amount ?? 1)}
                onChange={(e) => set("amount", Math.max(1, Number(e.target.value) || 1))}
              />
            </FormField>
            <FormField label="Unit">
              <select
                className="input"
                value={(node.data.unit as string) ?? "day"}
                onChange={(e) => set("unit", e.target.value)}
              >
                <option value="min">Minutes</option>
                <option value="hour">Hours</option>
                <option value="day">Days</option>
              </select>
            </FormField>
          </div>
        )}

        {node.data.kind === "sendEmail" && (
          <>
            <FormField label="Template" hint={emailTemplates?.length ? undefined : "No templates found — override below"}>
              <select
                className="input"
                value={(node.data.templateId as string) ?? ""}
                onChange={(e) => set("templateId", e.target.value)}
                disabled={!emailTemplates?.length}
              >
                <option value="">(no template — use overrides)</option>
                {(emailTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Subject override" hint="Leave blank to use the template subject">
              <input
                className="input"
                value={(node.data.subject as string) ?? ""}
                onChange={(e) => set("subject", e.target.value)}
              />
            </FormField>
            <FormField label="Body override (HTML)" hint="Supports {{firstName}} merge vars">
              <textarea
                className="input font-mono text-xs"
                rows={10}
                value={(node.data.body as string) ?? ""}
                onChange={(e) => set("body", e.target.value)}
              />
            </FormField>
          </>
        )}

        {node.data.kind === "sendSms" && (
          <>
            <FormField label="Template" hint={smsTemplates?.length ? undefined : "No SMS templates — free-form body only"}>
              <select
                className="input"
                value={(node.data.templateId as string) ?? ""}
                onChange={(e) => set("templateId", e.target.value)}
                disabled={!smsTemplates?.length}
              >
                <option value="">(no template)</option>
                {(smsTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Body">
              <textarea
                className="input"
                rows={4}
                maxLength={480}
                value={(node.data.body as string) ?? ""}
                onChange={(e) => set("body", e.target.value)}
              />
            </FormField>
          </>
        )}

        {node.data.kind === "sendWhatsapp" && (
          <>
            <FormField label="Template" hint={whatsappTemplates?.length ? undefined : "No WABA templates registered yet"}>
              <select
                className="input"
                value={(node.data.templateId as string) ?? ""}
                onChange={(e) => set("templateId", e.target.value)}
                disabled={!whatsappTemplates?.length}
              >
                <option value="">(select a template)</option>
                {(whatsappTemplates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.status && t.status !== "APPROVED" ? ` (${t.status})` : ""}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label="Variables (comma-separated)"
              hint="Positional {{1}}, {{2}}, ... substitution values"
            >
              <input
                className="input"
                value={((node.data.variables as string[]) ?? []).join(", ")}
                onChange={(e) =>
                  set(
                    "variables",
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </FormField>
          </>
        )}

        {(node.data.kind === "addToList" || node.data.kind === "removeFromList") && (
          <FormField
            label="Contact list"
            required
            hint={contactLists?.length ? undefined : "No contact lists — create one first"}
          >
            <select
              required
              className="input"
              value={(node.data.listId as string) ?? ""}
              onChange={(e) => set("listId", e.target.value)}
            >
              <option value="">Select a list…</option>
              {(contactLists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {node.data.kind === "updateContact" && (
          <>
            <FormField label="Attribute" required hint="e.g. status, lifecycleStage, customerGroup">
              <input
                required
                className="input"
                value={(node.data.attribute as string) ?? ""}
                onChange={(e) => set("attribute", e.target.value)}
              />
            </FormField>
            <FormField label="Value">
              <input
                className="input"
                value={(node.data.value as string) ?? ""}
                onChange={(e) => set("value", e.target.value)}
              />
            </FormField>
          </>
        )}

        {node.data.kind === "branch" && (
          <>
            <FormField label="Field" required>
              <select
                className="input"
                value={(node.data.field as string) ?? "email"}
                onChange={(e) => set("field", e.target.value)}
              >
                {BRANCH_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Operator">
              <select
                className="input"
                value={(node.data.op as string) ?? "contains"}
                onChange={(e) => set("op", e.target.value)}
              >
                {BRANCH_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
            {node.data.op !== "isSet" && node.data.op !== "isNotSet" && (
              <FormField label="Value">
                <input
                  className="input"
                  value={(node.data.value as string) ?? ""}
                  onChange={(e) => set("value", e.target.value)}
                />
              </FormField>
            )}
            <p className="text-[11px] text-ink-muted">
              The <b>yes</b> handle continues when the condition matches; the{" "}
              <b>no</b> handle continues otherwise.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
