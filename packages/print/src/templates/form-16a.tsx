import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { tf } from "../i18n";

// India Form 16A — quarterly certificate of TDS deducted, issued by the
// deductor (tenant) to the deductee (supplier). NSDL provides the official
// PDF via TRACES; this template mirrors the shape (deductor + deductee
// blocks, PAN/TAN identifiers, per-challan breakdown of tax deducted +
// deposited) so an SME can hand the PDF to their vendor while the CA
// generates the official version at quarter-end.
//
// Layout is intentionally text-heavy + printer-friendly (no colors) so
// it fits the govt-form aesthetic vendors + accountants expect.

export interface Form16aPrintProps {
  tenantName: string;
  tenantAddress?: string | null;
  tenantTan?: string | null; // Tax Deduction & Collection Account Number
  tenantPan?: string | null;
  tenantGstin?: string | null;
  supplier: {
    supplierName: string;
    pan: string | null;
    address?: string | null;
    gstin?: string | null;
  };
  quarter: 1 | 2 | 3 | 4;
  fyLabel: string; // "2026-27"
  windowStart: string | Date;
  windowEnd: string | Date;
  // One row per (PE) payment in the quarter where TDS was deducted.
  payments: {
    peName: string;
    paidDate: string | Date;
    paidAmount: number | string;
    tdsAmount: number | string;
    tdsRate: number | string;
    section: string;
    // Challan info — only present when the tenant has recorded the
    // monthly TDS deposit challan and linked it to this quarter+section.
    challanNo?: string | null;
    challanDate?: string | Date | null;
  }[];
  totals: {
    totalPaid: number;
    totalTds: number;
  };
  // Optional locale prop for future multi-language forms (Hindi, etc).
  locale?: string | null;
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  titleBar: {
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#111827",
    paddingVertical: 6,
    textAlign: "center",
    marginBottom: 8,
  },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  subTitle: { fontSize: 9, color: "#6b7280" },
  section: {
    borderWidth: 1,
    borderColor: "#111827",
    padding: 6,
    marginBottom: 6,
  },
  sectionHeader: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row" },
  col2: { flex: 1 },
  label: { color: "#6b7280", fontSize: 8 },
  value: { fontFamily: "Helvetica-Bold" },
  tblHeader: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    borderBottomWidth: 1,
    borderColor: "#111827",
  },
  tblRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#d1d5db",
  },
  th: { padding: 4 },
  td: { padding: 4, fontSize: 8 },
  colPeName: { flex: 1.5 },
  colDate: { flex: 1 },
  colAmt: { flex: 1, textAlign: "right" },
  colRate: { flex: 0.6, textAlign: "right" },
  colSection: { flex: 0.8 },
  colChallan: { flex: 1 },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#111827",
    marginTop: 2,
    paddingTop: 4,
    fontFamily: "Helvetica-Bold",
  },
  disclaimer: {
    marginTop: 12,
    fontSize: 8,
    color: "#6b7280",
    fontStyle: "italic",
  },
  signBlock: {
    marginTop: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signBox: {
    width: 200,
    borderTopWidth: 1,
    borderColor: "#111827",
    paddingTop: 4,
    fontSize: 8,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#9ca3af",
    textAlign: "center",
  },
});

