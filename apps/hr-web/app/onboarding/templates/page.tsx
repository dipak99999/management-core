"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  type Column,
} from "../../../components/ui";

interface TemplateItem {
  activity: string;
  description: string;
  role: string;
}

interface Template {
  id: string;
  name: string;
  type: string;
  description: string | null;
  _count: { items: number };
}

const emptyItem: TemplateItem = { activity: "", description: "", role: "" };

const DEFAULT_ONBOARDING: TemplateItem[] = [
  { activity: "Collect ID proof", description: "PAN, Aadhaar, address", role: "HR" },
  { activity: "Issue employee code", description: "", role: "HR" },
  { activity: "Send offer letter", description: "", role: "HR" },
  { activity: "Setup workstation", description: "Laptop, monitor, keys", role: "IT" },
  { activity: "Create email account", description: "", role: "IT" },
  { activity: "Provision system access", description: "SSO, Slack, tools", role: "IT" },
  { activity: "Assign buddy", description: "", role: "Manager" },
  { activity: "Complete orientation", description: "Day-1 walkthrough", role: "HR" },
];

const DEFAULT_SEPARATION: TemplateItem[] = [
  { activity: "Collect resignation letter", description: "", role: "HR" },
  { activity: "Knowledge transfer", description: "", role: "Manager" },
  { activity: "Return company assets", description: "Laptop, ID card, keys", role: "IT" },
  { activity: "Revoke system access", description: "", role: "IT" },
  { activity: "Final settlement", description: "Salary, gratuity, leave encashment", role: "Payroll" },
  { activity: "Exit interview", description: "", role: "HR" },
  { activity: "Issue experience letter", description: "", role: "HR" },
];

export default function TemplatesPage() {
  const [rows, setRows] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"Onboarding" | "Separation">("Onboarding");
  const [items, setItems] = useState<TemplateItem[]>([{ ...emptyItem }]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Template[]>("/employee-checklist-templates"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Template",
    plural: "Templates",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/employee-checklist-templates", {
        name,
        type,
        items: items
          .filter((i) => i.activity.trim())
          .map((i, idx) => ({
            activity: i.activity,
            description: i.description || null,
            role: i.role || null,
            sortOrder: idx,
          })),
      });
      setShowForm(false);
      setName("");
      setItems([{ ...emptyItem }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function loadDefault() {
    setItems(type === "Onboarding" ? [...DEFAULT_ONBOARDING] : [...DEFAULT_SEPARATION]);
  }

  const cols: Column<Template>[] = [
    { header: "Name", cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: "Type", cell: (r) => <span className="text-xs">{r.type}</span> },
    {
      header: "Steps",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r._count.items}</span>,
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Onboarding & Separation", href: "/hr/onboarding" },
          { label: "Templates" },
        ]}
        title="Checklist templates"
        subtitle={`${rows.length} template${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowForm((s) => !s)}
              type="button"
            >
              {showForm ? "Cancel" : "+ New template"}
            </Button>
          </>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      {showForm && (
        <Card className="p-4">
          <SectionHeader title="New template" />
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name" required>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Type">
                <select
                  className="input"
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as "Onboarding" | "Separation")
                  }
                >
                  <option value="Onboarding">Onboarding</option>
                  <option value="Separation">Separation</option>
                </select>
              </FormField>
            </div>
            <SectionHeader
              title="Activities"
              actions={
                <div className="space-x-2">
                  <button
                    type="button"
                    onClick={loadDefault}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    Load default steps
                  </button>
                  <button
                    type="button"
                    onClick={() => setItems([...items, { ...emptyItem }])}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    + Add row
                  </button>
                </div>
              }
            />
            <table className="table">
              <thead>
                <tr>
                  <th className="text-start">Activity</th>
                  <th className="text-start">Description</th>
                  <th className="text-start">Role</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="input"
                        value={r.activity}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((x, idx) =>
                              idx === i ? { ...x, activity: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={r.description}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((x, idx) =>
                              idx === i
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        placeholder="HR / IT / Manager"
                        value={r.role}
                        onChange={(e) =>
                          setItems((rows) =>
                            rows.map((x, idx) =>
                              idx === i ? { ...x, role: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="text-red-500 text-xs"
                        onClick={() =>
                          setItems((rows) =>
                            rows.filter((_, idx) => idx !== i),
                          )
                        }
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<Template>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No templates yet" }}
      />
    </main>
  );
}
