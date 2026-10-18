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

export interface StockEntryPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  entry: {
    name: string;
    postingDate: string | Date;
    entryType: string; // Receipt / Issue / Transfer / Manufacture / Repack
    status: string;
    remarks?: string | null;
    fromWarehouse?: string | null;
    toWarehouse?: string | null;
    items: {
      itemCode?: string;
      itemName?: string;
      qty: number | string;
      uom: string;
      rate?: number | string | null;
      amount?: number | string | null;
      fromWarehouse?: string | null;
      toWarehouse?: string | null;
    }[];
    totalAmount?: number | string | null;
  };
}

export function StockEntryDocument({
  tenantName,
  letterhead,
  format,
  entry,
}: StockEntryPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={entry.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader
            tenantName={tenantName}
            docLabel={`Stock Entry — ${entry.entryType}`}
            letterhead={letterhead}
          />
          <View>
            <Text style={styles.docTitle}>{entry.name}</Text>
            <Text style={styles.docSub}>{fmtDate(entry.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {entry.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          {entry.fromWarehouse && (
            <Text>
              <Text style={styles.label}>From: </Text>
              {entry.fromWarehouse}
            </Text>
          )}
          {entry.toWarehouse && (
            <Text>
              <Text style={styles.label}>To: </Text>
              {entry.toWarehouse}
            </Text>
          )}
        </View>

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colItem}>Item</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colRate}>Rate</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {entry.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>
                  {it.itemCode ? `${it.itemCode} — ` : ""}
                  {it.itemName ?? ""}
                </Text>
                <Text style={{ color: "#6b7280", fontSize: 8 }}>
                  {it.uom}
                  {it.fromWarehouse && ` · from ${it.fromWarehouse}`}
                  {it.toWarehouse && ` · to ${it.toWarehouse}`}
                </Text>
              </View>
              <Text style={styles.colQty}>{fmt(it.qty)}</Text>
              <Text style={styles.colRate}>{it.rate ? fmt(it.rate) : "—"}</Text>
              <Text style={styles.colAmount}>{it.amount ? fmt(it.amount) : "—"}</Text>
            </View>
          ))}
        </View>

        {entry.totalAmount != null && (
          <View style={styles.totalsBox}>
            <View style={styles.grandTotalRow}>
              <Text style={styles.strong}>Total value</Text>
              <Text style={styles.strong}>{fmt(entry.totalAmount)}</Text>
            </View>
          </View>
        )}

        {entry.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{entry.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
