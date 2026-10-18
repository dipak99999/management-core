"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Form section that can be marked advanced to hide behind a toggle. Pass
 * `role` to further restrict to certain user roles.
 */
export function FormSection({
  title,
  description,
  advanced = false,
  children,
}: {
  title?: string;
  description?: string;
  advanced?: boolean;
  children: ReactNode;
}) {
  return (
    <section data-section data-advanced={advanced ? "1" : "0"}>
      {title && <h3 className="text-sm font-semibold text-ink mb-1">{title}</h3>}
      {description && (
        <p className="text-xs text-ink-muted mb-3">{description}</p>
      )}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/**
 * Wrap a form in <ProgressiveForm> and mark some <FormSection advanced>.
 * Those sections stay hidden until the user clicks "Show advanced".
 */
export function ProgressiveForm({
  children,
  showAdvancedByDefault = false,
  advancedLabel = "Show advanced options",
  advancedActiveLabel = "Hide advanced options",
}: {
  children: ReactNode;
  showAdvancedByDefault?: boolean;
  advancedLabel?: string;
  advancedActiveLabel?: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(showAdvancedByDefault);
  const items = Children.toArray(children);
  const basic: ReactNode[] = [];
  const advanced: ReactNode[] = [];
  for (const c of items) {
    if (
      isValidElement(c) &&
      (c as ReactElement<{ advanced?: boolean }>).props.advanced
    ) {
      advanced.push(c);
    } else if (isValidElement(c)) {
      basic.push(cloneElement(c));
    } else {
      basic.push(c);
    }
  }
  return (
    <div className="space-y-6">
      {basic}
      {advanced.length > 0 && (
        <>
          {showAdvanced ? (
            <div className="space-y-6 pt-4 border-t border-ink/8">{advanced}</div>
          ) : null}
          <button
            type="button"
            className="text-sm text-brew hover:underline"
            onClick={() => setShowAdvanced((s) => !s)}
          >
            {showAdvanced ? advancedActiveLabel : advancedLabel}
          </button>
        </>
      )}
    </div>
  );
}
