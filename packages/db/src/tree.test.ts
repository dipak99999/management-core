import { describe, expect, it } from "vitest";
import {
  buildTree,
  collectIds,
  countTree,
  filterTree,
  flattenTree,
  type TreeNode,
} from "./tree";

// Fixture: 3-level chart-of-accounts shape.
//   Assets [group]
//     Cash [leaf]
//     Bank [group]
//       HDFC Current [leaf]
//   Liabilities [group]
//     Creditors [leaf]
//   Orphan [leaf, parentId=missing]
interface Row {
  id: string;
  name: string;
  parentId: string | null;
}
const rows: Row[] = [
  { id: "assets", name: "Assets", parentId: null },
  { id: "cash", name: "Cash", parentId: "assets" },
  { id: "bank", name: "Bank", parentId: "assets" },
  { id: "hdfc", name: "HDFC Current", parentId: "bank" },
  { id: "liab", name: "Liabilities", parentId: null },
  { id: "cred", name: "Creditors", parentId: "liab" },
  { id: "orphan", name: "Orphan", parentId: "ghost-id" },
];

const getId = (r: Row) => r.id;
const getParentId = (r: Row) => r.parentId;

describe("buildTree", () => {
  it("groups children under their parent", () => {
    const tree = buildTree(rows, getId, getParentId);
    const assets = tree.find((n) => n.row.id === "assets")!;
    expect(assets.children.map((c) => c.row.id).sort()).toEqual(["bank", "cash"]);
    const bank = assets.children.find((n) => n.row.id === "bank")!;
    expect(bank.children.map((c) => c.row.id)).toEqual(["hdfc"]);
  });

  it("treats rows with an unresolved parentId as roots (visible, not lost)", () => {
    // "orphan" points at "ghost-id" which doesn't exist. Losing the row
    // silently would hide broken data — surfacing it as a root lets the
    // operator see + fix.
    const tree = buildTree(rows, getId, getParentId);
    expect(tree.map((n) => n.row.id).sort()).toEqual(["assets", "liab", "orphan"]);
  });

  it("treats rows with parentId === own id as roots (self-reference is a cycle)", () => {
    const self: Row[] = [{ id: "a", name: "Self", parentId: "a" }];
    const tree = buildTree(self, getId, getParentId);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toEqual([]);
  });

  it("breaks A→B→A cycles by dropping both back to root", () => {
    const cyc: Row[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    const tree = buildTree(cyc, getId, getParentId);
    // Whichever we resolve first pulls the other under it and the second
    // pass sees a cycle; the important invariant is: no infinite loop, and
    // both rows remain visible somewhere in the tree.
    const ids = collectIds(tree, getId);
    expect(new Set(ids)).toEqual(new Set(["a", "b"]));
  });

  it("handles empty input", () => {
    expect(buildTree([], getId, getParentId)).toEqual([]);
  });
});

describe("countTree + flattenTree + collectIds", () => {
  const tree = buildTree(rows, getId, getParentId);

  it("counts every node including nested descendants", () => {
    expect(countTree(tree)).toBe(rows.length);
  });

  it("flattens depth-first, preserving order", () => {
    const flat = flattenTree(tree);
    // Assets → Bank → HDFC → Cash → Liabilities → Creditors → Orphan
    // (children order depends on iteration; assert set + roots order)
    expect(flat).toHaveLength(rows.length);
    // Roots always come out in insertion order.
    const rootIds = tree.map((n) => n.row.id);
    expect(rootIds).toEqual(["assets", "liab", "orphan"]);
  });

  it("collects every id via collectIds", () => {
    const ids = collectIds(tree, getId).sort();
    expect(ids).toEqual([...rows.map((r) => r.id)].sort());
  });
});

describe("filterTree — preserves ancestors of any match", () => {
  const tree = buildTree(rows, getId, getParentId);

  it("keeps a deep match's full ancestor path visible", () => {
    // Search "HDFC" — should keep Assets > Bank > HDFC, drop everything else.
    const filtered = filterTree(tree, (r) => r.name.toLowerCase().includes("hdfc"));
    expect(filtered.map((n) => n.row.id)).toEqual(["assets"]);
    const assets = filtered[0];
    expect(assets.children.map((n) => n.row.id)).toEqual(["bank"]);
    const bank = assets.children[0];
    expect(bank.children.map((n) => n.row.id)).toEqual(["hdfc"]);
  });

  it("keeps a group whose OWN name matches even if no children match", () => {
    const filtered = filterTree(tree, (r) => r.name === "Liabilities");
    expect(filtered.map((n) => n.row.id)).toEqual(["liab"]);
    expect(filtered[0].children).toEqual([]);
  });

  it("returns empty when nothing matches (not the original tree)", () => {
    const filtered = filterTree(tree, () => false);
    expect(filtered).toEqual([]);
  });

  it("keeps everything when predicate is always true", () => {
    const filtered = filterTree(tree, () => true);
    expect(countTree(filtered)).toBe(countTree(tree));
  });
});
