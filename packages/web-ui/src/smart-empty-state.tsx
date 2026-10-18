"use client";

import type { ReactNode } from "react";

export interface SmartEmptyAction {
  label: string;
  description?: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary";
}

/**
 * Contextual empty state. Shows title + description + 1-3 next-best actions
 * so an empty table doubles as a learn-by-doing moment.
 */
export function SmartEmptyState({
  icon,
  title,
  description,
  actions = [],
  hint,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: SmartEmptyAction[];
  hint?: string;
}) {
  const primary = actions.find((a) => a.variant !== "secondary") ?? actions[0];
  const rest = actions.filter((a) => a !== primary);
  return (
    <div className="text-center py-14 px-6">
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-ink-muted">
          {icon}
        </div>
      )}
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-ink-muted max-w-md mx-auto">{description}</p>
      )}
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primary && (
            <ActionButton action={primary} variant="primary" />
          )}
          {rest.map((a) => (
            <ActionButton key={a.label} action={a} variant="secondary" />
          ))}
        </div>
      )}
      {hint && (
        <p className="mt-6 text-[11px] uppercase tracking-widest text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function ActionButton({
  action,
  variant,
}: {
  action: SmartEmptyAction;
  variant: "primary" | "secondary";
}) {
  const cls =
    variant === "primary"
      ? "btn-brand btn-sm"
      : "btn-secondary btn-sm";
  const inner = (
    <>
      {action.icon && <span className="me-1.5">{action.icon}</span>}
      <span>{action.label}</span>
    </>
  );
  if (action.href) {
    return (
      <a className={cls} href={action.href} title={action.description}>
        {inner}
      </a>
    );
  }
  return (
    <button className={cls} onClick={action.onClick} title={action.description}>
      {inner}
    </button>
  );
}
