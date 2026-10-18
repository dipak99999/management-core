"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";

// Marketing P3 — create a new WebinarEvent. On submit we POST /webinars,
// which will try to provision the meeting on the chosen provider if the
// tenant has a matching TenantIntegration; otherwise it saves as Draft.

interface WebForm {
  id: string;
  name: string;
  title: string;
  publicSlug: string;
}

// Curated list of the common IANA timezones we support out of the box. Users
// can type any string; this is just the "quick pick" list.
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

// Convert a Date to the local-time value expected by <input type="datetime-local">.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewWebinarPage() {
  const [forms, setForms] = useState<WebForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Default start = tomorrow 10:00 local, end = 11:00.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(11, 0, 0, 0);

  const [form, setForm] = useState({
    name: "",
    description: "",
    provider: "Zoom" as "Zoom" | "Webex" | "GoogleMeet" | "Manual",
    startAt: toLocalInput(tomorrow.toISOString()),
    endAt: toLocalInput(tomorrowEnd.toISOString()),
    timezone:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"
        : "Asia/Kolkata",
    capacity: "" as string, // string so we can distinguish "" from 0
    registerFormId: "" as string,
  });

  useEffect(() => {
    api
      .get<WebForm[]>("/web-forms")
      .then(setForms)
      .catch(() => {
        /* non-fatal — registration form is optional */
      });
  }, []);

  // Smart defaults: tenants typically settle on one webinar provider +
  // timezone; pre-fill both so scheduling the next session is one click less.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{
    provider: "Zoom" | "Webex" | "GoogleMeet" | "Manual";
    timezone: string;
  }>("crm-web:webinar-create", uiBackends?.defaults);
  useEffect(() => {
    if (!smart.last) return;
    setForm((f) => ({
      ...f,
      provider: smart.last!.provider ?? f.provider,
      timezone: smart.last!.timezone || f.timezone,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.provider, smart.last?.timezone]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description || null,
        provider: form.provider,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        timezone: form.timezone,
        capacity: form.capacity ? Number(form.capacity) : null,
        registerFormId: form.registerFormId || null,
      };
      const created = await api.post<{ id: string }>("/webinars", body);
      smart.remember({ provider: form.provider, timezone: form.timezone });
      window.location.href = `/crm/webinars/${created.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setSaving(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Webinars", href: "/crm/webinars" },
          { label: "New webinar" },
        ]}
        title="New webinar"
        subtitle="Schedule a session — Zoom / Webex / Google Meet or manual (in-person)."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <a href="/crm/webinars">
              <Button variant="ghost" type="button">Cancel</Button>
            </a>
          </>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <form onSubmit={save} className="space-y-6">
        <Card className="p-6 space-y-4">
          <SectionHeader title="Basics" />
          <FormField label="Name" required>
            <input
              required
              autoFocus
              className="input"
              placeholder="Q1 product launch webinar"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField
            label="Description"
            hint="Shown to attendees + used as the Zoom meeting agenda."
          >
            <textarea
              className="input"
              rows={3}
              placeholder="What attendees will learn, speakers, agenda…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
        </Card>

        <Card className="p-6 space-y-4">
          <SectionHeader title="Provider" />
          <FormField
            label="Platform"
            required
            hint="If a TenantIntegration exists for the chosen provider, we'll provision the meeting immediately. Otherwise we save as Draft — you can connect a provider later and re-provision."
          >
            <select
              className="input"
              value={form.provider}
              onChange={(e) =>
                setForm({ ...form, provider: e.target.value as typeof form.provider })
              }
            >
              <option value="Zoom">Zoom</option>
              <option value="Webex">Webex</option>
              <option value="GoogleMeet">Google Meet</option>
              <option value="Manual">Manual / In-person</option>
            </select>
          </FormField>
        </Card>

        <Card className="p-6 space-y-4">
          <SectionHeader title="Schedule" />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Starts" required>
              <input
                type="datetime-local"
                required
                className="input"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </FormField>
            <FormField label="Ends" required>
              <input
                type="datetime-local"
                required
                className="input"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Timezone" required>
            <input
              list="tz-list"
              required
              className="input"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
            <datalist id="tz-list">
              {TIMEZONES.map((tz) => (
                <option value={tz} key={tz} />
              ))}
            </datalist>
          </FormField>
        </Card>

        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-ink-muted hover:text-ink-soft transition-colors"
          >
            {showAdvanced ? "− Hide" : "+ Show"} capacity & registration form
          </button>
        </div>

        {showAdvanced && (
          <Card className="p-6 space-y-4">
            <SectionHeader title="Registration" />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="Capacity"
                hint="Leave empty for no cap. When full, public registration is refused."
              >
                <input
                  type="number"
                  min={1}
                  className="input"
                  placeholder="e.g. 100"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
              </FormField>
              <FormField
                label="Registration form"
                hint="Link a WebForm to enable public POST /webinars/:id/register. Required for public sign-up."
              >
                <select
                  className="input"
                  value={form.registerFormId}
                  onChange={(e) =>
                    setForm({ ...form, registerFormId: e.target.value })
                  }
                >
                  <option value="">— None (internal / manual add only) —</option>
                  {forms.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.name} ({f.publicSlug})
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <a href="/crm/webinars">
            <Button variant="ghost" type="button">Cancel</Button>
          </a>
          <Button variant="brand" type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create webinar"}
          </Button>
        </div>
      </form>
    </main>
  );
}
