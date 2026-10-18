"use client";

// Palette of draggable node kinds for the visual journey builder. Users drag
// a card from here onto the React Flow canvas; the drop handler in
// journey-builder.tsx reads `application/reactflow` from the DataTransfer.
//
// Shared with journey-node-config.tsx via NODE_KINDS/NodeKind so all three
// files (palette, canvas node renderers, config panel) agree on the
// vocabulary and default `data` payload shape.

import type { ReactNode } from "react";

export type NodeKind =
  | "trigger"
  | "wait"
  | "sendEmail"
  | "sendSms"
  | "sendWhatsapp"
  | "addToList"
  | "removeFromList"
  | "updateContact"
  | "branch"
  | "exit";

export interface NodeKindMeta {
  kind: NodeKind;
  label: string;
  description: string;
  // Tailwind color pair for icon chip: bg + text.
  tint: string;
  icon: ReactNode;
  // Default `data` for a freshly-dropped node of this kind.
  defaultData: Record<string, unknown>;
  // The React Flow node `type` — we group all custom nodes under one type
  // ("journey") because we render them ourselves keyed by `data.kind`.
  category: "trigger" | "wait" | "action" | "branch" | "exit";
}

const svgProps = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none" };

export const NODE_KINDS: NodeKindMeta[] = [
  {
    kind: "trigger",
    label: "Trigger",
    description: "Entry point — matches the journey's trigger type.",
    tint: "bg-brand-50 text-brand-700",
    category: "trigger",
    defaultData: {},
    icon: (
      <svg {...svgProps}>
        <path
          d="M10 2v6l4 2-4 2v6M4 10h12"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    kind: "wait",
    label: "Wait",
    description: "Delay for N minutes / hours / days before the next node.",
    tint: "bg-amber-50 text-amber-700",
    category: "wait",
    defaultData: { unit: "day", amount: 1 },
    icon: (
      <svg {...svgProps}>
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.7" />
        <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    kind: "sendEmail",
    label: "Send email",
    description: "Send an email via the chosen template.",
    tint: "bg-blue-50 text-blue-700",
    category: "action",
    defaultData: { templateId: "", subject: "", body: "" },
    icon: (
      <svg {...svgProps}>
        <rect
          x="2.5"
          y="4.5"
          width="15"
          height="11"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path d="M3 6l7 5 7-5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    kind: "sendSms",
    label: "Send SMS",
    description: "Send a text message via SMS provider.",
    tint: "bg-emerald-50 text-emerald-700",
    category: "action",
    defaultData: { templateId: "", body: "" },
    icon: (
      <svg {...svgProps}>
        <path
          d="M3 5.5a2 2 0 012-2h10a2 2 0 012 2v6a2 2 0 01-2 2H8l-4 3v-3H5a2 2 0 01-2-2v-6z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    kind: "sendWhatsapp",
    label: "Send WhatsApp",
    description: "Send a WABA-approved template message.",
    tint: "bg-green-50 text-green-700",
    category: "action",
    defaultData: { templateId: "", variables: [] as string[] },
    icon: (
      <svg {...svgProps}>
        <path
          d="M10 2.5a7.5 7.5 0 00-6.4 11.4L2.5 17.5l3.7-1a7.5 7.5 0 103.8-14z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    kind: "addToList",
    label: "Add to list",
    description: "Add the contact to a contact list.",
    tint: "bg-violet-50 text-violet-700",
    category: "action",
    defaultData: { listId: "" },
    icon: (
      <svg {...svgProps}>
        <path d="M4 6h9M4 10h9M4 14h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M15 12v6M12 15h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    kind: "removeFromList",
    label: "Remove from list",
    description: "Remove the contact from a contact list.",
    tint: "bg-rose-50 text-rose-700",
    category: "action",
    defaultData: { listId: "" },
    icon: (
      <svg {...svgProps}>
        <path d="M4 6h9M4 10h9M4 14h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12 15h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    kind: "updateContact",
    label: "Update contact",
    description: "Set a contact attribute to a new value.",
    tint: "bg-indigo-50 text-indigo-700",
    category: "action",
    defaultData: { attribute: "", value: "" },
    icon: (
      <svg {...svgProps}>
        <path
          d="M4 15.5V17h1.5L14 8.5 12.5 7 4 15.5zM12.5 7L15 4.5 17 6.5 14.5 9"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    kind: "branch",
    label: "Branch",
    description: "Split flow based on a contact attribute.",
    tint: "bg-yellow-50 text-yellow-700",
    category: "branch",
    defaultData: { field: "email", op: "contains", value: "" },
    icon: (
      <svg {...svgProps}>
        <path
          d="M6 3v6a4 4 0 004 4M14 3v6a4 4 0 01-4 4v4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    kind: "exit",
    label: "Exit",
    description: "End of the journey for this contact.",
    tint: "bg-gray-100 text-gray-700",
    category: "exit",
    defaultData: {},
    icon: (
      <svg {...svgProps}>
        <path
          d="M12 4h4v12h-4M12 10H3M6 7l-3 3 3 3"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function nodeKindMeta(kind: string): NodeKindMeta | undefined {
  return NODE_KINDS.find((k) => k.kind === kind);
}

// Sidebar palette: one draggable card per node kind. `trigger` is disabled
// (drag) because a journey has exactly one trigger and it's created upfront —
// dropping additional triggers would make graph validation ambiguous.
export function JourneyNodePalette() {
  function onDragStart(e: React.DragEvent, kind: NodeKind) {
    e.dataTransfer.setData("application/reactflow", kind);
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="flex flex-col gap-1.5 p-3 h-full overflow-y-auto">
      <div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold px-1 pb-1">
        Nodes
      </div>
      {NODE_KINDS.filter((k) => k.kind !== "trigger").map((meta) => (
        <div
          key={meta.kind}
          draggable
          onDragStart={(e) => onDragStart(e, meta.kind)}
          className="flex items-start gap-2 rounded-lg border border-ink-muted/10 bg-surface-raised p-2 cursor-grab active:cursor-grabbing hover:border-brand-200 hover:shadow-brand-sm transition"
          title={meta.description}
        >
          <span
            className={`w-7 h-7 rounded-md grid place-items-center shrink-0 ${meta.tint}`}
          >
            {meta.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-ink truncate">
              {meta.label}
            </div>
            <div className="text-[10px] text-ink-muted line-clamp-2">
              {meta.description}
            </div>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-ink-muted mt-3 px-1">
        Drag a node onto the canvas. Connect nodes by dragging from the bottom
        handle of one to the top handle of another.
      </p>
    </div>
  );
}
