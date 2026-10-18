"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  dateShort,
  type Column,
} from "../../../components/ui";

interface SavedReport {
  id: string;
  name: string;
  doctype: string;
  ownerUserId: string;
  isShared: boolean;
  updatedAt: string;
}

export default function SavedReportsPage() {
  const [rows, setRows] = useState<SavedReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<SavedReport[]>("/reports-builder/saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Saved",
    plural: "Saved",
    refresh: load,
  });

  async function del(r: SavedReport) {
    if (!confirm(`Delete saved report "${r.name}"?`)) return;
    try {
      await api.del(`/reports-builder/saved/${r.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const cols: Column<SavedReport>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/accounting/reports/builder?load=${r.id}`}
          className="text-brand-600 hover:underline font-medium"
        >
          {r.name}
        </a>
      ),
    },
    { header: "Doctype", cell: (r) => <span className="text-xs font-mono">{r.doctype}</span> },
    {
      header: "Shared",
      cell: (r) =>
        r.isShared ? (
          <span className="badge-blue">Shared</span>
        ) : (
          <span className="text-ink-muted">Private</span>
        ),
    },
    { header: "Updated", cell: (r) => <span className="text-xs text-ink-soft">{dateShort(r.updatedAt)}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button onClick={() => del(r)} className="text-red-600 text-xs">
          ✕
        </button>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Saved" },
        ]}
        title="Saved Reports"
        subtitle="Shared reports are visible to any tenant user with read access on the source doctype. Only the owner can edit or delete a saved report."
        actions={
          <a href="/accounting/reports/builder">
            <Button variant="primary" type="button">+ New report</Button>
          </a>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <DataTable<SavedReport>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{
          title: "No saved reports yet",
          description: "Build one from the report builder to save it here.",
        }}
      />
    </main>
  );
}
