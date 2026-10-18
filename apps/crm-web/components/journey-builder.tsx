"use client";

// Visual journey builder: React Flow canvas + palette + config panel wired
// together. Owns the local nodes/edges state during editing and calls
// onChange whenever the graph mutates. The parent page persists via
// PUT /journeys/:id { nodesJson, edgesJson }.
//
// Custom node renderer (JourneyNode) styles each node by kind (colored icon
// chip + label). Branch nodes have two source handles (yes/no) so the user
// can wire the two outcomes visually.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "reactflow";
import "reactflow/dist/style.css";

import { JourneyNodePalette, nodeKindMeta, type NodeKind } from "./journey-node-palette";
import { JourneyNodeConfig, type JourneyNodeData } from "./journey-node-config";

// A React Flow node whose `data` payload carries our per-kind config plus a
// `kind` discriminator. All custom nodes share the type "journey" and are
// rendered by JourneyNode below.
export type JNode = Node<JourneyNodeData, "journey">;
export type JEdge = Edge<{ handle?: "yes" | "no" }>;

export interface JourneyBuilderProps {
  initialNodes: JNode[];
  initialEdges: JEdge[];
  onChange?: (nodes: JNode[], edges: JEdge[]) => void;
  readOnly?: boolean;
}

// Per-node renderer. Reads meta from nodeKindMeta(data.kind); falls back to a
// neutral chip if kind is unknown (older graphs, forward-compat).
function JourneyNode({ data, selected }: NodeProps<JourneyNodeData>) {
  const meta = nodeKindMeta(data.kind);
  const label = (data.label as string) || meta?.label || String(data.kind);
  const tint = meta?.tint ?? "bg-gray-100 text-gray-700";

  const isTrigger = data.kind === "trigger";
  const isExit = data.kind === "exit";
  const isBranch = data.kind === "branch";

  // Subtitle: a one-liner summarizing the config so the user doesn't have to
  // click every node. Keep it short — the node card is intentionally narrow.
  let subtitle = "";
  if (data.kind === "wait") {
    subtitle = `${Number(data.amount ?? 1)} ${(data.unit as string) ?? "day"}`;
  } else if (data.kind === "sendEmail" && data.subject) {
    subtitle = String(data.subject).slice(0, 32);
  } else if (data.kind === "sendSms" && data.body) {
    subtitle = String(data.body).slice(0, 32);
  } else if (data.kind === "branch") {
    subtitle = `${data.field ?? ""} ${data.op ?? ""} ${data.value ?? ""}`.trim();
  } else if (data.kind === "updateContact" && data.attribute) {
    subtitle = `${data.attribute} = ${data.value ?? ""}`;
  }

  return (
    <div
      className={`bg-surface-raised border rounded-lg shadow-sm min-w-[180px] max-w-[220px] ${
        selected ? "border-brand-500 shadow-brand-glow" : "border-ink-muted/20"
      }`}
    >
      {!isTrigger && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-2.5 !h-2.5 !bg-ink-muted/40 !border-ink-muted/60"
        />
      )}
      <div className="p-2.5">
        <div className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded grid place-items-center shrink-0 ${tint}`}>
            {meta?.icon}
          </span>
          <div className="text-xs font-semibold text-ink truncate flex-1">{label}</div>
        </div>
        {subtitle && (
          <div className="text-[10px] text-ink-muted mt-1 truncate">{subtitle}</div>
        )}
      </div>
      {isBranch ? (
        <>
          <div className="flex text-[10px] font-medium border-t border-ink-muted/10">
            <div className="flex-1 text-center py-1 text-green-700 border-e border-ink-muted/10">
              yes
            </div>
            <div className="flex-1 text-center py-1 text-red-600">no</div>
          </div>
          <Handle
            type="source"
            position={Position.Bottom}
            id="yes"
            style={{ left: "25%" }}
            className="!w-2.5 !h-2.5 !bg-green-500 !border-green-600"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="no"
            style={{ left: "75%" }}
            className="!w-2.5 !h-2.5 !bg-red-500 !border-red-600"
          />
        </>
      ) : (
        !isExit && (
          <Handle
            type="source"
            position={Position.Bottom}
            className="!w-2.5 !h-2.5 !bg-ink-muted/40 !border-ink-muted/60"
          />
        )
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { journey: JourneyNode };

// Simple id generator — persistent per graph but unique per drop. React Flow
// requires stable string ids so we tag with kind + counter + timestamp suffix.
let idSeq = 0;
function makeId(kind: NodeKind): string {
  idSeq += 1;
  return `${kind}_${Date.now().toString(36)}_${idSeq}`;
}

function BuilderInner({ initialNodes, initialEdges, onChange, readOnly }: JourneyBuilderProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<JourneyNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Notify parent on every graph mutation. useEffect keeps this out of the
  // render path so onChange never trips an update-during-render warning.
  useEffect(() => {
    onChange?.(nodes as JNode[], edges as JEdge[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Guard against deleting the trigger — a journey must have exactly one.
      const filtered = changes.filter((c) => {
        if (c.type === "remove") {
          const n = nodes.find((x) => x.id === c.id);
          if (n?.data.kind === "trigger") return false;
        }
        return true;
      });
      onNodesChangeInternal(filtered);
    },
    [nodes, onNodesChangeInternal],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeInternal(changes);
    },
    [onEdgesChangeInternal],
  );

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            // Label branch edges by handle so the graph reads cleanly.
            label: params.sourceHandle === "yes" ? "yes" : params.sourceHandle === "no" ? "no" : undefined,
            data: { handle: (params.sourceHandle as "yes" | "no" | null) ?? undefined },
          },
          eds,
        ),
      );
    },
    [setEdges],
  );

  // Drag-and-drop from the palette. dataTransfer carries the node kind
  // string; we position the new node at the drop point (projected to canvas
  // coordinates via rf.project).
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (readOnly) return;
      const kind = e.dataTransfer.getData("application/reactflow") as NodeKind;
      if (!kind) return;
      const meta = nodeKindMeta(kind);
      if (!meta) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position = rf.screenToFlowPosition({
        x: e.clientX - (bounds?.left ?? 0),
        y: e.clientY - (bounds?.top ?? 0),
      });

      const newNode: JNode = {
        id: makeId(kind),
        type: "journey",
        position,
        data: { kind, label: meta.label, ...meta.defaultData },
      };
      setNodes((ns) => [...ns, newNode]);
      setSelectedId(newNode.id);
    },
    [rf, setNodes, readOnly],
  );

  // Update the selected node's data in place. Used by the config panel.
  const updateNodeData = useCallback(
    (id: string, nextData: JourneyNodeData) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: nextData } : n)));
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [setNodes, setEdges],
  );

  const selectedNode = useMemo(
    () => (selectedId ? (nodes.find((n) => n.id === selectedId) as JNode | undefined) ?? null : null),
    [nodes, selectedId],
  );

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "200px 1fr 300px", height: "calc(100vh - 260px)", minHeight: 520 }}
    >
      <div className="bg-surface-raised border border-ink-muted/10 rounded-lg overflow-hidden">
        <JourneyNodePalette />
      </div>

      <div
        ref={wrapperRef}
        onDrop={onDrop}
        onDragOver={onDragOver}
        className="bg-surface-raised border border-ink-muted/10 rounded-lg overflow-hidden relative"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            style={{ width: 140, height: 90 }}
            nodeColor={(n) => {
              const m = nodeKindMeta((n.data as JourneyNodeData)?.kind);
              // Cheap heuristic: pull the tint's text color hex-ish shortcut.
              // React Flow just needs a string CSS color; grab from Tailwind palette proxy.
              return m ? "#c7d2fe" : "#e5e7eb";
            }}
          />
        </ReactFlow>
      </div>

      <div className="bg-surface-raised border border-ink-muted/10 rounded-lg overflow-hidden">
        <JourneyNodeConfig node={selectedNode} onChange={updateNodeData} onDelete={deleteNode} />
      </div>
    </div>
  );
}

// React Flow requires provider context for hooks (useReactFlow) to work.
// Wrap the inner component so consumers get a single self-contained export.
export function JourneyBuilder(props: JourneyBuilderProps) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}

// Client-side graph validation used before Activate. Returns list of human
// error strings; empty array means graph is valid. Backend runs the same
// checks server-side, but this gives instant feedback in the UI.
export function validateJourneyGraph(nodes: JNode[], edges: JEdge[]): string[] {
  const errors: string[] = [];
  const triggers = nodes.filter((n) => n.data.kind === "trigger");
  if (triggers.length === 0) errors.push("Journey has no trigger node.");
  if (triggers.length > 1) errors.push("Journey has more than one trigger node.");

  // Orphan check: every non-trigger node must have at least one incoming edge.
  const incoming = new Set(edges.map((e) => e.target));
  for (const n of nodes) {
    if (n.data.kind === "trigger") continue;
    if (!incoming.has(n.id)) {
      errors.push(`Node "${(n.data.label as string) || n.data.kind}" is not connected to the graph.`);
    }
  }

  // Branch nodes must have both a "yes" and "no" outgoing edge (or none).
  for (const n of nodes.filter((x) => x.data.kind === "branch")) {
    const out = edges.filter((e) => e.source === n.id);
    if (out.length === 0) continue;
    const hasYes = out.some((e) => e.sourceHandle === "yes");
    const hasNo = out.some((e) => e.sourceHandle === "no");
    if (!hasYes || !hasNo) {
      errors.push(
        `Branch "${(n.data.label as string) || "branch"}" must connect both yes and no outputs.`,
      );
    }
  }

  return errors;
}
