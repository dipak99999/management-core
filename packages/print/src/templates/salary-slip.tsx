import * as React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import {
  FormatFooterBlocks,
  FormatHeaderBanner,
  LetterheadHeader,
  PageFooter,
  Watermark,
  type PrintFormatOverrides,
  type PrintLetterhead,
} from "../letterhead";
import { tf } from "../i18n";

export interface SalarySlipPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  locale?: string | null;
  slip: {
    name: string;
    startDate: string | Date;
    endDate: string | Date;
    grossPay: number | string;
    totalDeduction: number | string;
    netPay: number | string;
    status: string;
    remarks?: string | null;
    employee: {
      employeeCode: string;
      employeeName: string;
      designation?: string | null;
      department?: string | null;
      bankAccountNo?: string | null;
    };
    components: {
      componentName: string;
      type: "Earning" | "Deduction";
      amount: number | string;
    }[];
  };
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  tenantName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  docSub: { color: "#6b7280", textAlign: "right" },
  block: { marginBottom: 12 },
  label: { color: "#6b7280", fontSize: 9, marginBottom: 2 },
  strong: { fontFamily: "Helvetica-Bold" },
  hr: { borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginVertical: 8 },
  twoCol: { flexDirection: "row", gap: 16 },
  colHalf: { flex: 1 },
  th: {
    backgroundColor: "#f3f4f6",
    padding: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#374151",
  },
  td: { padding: 6, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  row: { flexDirection: "row" },
  colName: { flex: 3 },
  colAmount: { flex: 1, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#111827",
    paddingTop: 6,
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
  },
  netBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#ecfdf5",
    borderLeftWidth: 4,
    borderLeftColor: "#059669",
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
});

function fmt(n: number | string): string {
  return Number(n).toFixed(2);
}

function fmtDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function SalarySlipDocument({
  tenantName,
  letterhead,
  format,
  slip,
  locale,
}: SalarySlipPrintProps) {
  const earnings = slip.components.filter((c) => c.type === "Earning");
  const deductions = slip.components.filter((c) => c.type === "Deduction");
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  const t = tf(locale);

  return (
    <Document title={slip.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel={t("Salary Slip")} letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{slip.name}</Text>
            <Text style={styles.docSub}>
              {fmtDate(slip.startDate)} → {fmtDate(slip.endDate)}
            </Text>
            <Text style={styles.docSub}>
              {t("Status")}: {slip.status}
            </Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>{t("Employee")}</Text>
          <Text style={styles.strong}>{slip.employee.employeeName}</Text>
          <Text style={{ color: "#6b7280" }}>
            {slip.employee.employeeCode}
            {slip.employee.designation ? `  ·  ${slip.employee.designation}` : ""}
            {slip.employee.department ? `  ·  ${slip.employee.department}` : ""}
          </Text>
          {slip.employee.bankAccountNo && (
            <Text style={{ color: "#6b7280" }}>
              Bank A/C: {slip.employee.bankAccountNo}
            </Text>
          )}
        </View>

        <View style={styles.hr} />

        <View style={styles.twoCol}>
          <View style={styles.colHalf}>
            <View style={[styles.row, styles.th]}>
              <Text style={styles.colName}>{t("Earnings")}</Text>
              <Text style={styles.colAmount}>{t("Amount")}</Text>
            </View>
            {earnings.map((c, i) => (
              <View key={i} style={[styles.row, styles.td]}>
                <Text style={styles.colName}>{c.componentName}</Text>
                <Text style={styles.colAmount}>{fmt(c.amount)}</Text>
              </View>
            ))}
            {earnings.length === 0 && (
              <View style={styles.td}>
                <Text style={{ color: "#9ca3af", textAlign: "center" }}>none</Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text>{t("Gross")}</Text>
              <Text>{fmt(slip.grossPay)}</Text>
            </View>
          </View>

          <View style={styles.colHalf}>
            <View style={[styles.row, styles.th]}>
              <Text style={styles.colName}>{t("Deductions")}</Text>
              <Text style={styles.colAmount}>{t("Amount")}</Text>
            </View>
            {deductions.map((c, i) => (
              <View key={i} style={[styles.row, styles.td]}>
                <Text style={styles.colName}>{c.componentName}</Text>
                <Text style={styles.colAmount}>{fmt(c.amount)}</Text>
              </View>
            ))}
            {deductions.length === 0 && (
              <View style={styles.td}>
                <Text style={{ color: "#9ca3af", textAlign: "center" }}>none</Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text>{t("Total Deductions")}</Text>
              <Text>{fmt(slip.totalDeduction)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.netBox}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={styles.strong}>{t("Net Pay")}</Text>
            <Text style={{ ...styles.strong, fontSize: 14 }}>{fmt(slip.netPay)}</Text>
          </View>
        </View>

        {slip.remarks && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.label}>{t("Remarks")}</Text>
            <Text>{slip.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
