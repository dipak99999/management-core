"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export interface TourStep {
  /** CSS selector for the element to spotlight. */
  target: string;
  title: string;
  body: ReactNode;
  /** Which side of the target to place the card. Default "bottom". */
  placement?: "top" | "bottom" | "start" | "end";
}

const DONE_KEY = (id: string) => `lumaara.tour.${id}.done`;

export function useTour(tourId: string): {
  completed: boolean;
  reset: () => void;
  markDone: () => void;
} {
  const [completed, setCompleted] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    // Global tours-disabled flag — set by e2e global-setup so tours never
    // open on top of other UI and block clicks in Playwright. Also useful
    // for demos/screenshots where tour overlays are a distraction.
    if (window.localStorage.getItem("lumaara.tours.disabled") === "1") return true;
    return window.localStorage.getItem(DONE_KEY(tourId)) === "1";
  });
  return {
    completed,
    reset: () => {
      window.localStorage.removeItem(DONE_KEY(tourId));
      setCompleted(false);
    },
    markDone: () => {
      window.localStorage.setItem(DONE_KEY(tourId), "1");
      setCompleted(true);
    },
  };
}

/**
 * Minimal, dependency-free guided tour. Spotlights a target element and
 * shows a card describing it. Auto-skips steps whose target isn't present.
 */
export function Tour({
  id,
  steps,
  autoStart = true,
  onDone,
}: {
  id: string;
  steps: TourStep[];
  autoStart?: boolean;
  onDone?: () => void;
}) {
  const { completed, markDone } = useTour(id);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(autoStart && !completed);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[idx];

  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) {
      // Skip step if target missing.
      if (idx + 1 < steps.length) setIdx(idx + 1);
      else finish();
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setRect(el.getBoundingClientRect());
  }, [idx, step, steps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, measure]);

  const finish = useCallback(() => {
    setOpen(false);
    markDone();
    onDone?.();
  }, [markDone, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, steps.length]);

  if (!open || !step || !rect) return null;

  const pad = 6;
  const cardStyle: React.CSSProperties = (() => {
    const place = step.placement ?? "bottom";
    const top = place === "top" ? Math.max(12, rect.top - 12 - 120) : rect.bottom + 10;
    const left = Math.max(12, Math.min(window.innerWidth - 332, rect.left));
    return { position: "fixed", top, left, maxWidth: 320 };
  })();

  return (
    <>
      {/* Scrim with cutout */}
      <svg
        className="fixed inset-0 z-50 pointer-events-none"
        width="100%"
        height="100%"
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left - pad}
              y={rect.top - pad}
              width={rect.width + pad * 2}
              height={rect.height + pad * 2}
              rx="8"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.5)"
          mask="url(#tour-mask)"
        />
      </svg>
      {/* Highlight ring */}
      <div
        aria-hidden
        className="fixed z-50 pointer-events-none rounded-lg ring-2 ring-brew"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
        }}
      />
      {/* Card */}
      <div
        role="dialog"
        aria-label={step.title}
        className="z-50 rounded-xl bg-canvas border border-ink/10 shadow-2xl p-4"
        style={cardStyle}
      >
        <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
        <div className="mt-1 text-sm text-ink-muted">{step.body}</div>
        <div className="mt-3 flex items-center justify-between">
          <button className="text-xs text-ink-muted hover:text-ink" onClick={finish}>
            Skip tour
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-ink-muted">
              {idx + 1} / {steps.length}
            </span>
            {idx > 0 && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setIdx((i) => Math.max(0, i - 1))}
              >
                Back
              </button>
            )}
            {idx + 1 < steps.length ? (
              <button
                className="btn-brand btn-sm"
                onClick={() => setIdx((i) => i + 1)}
              >
                Next
              </button>
            ) : (
              <button className="btn-brand btn-sm" onClick={finish}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
