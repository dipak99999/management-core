"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { countTree, type TreeNode } from "@lumaara/db/tree";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Toast,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";
import { TreeView } from "../../components/tree-view";

// The /accounts/tree endpoint already returns a nested Account tree — we
// wrap it into the canonical TreeNode<T> shape at the boundary so the
// shared TreeView component doesn't need a per-doctype adapter.
interface Account {
  id: string;
  accountName: string;
  rootType: string;
  accountType: string | null;
  isGroup: boolean;
  isIntercompany: boolean;
  children: Account[];
}

function toTreeNodes(rows: Account[]): TreeNode<Account>[] {
  return rows.map((r) => ({ row: r, children: toTreeNodes(r.children) }));
}

export default function AccountsPage() {
  const [tree, setTree] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      setTree(await api.get<Account[]>("/accounts/tree"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function onExport() {
    setError(null);
    const BASE = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
    const raw = localStorage.getItem("lumaara.session");
    const token = raw ? (JSON.parse(raw).token as string) : "";
    try {
      const res = await fetch(`${BASE}/accounts/export.csv`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chart-of-accounts.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function onImportFile(file: File) {
    setImportMsg(null);
    setError(null);
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setError("CSV has no data rows");
      return;
    }
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const idx = (col: string) => header.indexOf(col);
    const nCol = idx("accountName");
    const rtCol = idx("rootType");
    const atCol = idx("accountType");
    const paCol = idx("parentAccountName");
    const igCol = idx("isGroup");
    const dsCol = idx("disabled");
    if (nCol < 0 || rtCol < 0)
      return setError("Missing required columns: accountName, rootType");
    const rows = lines.slice(1).map((l) => {
      const cells = parseCsvLine(l);
      return {
        accountName: cells[nCol]?.trim() ?? "",
        rootType: cells[rtCol]?.trim() as
          | "Asset"
          | "Liability"
          | "Equity"
          | "Income"
          | "Expense",
        accountType: atCol >= 0 ? (cells[atCol]?.trim() || null) : null,
        parentAccountName:
          paCol >= 0 ? (cells[paCol]?.trim() || null) : null,
        isGroup: igCol >= 0 ? cells[igCol]?.trim() === "1" : false,
        disabled: dsCol >= 0 ? cells[dsCol]?.trim() === "1" : false,
      };
    });
    try {
      const result = await api.post<{ created: number; skipped: number }>(
        "/accounts/import",
        { rows },
      );
      setImportMsg(`Created ${result.created}, skipped ${result.skipped}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    }
  }

  const nodes = useMemo(() => toTreeNodes(tree), [tree]);
  const total = useMemo(() => countTree(nodes), [nodes]);

  // Multi-company Phase 6: toggle Account.isIntercompany from inline in the
  // tree. Flagged accounts are auto-eliminated by /consolidation. We only
  // allow the toggle on leaf accounts (groups can't hold balances anyway).
  async function toggleIntercompany(a: Account) {
    setError(null);
    try {
      await api.patch(`/accounts/${a.id}/intercompany`, {
        isIntercompany: !a.isIntercompany,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Chart of Accounts"
        subtitle={`${total} account${total === 1 ? "" : "s"} across ${tree.length} root type${tree.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Button variant="secondary" onClick={onExport}>Export CSV</Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>Import CSV</Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = "";
              }}
            />
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {importMsg && <div className="mb-4"><Toast kind="success" message={importMsg} onDismiss={() => setImportMsg(null)} /></div>}

      <Card className="p-4">
        {nodes.length > 0 ? (
          <TreeView<Account>
            nodes={nodes}
            rowKey={(a) => a.id}
            renderRow={(a) => (
              <div className="flex items-center gap-2 min-w-0 w-full">
                <span className={a.isGroup ? "font-semibold text-ink" : "text-ink"}>
                  {a.accountName}
                </span>
                <span className="text-xs text-ink-muted ms-2">{a.rootType}</span>
                {a.accountType && (
                  <span className="text-xs text-ink-muted/70">· {a.accountType}</span>
                )}
                {a.isIntercompany && (
                  <span className="badge-blue text-xs">IC</span>
                )}
                {!a.isGroup && (
                  <label
                    className="ms-auto flex items-center gap-1 text-xs text-ink-muted hover:text-ink cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                    title="Auto-eliminated from the /consolidation report"
                  >
                    <input
                      type="checkbox"
                      checked={a.isIntercompany}
                      onChange={() => toggleIntercompany(a)}
                    />
                    Intercompany
                  </label>
                )}
              </div>
            )}
          />
        ) : loading ? (
          <div className="py-10 text-center text-ink-muted text-sm">Loading…</div>
        ) : (
          <EmptyState
            icon={Icon.book}
            title="No accounts yet"
            description="Import a CSV chart of accounts or add accounts manually."
            action={<Button variant="brand" onClick={() => fileInput.current?.click()}>Import CSV</Button>}
          />
        )}
      </Card>
    </>
  );
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}
