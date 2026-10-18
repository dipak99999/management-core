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

export interface DeliveryNotePrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  note: {
    name: string;
    postingDate: string | Date;
    status: string;
    remarks?: string | null;
    customer: {
      customerName: string;
      email?: string | null;
      mobile?: string | null;
    };
    fromWarehouse: string;
    items: {
      itemCode?: string;
      itemName?: string;
      description?: string | null;
      qty: number | string;
      uom: string;
    }[];
  };
}

export function DeliveryNoteDocument({
  tenantName,
  letterhead,
  format,
  note,
}: DeliveryNotePrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={note.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Delivery Note" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{note.name}</Text>
            <Text style={styles.docSub}>{fmtDate(note.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {note.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Ship to</Text>
          <Text style={styles.strong}>{note.customer.customerName}</Text>
          {note.customer.email && <Text>{note.customer.email}</Text>}
          {note.customer.mobile && <Text>{note.customer.mobile}</Text>}
          <Text style={{ color: "#6b7280", marginTop: 4 }}>
            From warehouse: {note.fromWarehouse}
          </Text>
        </View>

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colItem}>Item</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colRate}>UOM</Text>
          </View>
          {note.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>
                  {it.itemCode ? `${it.itemCode} — ` : ""}
                  {it.itemName ?? ""}
                </Text>
                {it.description && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.description}</Text>
                )}
              </View>
              <Text style={styles.colQty}>{fmt(it.qty)}</Text>
              <Text style={styles.colRate}>{it.uom}</Text>
            </View>
          ))}
        </View>

        {note.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{note.remarks}</Text>
          </View>
        )}

        <View style={{ marginTop: 40 }}>
          <Text style={styles.label}>Received in good condition</Text>
          <View
            style={{
              borderTopWidth: 0.5,
              borderTopColor: "#111827",
              marginTop: 24,
              width: 200,
            }}
          />
          <Text style={{ fontSize: 8, color: "#6b7280", marginTop: 4 }}>
            Signature / Date
          </Text>
        </View>

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
