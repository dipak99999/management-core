"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  SectionHeader,
  type Column,
} from "../../components/ui";

interface LeaveType { id: string; leaveTypeName: string }
interface Detail { leaveTypeId: string; annualAllocation: string }
interface Policy {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { details: number; employees: number };
}
interface PolicyDetail {
  id: string;
  leaveTypeId: string;
  annualAllocation: string;
  leaveType: { id: string; leaveTypeName: string };
}
interface PolicyDetailed {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  details: PolicyDetail[];
}

export default function LeavePoliciesPage() {
  const [rows, setRows] = useState<Policy[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [details, setDetails] = useState<Detail[]>([{ leaveTypeId: "", annualAllocation: "" }]);
  const [openDetail, setOpenDetail] = useState<PolicyDetailed | null>(null);
  const [applyForm, setApplyForm] = useState({ fromDate: "", toDate: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [rs, lts] = await Promise.all([
        api.get<Policy[]>("/leave-policies"),
        api.get<LeaveType[]>("/leave-types"),
      ]);
      setRows(rs);
      setLeaveTypes(lts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Leave Policy",
    plural: "Leave Policies",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/leave-policies", {
        name,
        description: description || null,
        isActive: true,
        details: details
          .filter((d) => d.leaveTypeId)
          .map((d) => ({
            leaveTypeId: d.leaveTypeId,
            annualAllocation: Number(d.annualAllocation),
          })),
      });
      setShowForm(false);
      setName("");
      setDescription("");
      setDetails([{ leaveTypeId: "", annualAllocation: "" }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function openApply(id: string) {
    setBusy(true);
    try {
      const p = await api.get<PolicyDetailed>(`/leave-policies/${id}`);
      setOpenDetail(p);
      const year = new Date().getUTCFullYear();
      setApplyForm({ fromDate: `${year}-01-01`, toDate: `${year}-12-31` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!openDetail) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ created: number; skipped: number; employees: number }>(
        `/leave-policies/${openDetail.id}/apply`,
        {
          fromDate: new Date(applyForm.fromDate).toISOString(),
          toDate: new Date(applyForm.toDate).toISOString(),
        },
      );
      setMsg(
        `Applied to ${r.employees} employee(s): created ${r.created}, skipped ${r.skipped}.`,
      );
      setOpenDetail(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const cols: Column<Policy>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{r.description ?? "—"}</span>
      ),
    },
    {
      header: "Types",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r._count.details}</span>,
    },
    {
      header: "Assigned",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r._count.employees}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={() => openApply(r.id)}
          className="text-brand-600 text-xs hover:underline"
        >
          Apply…
        </button>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Leave policies" },
        ]}
        title="Leave policies"
        subtitle={`${rows.length} polic${rows.length === 1 ? "y" : "ies"}`}
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New policy"}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}
      {msg && (
        <Card className="p-3 text-green-800 border-green-200 bg-green-50 text-sm">
          {msg}
        </Card>
      )}

      {showForm && (
        <Card className="p-4">
          <SectionHeader title="New leave policy" />
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Policy name" required>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Description">
                <input
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Annual allocations</div>
              <button
                type="button"
                className="text-xs text-brand-600 hover:underline"
                onClick={() =>
                  setDetails([...details, { leaveTypeId: "", annualAllocation: "" }])
                }
              >
                + Add row
              </button>
            </div>
            {details.map((d, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <select
                  className="input col-span-2"
                  value={d.leaveTypeId}
                  onChange={(e) =>
                    setDetails((rows) =>
                      rows.map((x, idx) =>
                        idx === i ? { ...x, leaveTypeId: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="">Leave type…</option>
                  {leaveTypes.map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.leaveTypeName}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="input"
                  placeholder="Days / year"
                  value={d.annualAllocation}
                  onChange={(e) =>
                    setDetails((rows) =>
                      rows.map((x, idx) =>
                        idx === i
                          ? { ...x, annualAllocation: e.target.value }
                          : x,
                      ),
                    )
                  }
                />
              </div>
            ))}
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<Policy>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No policies yet" }}
      />

      <Drawer
        open={!!openDetail}
        onClose={() => setOpenDetail(null)}
        title={openDetail ? `Apply ${openDetail.name}` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenDetail(null)}>
              Close
            </Button>
            <Button variant="primary" onClick={apply} disabled={busy}>
              Apply
            </Button>
          </>
        }
      >
        {openDetail && (
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">
              Creates one Leave Allocation per detail row for every Active employee.
            </p>
            <div className="text-sm space-y-1">
              {openDetail.details.map((d) => (
                <div key={d.id}>
                  · {d.leaveType.leaveTypeName}:{" "}
                  <span className="tabular-nums">
                    {Number(d.annualAllocation).toFixed(1)}
                  </span>{" "}
                  days
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From">
                <input
                  type="date"
                  className="input"
                  value={applyForm.fromDate}
                  onChange={(e) =>
                    setApplyForm({ ...applyForm, fromDate: e.target.value })
                  }
                />
              </FormField>
              <FormField label="To">
                <input
                  type="date"
                  className="input"
                  value={applyForm.toDate}
                  onChange={(e) =>
                    setApplyForm({ ...applyForm, toDate: e.target.value })
                  }
                />
              </FormField>
            </div>
          </div>
        )}
      </Drawer>
    </main>
  );
}
