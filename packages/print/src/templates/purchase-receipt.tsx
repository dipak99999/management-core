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

export interface PurchaseReceiptPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  receipt: {
    name: string;
    postingDate: string | Date;
    status: string;
    remarks?: string | null;
    supplier: {
      supplierName: string;
      email?: string | null;
      mobile?: string | null;
    };
    toWarehouse: string;
    items: {
      itemCode?: string;
      itemName?: string;
      description?: string | null;
      qty: number | string;
      uom: string;
      rate: number | string;
      amount: number | string;
    }[];
    grandTotal: number | string;
    currency: string;
  };
}

export function PurchaseReceiptDocument({
  tenantName,
  letterhead,
  format,
  receipt,
}: PurchaseReceiptPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={receipt.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Purchase Receipt" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{receipt.name}</Text>
            <Text style={styles.docSub}>{fmtDate(receipt.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {receipt.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Received from</Text>
          <Text style={styles.strong}>{receipt.supplier.supplierName}</Text>
          {receipt.supplier.email && <Text>{receipt.supplier.email}</Text>}
          <Text style={{ color: "#6b7280", marginTop: 4 }}>
            Into warehouse: {receipt.toWarehouse}
          </Text>
        </View>

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colItem}>Item</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colRate}>Rate</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {receipt.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>
                  {it.itemCode ? `${it.itemCode} — ` : ""}
                  {it.itemName ?? ""}
                </Text>
                {it.description && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.description}</Text>
                )}
                <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.uom}</Text>
              </View>
              <Text style={styles.colQty}>{fmt(it.qty)}</Text>
              <Text style={styles.colRate}>{fmt(it.rate)}</Text>
              <Text style={styles.colAmount}>{fmt(it.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.grandTotalRow}>
            <Text style={styles.strong}>Grand Total</Text>
            <Text style={styles.strong}>
              {fmt(receipt.grandTotal)} {receipt.currency}
            </Text>
          </View>
        </View>

        {receipt.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{receipt.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
