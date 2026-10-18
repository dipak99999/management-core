"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

// C9: create/edit a QI. Optionally linked to a PR item (Incoming) or DN item
// (Outgoing). Picking a template pre-fills the parameter list.

interface Item { id: string; itemCode: string; itemName: string }
interface QITemplate {
  id: string;
  name: string;
  parameters: {
    parameter: string;
    acceptanceCriteria: string | null;
    sortOrder: number;
  }[];
}
interface Reading {
  parameter: string;
  acceptanceCriteria: string;
  reading: string;
  status: "Accepted" | "Rejected";
}
interface ExistingQI {
  inspectionType: string;
  reportDate: string;
  itemId: string;
  templateId: string | null;
  purchaseReceiptItemId: string | null;
  deliveryNoteItemId: string | null;
  overallStatus: "Accepted" | "Rejected";
  inspectedBy: string | null;
  remarks: string | null;
  readings: {
    parameter: string;
    acceptanceCriteria: string | null;
    reading: string | null;
    status: "Accepted" | "Rejected";
  }[];
}

function InnerNewQIPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  // C9: optional deep-links from PR/DN detail pages.
  const purchaseReceiptItemId = searchParams.get("purchaseReceiptItemId");
  const deliveryNoteItemId = searchParams.get("deliveryNoteItemId");
  const preItemId = searchParams.get("itemId");
  const preTemplateId = searchParams.get("templateId");

  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<QITemplate[]>([]);
  const [itemId, setItemId] = useState<string>(preItemId ?? "");
  const [templateId, setTemplateId] = useState<string>(preTemplateId ?? "");
  const [inspectionType, setInspectionType] = useState<
    "Incoming" | "Outgoing" | "In-Process"
  >(deliveryNoteItemId ? "Outgoing" : "Incoming");
  const [reportDate, setReportDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [inspectedBy, setInspectedBy] = useState("");
  const [overallStatus, setOverallStatus] = useState<"Accepted" | "Rejected">(
    "Accepted",
  );
  const [remarks, setRemarks] = useState("");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    api
      .get<QITemplate[]>("/quality-inspection-templates")
      .then(setTemplates)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingQI>(`/quality-inspections/${editId}`)
      .then((qi) => {
        setInspectionType(
          qi.inspectionType as "Incoming" | "Outgoing" | "In-Process",
        );
        setReportDate(qi.reportDate.slice(0, 10));
        setItemId(qi.itemId);
        setTemplateId(qi.templateId ?? "");
        setOverallStatus(qi.overallStatus);
        setInspectedBy(qi.inspectedBy ?? "");
        setRemarks(qi.remarks ?? "");
        setReadings(
          qi.readings.map((r) => ({
            parameter: r.parameter,
            acceptanceCriteria: r.acceptanceCriteria ?? "",
            reading: r.reading ?? "",
            status: r.status,
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  // Seed readings from template on template pick (only when readings are
  // empty — don't clobber a partially filled inspection).
  useEffect(() => {
    if (!templateId) return;
    const t = templates.find((x) => x.id === templateId);
    if (!t || readings.length > 0) return;
    setReadings(
      t.parameters
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((p) => ({
          parameter: p.parameter,
          acceptanceCriteria: p.acceptanceCriteria ?? "",
          reading: "",
          status: "Accepted",
        })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, templates]);

  function updateReading(idx: number, patch: Partial<Reading>) {
    setReadings((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        inspectionType,
        reportDate: new Date(reportDate).toISOString(),
        itemId,
        templateId: templateId || null,
        purchaseReceiptItemId: purchaseReceiptItemId || null,
        deliveryNoteItemId: deliveryNoteItemId || null,
        overallStatus,
        inspectedBy: inspectedBy || null,
        remarks,
        readings: readings
          .filter((r) => r.parameter.trim())
          .map((r) => ({
            parameter: r.parameter,
            acceptanceCriteria: r.acceptanceCriteria || null,
            reading: r.reading || null,
            status: r.status,
          })),
      };
      if (editId) {
        await api.put(`/quality-inspections/${editId}`, body);
        location.href = `/stock/quality-inspections/${editId}`;
      } else {
        const created = await api.post<{ id: string }>(
          "/quality-inspections",
          body,
        );
        // If we were opened from a PR/DN deep-link, navigate back to the
        // parent doc after save.
        if (purchaseReceiptItemId) {
          // Best-effort: navigate to PR list; caller can drill in.
          location.href = "/stock/purchase-receipts";
        } else if (deliveryNoteItemId) {
          location.href = "/stock/delivery-notes";
        } else {
          location.href = `/stock/quality-inspections/${created.id}`;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Quality Inspections", href: "/stock/quality-inspections" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Quality Inspection" : "New Quality Inspection"}
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />
      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}
      {(purchaseReceiptItemId || deliveryNoteItemId) && (
        <div className="text-sm bg-blue-50 border border-blue-200 rounded p-2 text-blue-800">
          Linked to {purchaseReceiptItemId ? "PR" : "DN"} line — this QI will
          gate the parent doc&apos;s submit.
        </div>
      )}
      <Card className="p-4"><form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-sm text-gray-600">Type</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={inspectionType}
              onChange={(e) =>
                setInspectionType(e.target.value as typeof inspectionType)
              }
            >
              <option>Incoming</option>
              <option>Outgoing</option>
              <option>In-Process</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Report date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm text-gray-600">Overall status</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={overallStatus}
              onChange={(e) =>
                setOverallStatus(e.target.value as typeof overallStatus)
              }
            >
              <option>Accepted</option>
              <option>Rejected</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600">Item</label>
            <select
              required
              className="w-full border rounded px-3 py-2"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              <option value="">Select item...</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} — {i.itemName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600">Template</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">— No template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600">Inspected by</label>
          <input
            className="w-full border rounded px-3 py-2 max-w-xs"
            placeholder="Inspector name"
            value={inspectedBy}
            onChange={(e) => setInspectedBy(e.target.value)}
          />
        </div>

        <div>
          <label className="text-sm text-gray-600">Readings</label>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-start">
              <tr>
                <th className="py-1">Parameter</th>
                <th className="py-1">Acceptance criteria</th>
                <th className="py-1 w-32">Reading</th>
                <th className="py-1 w-28">Status</th>
                <th className="py-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r, idx) => (
                <tr key={idx}>
                  <td className="py-1 pe-2">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={r.parameter}
                      onChange={(e) => updateReading(idx, { parameter: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={r.acceptanceCriteria}
                      onChange={(e) =>
                        updateReading(idx, { acceptanceCriteria: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <input
                      className="w-full border rounded px-2 py-1"
                      value={r.reading}
                      onChange={(e) => updateReading(idx, { reading: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <select
                      className="w-full border rounded px-2 py-1"
                      value={r.status}
                      onChange={(e) =>
                        updateReading(idx, {
                          status: e.target.value as "Accepted" | "Rejected",
                        })
                      }
                    >
                      <option>Accepted</option>
                      <option>Rejected</option>
                    </select>
                  </td>
                  <td className="py-1 text-end">
                    <button
                      type="button"
                      onClick={() =>
                        setReadings((rs) => rs.filter((_, i) => i !== idx))
                      }
                      className="text-xs text-red-600"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() =>
              setReadings([
                ...readings,
                { parameter: "", acceptanceCriteria: "", reading: "", status: "Accepted" },
              ])
            }
            className="text-sm text-brand-600 mt-2"
          >
            + Add reading
          </button>
        </div>

        <div>
          <label className="text-sm text-gray-600">Remarks</label>
          <textarea
            className="w-full border rounded px-3 py-2"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>

        <div className="flex justify-end border-t border-ink-muted/10 pt-3">
          <Button variant="primary" disabled={busy} type="submit">
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </form></Card>
    </main>
  );
}

export default function NewQIPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewQIPage />
    </Suspense>
  );
}
