"use client";

import { useEffect, useState } from "react";

// D1: reusable panels for polymorphic addresses + contacts. Backend is
// accounting-service `/addresses` and `/contacts`; caller passes the
// linkedDoctype + linkedId (e.g. "Customer" + customerId).
//
// Uses direct fetch with the tenant JWT rather than the app's `api` helper
// so this file compiles identically on any frontend that reads the shared
// session key.

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function authToken(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ACC}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `Failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

interface Address {
  id: string;
  addressType: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}
interface Contact {
  id: string;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  email: string | null;
  mobile: string | null;
  isPrimary: boolean;
}

interface Props {
  linkedDoctype: "Customer" | "Supplier" | "Lead";
  linkedId: string;
}

export function AddressesPanel(props: Props) {
  const [rows, setRows] = useState<Address[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    addressType: "Billing",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    country: "",
    pincode: "",
    phone: "",
    email: "",
    isPrimary: false,
  });

  async function load() {
    try {
      setRows(
        await apiFetch<Address[]>(
          `/addresses?linkedDoctype=${props.linkedDoctype}&linkedId=${props.linkedId}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.linkedDoctype, props.linkedId]);

  function edit(a: Address) {
    setForm({
      addressType: a.addressType,
      addressLine1: a.addressLine1,
      addressLine2: a.addressLine2 ?? "",
      city: a.city ?? "",
      state: a.state ?? "",
      country: a.country ?? "",
      pincode: a.pincode ?? "",
      phone: a.phone ?? "",
      email: a.email ?? "",
      isPrimary: a.isPrimary,
    });
    setEditingId(a.id);
    setShowForm(true);
  }
  function cancel() {
    setEditingId(null);
    setShowForm(false);
    setForm({
      addressType: "Billing",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      country: "",
      pincode: "",
      phone: "",
      email: "",
      isPrimary: false,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        linkedDoctype: props.linkedDoctype,
        linkedId: props.linkedId,
        addressType: form.addressType,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2 || null,
        city: form.city || null,
        state: form.state || null,
        country: form.country || null,
        pincode: form.pincode || null,
        phone: form.phone || null,
        email: form.email || null,
        isPrimary: form.isPrimary,
      };
      if (editingId) {
        await apiFetch(`/addresses/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/addresses", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      cancel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this address?")) return;
    try {
      await apiFetch(`/addresses/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="bg-white rounded shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">
          Addresses{" "}
          <span className="text-sm font-normal text-gray-500">({rows.length})</span>
        </h2>
        <button
          onClick={() => (showForm ? cancel() : setShowForm(true))}
          className="text-sm text-brand-600"
        >
          {showForm ? "Cancel" : "+ Add address"}
        </button>
      </div>
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      {showForm && (
        <form onSubmit={save} className="border rounded p-3 space-y-2 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              className="border rounded px-2 py-1 text-sm"
              value={form.addressType}
              onChange={(e) => setForm({ ...form, addressType: e.target.value })}
            >
              <option>Billing</option>
              <option>Shipping</option>
              <option>Office</option>
              <option>Other</option>
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
              />
              Primary
            </label>
          </div>
          <input
            required
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Address line 1"
            value={form.addressLine1}
            onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
          />
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Address line 2"
            value={form.addressLine2}
            onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
          />
          <div className="grid grid-cols-4 gap-2">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Country"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Pin/ZIP"
              value={form.pincode}
              onChange={(e) => setForm({ ...form, pincode: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              type="email"
              className="border rounded px-2 py-1 text-sm"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <button className="bg-brand-600 text-white px-3 py-1 rounded text-sm">
            Save
          </button>
        </form>
      )}

      {rows.length === 0 && !showForm && (
        <div className="text-sm text-gray-500 text-center py-4">
          No addresses yet
        </div>
      )}
      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className="border rounded p-3 text-sm flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                  {a.addressType}
                </span>
                {a.isPrimary && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                    primary
                  </span>
                )}
              </div>
              <div>{a.addressLine1}</div>
              {a.addressLine2 && <div>{a.addressLine2}</div>}
              <div className="text-gray-600">
                {[a.city, a.state, a.country, a.pincode].filter(Boolean).join(", ")}
              </div>
              {(a.phone || a.email) && (
                <div className="text-gray-600 text-xs mt-1">
                  {a.phone && <span>📞 {a.phone}</span>}{" "}
                  {a.email && <span>✉ {a.email}</span>}
                </div>
              )}
            </div>
            <div className="space-x-2 text-xs">
              <button onClick={() => edit(a)} className="text-brand-600">Edit</button>
              <button onClick={() => remove(a.id)} className="text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ContactsPanel(props: Props) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    designation: "",
    email: "",
    mobile: "",
    isPrimary: false,
  });

  async function load() {
    try {
      setRows(
        await apiFetch<Contact[]>(
          `/contacts?linkedDoctype=${props.linkedDoctype}&linkedId=${props.linkedId}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.linkedDoctype, props.linkedId]);

  function edit(c: Contact) {
    setForm({
      firstName: c.firstName,
      lastName: c.lastName ?? "",
      designation: c.designation ?? "",
      email: c.email ?? "",
      mobile: c.mobile ?? "",
      isPrimary: c.isPrimary,
    });
    setEditingId(c.id);
    setShowForm(true);
  }
  function cancel() {
    setEditingId(null);
    setShowForm(false);
    setForm({
      firstName: "",
      lastName: "",
      designation: "",
      email: "",
      mobile: "",
      isPrimary: false,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        linkedDoctype: props.linkedDoctype,
        linkedId: props.linkedId,
        firstName: form.firstName,
        lastName: form.lastName || null,
        designation: form.designation || null,
        email: form.email || null,
        mobile: form.mobile || null,
        isPrimary: form.isPrimary,
      };
      if (editingId) {
        await apiFetch(`/contacts/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch("/contacts", {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      cancel();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this contact?")) return;
    try {
      await apiFetch(`/contacts/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section className="bg-white rounded shadow p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">
          Contacts{" "}
          <span className="text-sm font-normal text-gray-500">({rows.length})</span>
        </h2>
        <button
          onClick={() => (showForm ? cancel() : setShowForm(true))}
          className="text-sm text-brand-600"
        >
          {showForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      {showForm && (
        <form onSubmit={save} className="border rounded p-3 space-y-2 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              className="border rounded px-2 py-1 text-sm"
              placeholder="First name"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Last name"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
            />
          </div>
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            placeholder="Designation"
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              className="border rounded px-2 py-1 text-sm"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Mobile"
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
            />
            Primary
          </label>
          <button className="bg-brand-600 text-white px-3 py-1 rounded text-sm">
            Save
          </button>
        </form>
      )}

      {rows.length === 0 && !showForm && (
        <div className="text-sm text-gray-500 text-center py-4">
          No contacts yet
        </div>
      )}
      <div className="space-y-2">
        {rows.map((c) => (
          <div key={c.id} className="border rounded p-3 text-sm flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">
                  {c.firstName} {c.lastName ?? ""}
                </span>
                {c.isPrimary && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                    primary
                  </span>
                )}
              </div>
              {c.designation && (
                <div className="text-gray-600 text-xs">{c.designation}</div>
              )}
              {(c.email || c.mobile) && (
                <div className="text-gray-600 text-xs mt-1">
                  {c.email && <span>✉ {c.email}</span>}{" "}
                  {c.mobile && <span>📞 {c.mobile}</span>}
                </div>
              )}
            </div>
            <div className="space-x-2 text-xs">
              <button onClick={() => edit(c)} className="text-brand-600">Edit</button>
              <button onClick={() => remove(c.id)} className="text-red-600">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
