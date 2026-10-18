import * as React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { styles, fmt, fmtDate } from "../styles";
import {
  FormatFooterBlocks,
  FormatHeaderBanner,
  LetterheadHeader,
  PageFooter,
  Watermark,
  type PrintFormatOverrides,
  type PrintLetterhead,
} from "../letterhead";

export interface ExpenseClaimPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  claim: {
    name: string;
    postingDate: string | Date;
    status: string;
    remarks?: string | null;
    employee: {
      employeeCode: string;
      employeeName: string;
      department?: string | null;
    };
    items: {
      typeName: string;
      description?: string | null;
      amount: number | string;
    }[];
    totalAmount: number | string;
  };
}

export function ExpenseClaimDocument({
  tenantName,
  letterhead,
  format,
  claim,
}: ExpenseClaimPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={claim.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Expense Claim" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{claim.name}</Text>
            <Text style={styles.docSub}>{fmtDate(claim.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {claim.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Claimant</Text>
          <Text style={styles.strong}>
            {claim.employee.employeeName}{" "}
            <Text style={{ fontFamily: "Helvetica", color: "#6b7280" }}>
              {claim.employee.employeeCode}
            </Text>
          </Text>
          {claim.employee.department && (
            <Text style={{ color: "#6b7280" }}>{claim.employee.department}</Text>
          )}
        </View>

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colItem}>Expense</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {claim.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>{it.typeName}</Text>
                {it.description && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.description}</Text>
                )}
              </View>
              <Text style={styles.colAmount}>{fmt(it.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.grandTotalRow}>
            <Text style={styles.strong}>Total claim</Text>
            <Text style={styles.strong}>{fmt(claim.totalAmount)}</Text>
          </View>
        </View>

        {claim.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Notes</Text>
            <Text>{claim.remarks}</Text>
          </View>
        )}

        <View
          style={{
            marginTop: 40,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          {["Claimant", "Manager approval", "Accounts"].map((label) => (
            <View key={label}>
              <View
                style={{
                  borderTopWidth: 0.5,
                  borderTopColor: "#111827",
                  marginTop: 24,
                  width: 140,
                }}
              />
              <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>{label}</Text>
            </View>
          ))}
        </View>

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
