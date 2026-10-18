"use client";

// Lumaara shared UI primitives — the building blocks that every list, form
// and detail page composes with. Matches the reference screenshots: cream
// canvas, deep-navy ink, gold accent, generous rounding.
//
// Copy this file into each app's `components/` folder so each Next process
// bundles its own copy (small duplication, avoids a package).

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

// ── PageHeader — icon-square + title + subtitle + actions ─────────────

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  icon?: ReactNode;
  eyebrow?: string;
}
export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  icon,
  eyebrow,
}: PageHeaderProps) {
  return (
    <div>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-ink-muted mb-2">
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-muted/60">/</span>}
              {b.href ? (
                <a href={b.href} className="hover:text-ink">
                  {b.label}
                </a>
              ) : (
                <span>{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="page-header">
        <div className="page-header-lead">
          {icon && <span className="icon-square">{icon}</span>}
          <div className="min-w-0">
            {eyebrow && <div className="page-eyebrow mb-1">{eyebrow}</div>}
            <h1 className="page-title truncate">{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

// ── Button ─────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger";
export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
}
export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const base = {
    primary: "btn-primary",
    brand: "btn-primary",
    secondary: "btn-secondary",
    ghost: "btn-ghost",
    danger: "btn-danger",
  }[variant];
  const sz = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";
  const motion =
    "transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";
  return (
    <button {...rest} className={`${base} ${sz} ${motion} ${className}`.trim()}>
      {icon && <span className="w-3.5 h-3.5">{icon}</span>}
      {children}
    </button>
  );
}

// ── Card ───────────────────────────────────────────────────────────────

export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  const { className = "", ...rest } = props;
  return <div {...rest} className={`card ${className}`.trim()} />;
}
export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        {title && <h3 className="font-semibold text-ink">{title}</h3>}
        {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── StatusBadge — auto colors for common workflow states ───────────────

const STATUS_COLOR: Record<string, string> = {
  Draft:            "badge-gray",
  Submitted:        "badge-blue",
  Approved:         "badge-green",
  Accepted:         "badge-green",
  Paid:             "badge-green",
  "Partially Paid": "badge-amber",
  Issued:           "badge-blue",
  Completed:        "badge-green",
  Hired:            "badge-green",
  Active:           "badge-green",
  Open:             "badge-blue",
  "In Process":     "badge-amber",
  "In Progress":    "badge-amber",
  InProgress:       "badge-amber",
  Interviewing:     "badge-amber",
  Shortlisted:      "badge-brand",
  Offer:            "badge-violet",
  "To Deliver":     "badge-amber",
  "To Bill":        "badge-amber",
  "To Receive":     "badge-amber",
  Ordered:          "badge-blue",
  Ready:            "badge-blue",
  "On Hold":        "badge-gray",
  Cancelled:        "badge-red",
  Rejected:         "badge-red",
  Withdrawn:        "badge-gray",
  Lost:             "badge-red",
  Overdue:          "badge-red",
  Closed:           "badge-gray",
  Void:             "badge-gray",
  Depreciating:     "badge-blue",
  FullyDepreciated: "badge-gray",
  Scrapped:         "badge-red",
  Sent:             "badge-green",
  Resent:           "badge-blue",
  Expired:          "badge-red",
  "Pending Approval": "badge-amber",
  "Changes Requested": "badge-amber",
  Queued:           "badge-amber",
  Failed:           "badge-red",
  Running:          "badge-amber",
  Advance:          "badge-brand",
  Final:            "badge-blue",
  "Credit Note":    "badge-violet",
};
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="badge-gray">—</span>;
  const cls = STATUS_COLOR[status] ?? "badge-gray";
  return <span className={cls}>{status}</span>;
}

// ── EmptyState ─────────────────────────────────────────────────────────

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}
// Dedicated 404 state for detail pages. Replaces the bare red "Not found"
// card that was previously rendered when a detail-page load returned 404.
// Takes a doctype label (e.g. "Invoice") + the parent list href.
export function NotFoundState({
  doctype,
  listHref,
  listLabel,
}: {
  doctype: string;
  listHref: string;
  listLabel?: string;
}) {
  const label = listLabel ?? `${doctype}s`;
  return (
    <div className="rounded-xl border border-ink/8 bg-white p-10 text-center">
      <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-canvas-warm grid place-items-center text-ink-muted">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="12" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M14 16l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-ink">{doctype} not found</h2>
      <p className="text-sm text-ink-muted mt-1 max-w-sm mx-auto">
        It may have been deleted, or the link is wrong. Head back to the list to
        browse what's still there.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <a href={listHref} className="btn-primary">
          ← Back to {label}
        </a>
        <a href="/" className="btn-secondary">
          Home
        </a>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── DataTable — sortable-looking header + hover rows ──────────────────

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  sortable?: boolean;
}
export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: EmptyStateProps;
  loading?: boolean;
}
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  loading,
}: DataTableProps<T>) {
  return (
    <div className="table-wrap overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                style={c.width ? { width: c.width } : undefined}
                className={
                  c.align === "right"
                    ? "text-end"
                    : c.align === "center"
                    ? "text-center"
                    : ""
                }
              >
                <span className="inline-flex items-center gap-1">
                  {c.header}
                  {c.sortable !== false && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      className="sort-icon"
                    >
                      <path
                        d="M3 4l2-2 2 2M3 6l2 2 2-2"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={onRowClick ? "cursor-pointer" : ""}
            >
              {columns.map((c, i) => (
                <td
                  key={i}
                  className={
                    c.align === "right"
                      ? "text-end"
                      : c.align === "center"
                      ? "text-center"
                      : ""
                  }
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={columns.length} className="p-0">
                <EmptyState
                  {...(empty ?? {
                    icon: (
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ),
                    title: "Nothing here yet",
                    description: "This list is empty. Add your first record to get started.",
                  })}
                />
              </td>
            </tr>
          )}
          {rows.length === 0 && loading && (
            <tr>
              <td
                colSpan={columns.length}
                className="p-10 text-center text-ink-muted text-sm"
              >
                Loading…
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── FormField ─────────────────────────────────────────────────────────

export function FormField({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="text-red-500 ms-0.5">*</span>}
      </span>
      {children}
      {hint && !error && <p className="text-[11px] text-ink-muted mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
    </label>
  );
}

// ── FilterBar — horizontal search + inline chips + right-side actions ─

export interface FilterBarProps {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  filters?: ReactNode;
  actions?: ReactNode;
}
export function FilterBar({ search, filters, actions }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {search && (
        <div className="relative flex-1 min-w-[200px] max-w-lg">
          <span
            className="absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <circle
                cx="9"
                cy="9"
                r="6"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M14 14l4 4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            type="search"
            className="input ps-10"
            placeholder={search.placeholder ?? "Search…"}
            aria-label={search.placeholder ?? "Search"}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
          />
        </div>
      )}
      {filters && (
        <div className="flex items-center gap-2 flex-wrap">{filters}</div>
      )}
      <div className="flex-1" />
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Modal / Drawer ────────────────────────────────────────────────────

export function Drawer({
  open,
  onClose,
  title,
  footer,
  children,
  width = "w-[520px]",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal>
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={`absolute top-0 end-0 bottom-0 ${width} max-w-full bg-white shadow-raised flex flex-col animate-slide-in-right`}
      >
        <div className="px-6 py-4 border-b border-ink/8 flex items-center justify-between shrink-0">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-canvas-warm text-ink-muted"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 20 20">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="px-6 py-3.5 border-t border-ink/8 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

export function Toast({
  kind = "info",
  message,
  onDismiss,
}: {
  kind?: "info" | "success" | "error";
  message: string;
  onDismiss?: () => void;
}) {
  const cls =
    kind === "success"
      ? "border-success/30 bg-success-soft text-success"
      : kind === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-gold-200 bg-gold-50 text-gold-800";
  return (
    <div
      className={`rounded-xl border px-3.5 py-2.5 text-sm flex items-start gap-2 animate-slide-in-bottom ${cls}`}
    >
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-current/70 hover:text-current"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────

export function Skeleton({
  className = "",
  rounded = "rounded",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-canvas-sunken ${rounded} ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/60 to-transparent animate-shimmer" />
    </div>
  );
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" rounded="rounded-xl" />
      ))}
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────

export function money(n: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - d) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
  if (abs < 604800) return `${Math.round(abs / 86400)}d ago`;
  return dateShort(iso);
}

// Detail-page section header — used by /foo/[id] pages.
export function SectionHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-ink/8 pb-2.5 mb-4">
      <h3 className="section-title">{title}</h3>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// Label + value pair for detail views.
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest text-ink-muted font-semibold">
        {label}
      </div>
      <div className="text-sm text-ink mt-1">{value ?? "—"}</div>
    </div>
  );
}

// Segmented pill toggle — matches the ACTIVE / INACTIVE + ALL / B2C / B2B
// filter groups in the reference screenshots. Active option is a dark
// navy pill; inactive options are transparent with uppercase labels.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={active ? "pill-active" : "pill"}
          >
            {o.label}
            {o.count != null && (
              <span
                className={`ms-1 text-[10px] tabular-nums ${active ? "text-white/70" : "text-ink-muted/70"}`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  return {
    on,
    toggle: () => setOn((v) => !v),
    open: () => setOn(true),
    close: () => setOn(false),
    setOn,
  };
}
