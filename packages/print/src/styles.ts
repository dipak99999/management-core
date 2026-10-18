import { StyleSheet } from "@react-pdf/renderer";

// Shared styles across all doctype templates. Keeps every doc's look
// consistent (fonts, spacing, tables, totals box) so tenants get a coherent
// print pack rather than a patchwork.
export const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  tenantName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docSub: { color: "#6b7280", textAlign: "right" },
  block: { marginBottom: 12 },
  label: { color: "#6b7280", fontSize: 9, marginBottom: 2 },
  strong: { fontFamily: "Helvetica-Bold" },
  hr: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginVertical: 8 },
  th: {
    backgroundColor: "#f3f4f6",
    padding: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#374151",
  },
  td: { padding: 6, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  row: { flexDirection: "row" },
  colItem: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colRate: { flex: 1, textAlign: "right" },
  colAmount: { flex: 1.4, textAlign: "right" },
  totalsBox: { alignSelf: "flex-end", width: 220, marginTop: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#111827",
    paddingTop: 6,
    marginTop: 4,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
  // Debit/Credit two-col styles for JE-like docs.
  colAcct: { flex: 4 },
  colDebit: { flex: 1.4, textAlign: "right" },
  colCredit: { flex: 1.4, textAlign: "right" },
});

export const fmt = (n: number | string): string => Number(n).toFixed(2);
export const fmtDate = (d: string | Date): string =>
  (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
