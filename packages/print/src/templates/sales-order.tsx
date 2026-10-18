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

export interface SalesOrderPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  order: {
    name: string;
    postingDate: string | Date;
    deliveryDate?: string | Date | null;
    status: string;
    remarks?: string | null;
    currency: string;
    netTotal: number | string;
    customer: {
      customerName: string;
      email?: string | null;
      mobile?: string | null;
      gstin?: string | null;
    };
    items: {
      itemCode?: string;
      itemName?: string;
      description?: string | null;
      qty: number | string;
      rate: number | string;
      amount: number | string;
      billedQty?: number | string;
      deliveredQty?: number | string;
    }[];
  };
}

export function SalesOrderDocument({
  tenantName,
  letterhead,
  format,
  order,
}: SalesOrderPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={order.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Sales Order" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{order.name}</Text>
            <Text style={styles.docSub}>{fmtDate(order.postingDate)}</Text>
            {order.deliveryDate && (
              <Text style={styles.docSub}>Delivery {fmtDate(order.deliveryDate)}</Text>
            )}
            <Text style={styles.docSub}>Status: {order.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Buyer</Text>
          <Text style={styles.strong}>{order.customer.customerName}</Text>
          {order.customer.email && <Text>{order.customer.email}</Text>}
          {order.customer.mobile && <Text>{order.customer.mobile}</Text>}
          {order.customer.gstin && (
            <Text style={{ color: "#6b7280" }}>GSTIN: {order.customer.gstin}</Text>
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
          {order.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>
                  {it.itemCode ? `${it.itemCode} — ` : ""}
                  {it.itemName ?? ""}
                </Text>
                {it.description && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.description}</Text>
                )}
                {(it.billedQty !== undefined || it.deliveredQty !== undefined) && (
                  <Text style={{ color: "#6b7280", fontSize: 8 }}>
                    Billed {fmt(it.billedQty ?? 0)} · Delivered{" "}
                    {fmt(it.deliveredQty ?? 0)}
                  </Text>
                )}
              </View>
              <Text style={styles.colQty}>{Number(it.qty)}</Text>
              <Text style={styles.colRate}>{fmt(it.rate)}</Text>
              <Text style={styles.colAmount}>{fmt(it.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.grandTotalRow}>
            <Text style={styles.strong}>Total</Text>
            <Text style={styles.strong}>
              {fmt(order.netTotal)} {order.currency}
            </Text>
          </View>
        </View>

        {order.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{order.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
