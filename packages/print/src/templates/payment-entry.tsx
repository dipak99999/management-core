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

// Payment receipt / voucher. Works for both Receive (from customer) and Pay
// (to supplier / employee) — the `paymentType` field drives the header wording.

export interface PaymentEntryPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  entry: {
    name: string;
    paymentType: "Receive" | "Pay";
    postingDate: string | Date;
    modeOfPayment: string;
    partyType: string;
    partyName: string;
    paidAmount: number | string;
    currency: string;
    status: string;
    remarks?: string | null;
    references: {
      voucherType: string;
      voucherName: string;
      allocatedAmount: number | string;
    }[];
  };
}

export function PaymentEntryDocument({
  tenantName,
  letterhead,
  format,
  entry,
}: PaymentEntryPrintProps) {
  const title =
    entry.paymentType === "Receive" ? "Payment Receipt" : "Payment Voucher";
  const partyLabel =
    entry.paymentType === "Receive" ? "Received from" : "Paid to";
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={entry.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel={title} letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{entry.name}</Text>
            <Text style={styles.docSub}>{fmtDate(entry.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {entry.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>{partyLabel} ({entry.partyType})</Text>
          <Text style={styles.strong}>{entry.partyName}</Text>
        </View>

        <View
          style={{
            backgroundColor: "#f3f4f6",
            padding: 16,
            marginVertical: 8,
            borderRadius: 4,
          }}
        >
          <Text style={styles.label}>Amount ({entry.modeOfPayment})</Text>
          <Text style={{ fontSize: 24, fontFamily: "Helvetica-Bold" }}>
            {fmt(entry.paidAmount)} {entry.currency}
          </Text>
        </View>

        {entry.references.length > 0 && (
          <>
            <View style={styles.hr} />
            <Text style={styles.label}>Applied against</Text>
            <View>
              <View style={[styles.row, styles.th]}>
                <Text style={styles.colItem}>Voucher</Text>
                <Text style={styles.colAmount}>Allocated</Text>
              </View>
              {entry.references.map((r, i) => (
                <View key={i} style={[styles.row, styles.td]}>
                  <Text style={styles.colItem}>
                    {r.voucherType} — {r.voucherName}
                  </Text>
                  <Text style={styles.colAmount}>{fmt(r.allocatedAmount)}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {entry.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{entry.remarks}</Text>
          </View>
        )}

        <View style={{ marginTop: 40, flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <View
              style={{
                borderTopWidth: 0.5,
                borderTopColor: "#111827",
                marginTop: 24,
                width: 160,
              }}
            />
            <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>Prepared by</Text>
          </View>
          <View>
            <View
              style={{
                borderTopWidth: 0.5,
                borderTopColor: "#111827",
                marginTop: 24,
                width: 160,
              }}
            />
            <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
              {entry.paymentType === "Receive" ? "Received by" : "Received by (party)"}
            </Text>
          </View>
        </View>

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