function fmt(n: number | string): string {
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function Form16aDocument({
  tenantName,
  tenantAddress,
  tenantTan,
  tenantPan,
  supplier,
  quarter,
  fyLabel,
  windowStart,
  windowEnd,
  payments,
  totals,
  locale,
}: Form16aPrintProps) {
  const t = tf(locale);
  return (
    <Document title={`Form 16A - ${supplier.supplierName} - Q${quarter} FY${fyLabel}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleBar}>
          <Text style={styles.title}>FORM No. 16A</Text>
          <Text style={styles.subTitle}>
            [See rule 31(1)(b)] Certificate under section 203 of the Income-tax
            Act, 1961 for tax deducted at source
          </Text>
          <Text style={styles.subTitle}>
            Q{quarter} · FY {fyLabel} · {fmtDate(windowStart)} → {fmtDate(windowEnd)}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Name & Address of the Deductor</Text>
          <View style={styles.row}>
            <View style={styles.col2}>
              <Text style={styles.value}>{tenantName}</Text>
              {tenantAddress && <Text>{tenantAddress}</Text>}
            </View>
            <View style={styles.col2}>
              <Text style={styles.label}>TAN of Deductor</Text>
              <Text style={styles.value}>{tenantTan ?? "— NOT SET —"}</Text>
              <Text style={{ ...styles.label, marginTop: 4 }}>PAN of Deductor</Text>
              <Text style={styles.value}>{tenantPan ?? "— NOT SET —"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Name & Address of the Deductee</Text>
          <View style={styles.row}>
            <View style={styles.col2}>
              <Text style={styles.value}>{supplier.supplierName}</Text>
              {supplier.address && <Text>{supplier.address}</Text>}
              {supplier.gstin && (
                <Text style={styles.label}>GSTIN: {supplier.gstin}</Text>
              )}
            </View>
            <View style={styles.col2}>
              <Text style={styles.label}>PAN of Deductee</Text>
              <Text style={{ ...styles.value, color: supplier.pan ? "#111827" : "#dc2626" }}>
                {supplier.pan ?? "— NOT AVAILABLE (higher TDS rate applies) —"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>
            Summary of TDS deducted this quarter
          </Text>
          <View style={styles.tblHeader}>
            <Text style={{ ...styles.th, ...styles.colPeName }}>{t("Payment")}</Text>
            <Text style={{ ...styles.th, ...styles.colDate }}>{t("Date")}</Text>
            <Text style={{ ...styles.th, ...styles.colAmt }}>Amount Paid</Text>
            <Text style={{ ...styles.th, ...styles.colRate }}>Rate %</Text>
            <Text style={{ ...styles.th, ...styles.colAmt }}>TDS</Text>
            <Text style={{ ...styles.th, ...styles.colSection }}>Section</Text>
            <Text style={{ ...styles.th, ...styles.colChallan }}>Challan</Text>
          </View>
          {payments.map((p, i) => (
            <View key={i} style={styles.tblRow}>
              <Text style={{ ...styles.td, ...styles.colPeName }}>{p.peName}</Text>
              <Text style={{ ...styles.td, ...styles.colDate }}>
                {fmtDate(p.paidDate)}
              </Text>
              <Text style={{ ...styles.td, ...styles.colAmt }}>{fmt(p.paidAmount)}</Text>
              <Text style={{ ...styles.td, ...styles.colRate }}>
                {Number(p.tdsRate).toFixed(2)}
              </Text>
              <Text style={{ ...styles.td, ...styles.colAmt }}>{fmt(p.tdsAmount)}</Text>
              <Text style={{ ...styles.td, ...styles.colSection }}>{p.section}</Text>
              <Text style={{ ...styles.td, ...styles.colChallan }}>
                {p.challanNo
                  ? `${p.challanNo}${p.challanDate ? ` (${fmtDate(p.challanDate)})` : ""}`
                  : "—"}
              </Text>
            </View>
          ))}
          {payments.length === 0 && (
            <View style={styles.td}>
              <Text style={{ color: "#9ca3af", textAlign: "center" }}>
                No TDS deducted for this deductee this quarter.
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={{ ...styles.td, ...styles.colPeName }}>TOTAL</Text>
            <Text style={{ ...styles.td, ...styles.colDate }} />
            <Text style={{ ...styles.td, ...styles.colAmt }}>
              {fmt(totals.totalPaid)}
            </Text>
            <Text style={{ ...styles.td, ...styles.colRate }} />
            <Text style={{ ...styles.td, ...styles.colAmt }}>
              {fmt(totals.totalTds)}
            </Text>
            <Text style={{ ...styles.td, ...styles.colSection }} />
            <Text style={{ ...styles.td, ...styles.colChallan }} />
          </View>
        </View>

        <Text style={styles.disclaimer}>
          This certificate is generated from the deductor's books and reflects
          TDS deducted at source only. The official Form 16A issued by NSDL
          (via TRACES) after quarterly return filing is the legally-authoritative
          document — this printout is provided for the deductee's records
          pending that official issuance. Rows without a challan reference
          indicate TDS has not yet been deposited to the government.
        </Text>

        <View style={styles.signBlock}>
          <View style={styles.signBox}>
            <Text>Signature of person responsible for deduction</Text>
            <Text style={styles.label}>Name, designation, date</Text>
          </View>
          <View style={styles.signBox}>
            <Text>Place</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Generated {new Date().toISOString().slice(0, 10)} · lumaara
        </Text>
      </Page>
    </Document>
  );
}
