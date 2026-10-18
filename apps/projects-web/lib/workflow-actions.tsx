"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// Renders inline workflow controls for a given (doctype, docId):
//   - A pill showing the workflow's current state (if an active workflow exists)
//   - One button per outgoing transition the user is allowed to trigger
// If no active workflow exists for the doctype, renders nothing so the page's
// existing status/submit UI keeps working unchanged.

interface Transition {
  id: string;
  actionLabel: string;
  toState: string;
  allowed: boolean;
}

interface Payload {
  workflow: { id: string; name: string } | null;
  currentState: string | null;
  transitions: Transition[];
}

export function WorkflowActions({
  doctype,
  docId,
  onChange,
}: {
  doctype: string;
  docId: string;
  onChange?: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/workflow-actions/${doctype}/${docId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load workflow");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, docId]);

  async function apply(action: string) {
    setBusy(true);
    setError(null);
    try {
      await api.post("/workflow-actions/apply", { doctype, docId, action });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data || !data.workflow) return null;

  return (
    <div className="inline-flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-xs text-gray-500">
        Workflow: <span className="font-medium">{data.workflow.name}</span>
      </span>
      {data.currentState && (
        <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800">
          {data.currentState}
        </span>
      )}
      {data.transitions.map((t) => (
        <button
          key={t.id}
          onClick={() => apply(t.actionLabel)}
          disabled={!t.allowed || busy}
          title={
            t.allowed
              ? `→ ${t.toState}`
              : "You don't have a role that permits this transition"
          }
          className="border px-3 py-1 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
        >
          {t.actionLabel}
        </button>
      ))}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
