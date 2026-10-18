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

export interface PurchaseInvoicePrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  invoice: {
    name: string;
    supplierInvoiceNo?: string | null;
    postingDate: string | Date;
    dueDate?: string | Date | null;
    currency: string;
    netTotal: number | string;
    totalTaxes: number | string;
    grandTotal: number | string;
    outstandingAmt: number | string;
    status: string;
    remarks?: string | null;
    supplier: {
      supplierName: string;
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
    }[];
    taxes?: {
      description: string;
      rate: number | string;
      taxAmount: number | string;
    }[];
  };
}

export function PurchaseInvoiceDocument({
  tenantName,
  letterhead,
  format,
  invoice,
}: PurchaseInvoicePrintProps) {
  const showDesc = format?.showItemDescription ?? true;
  const showTaxes = format?.showTaxBreakdown ?? true;
  const showRemarks = format?.showRemarks ?? true;
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={invoice.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader
            tenantName={tenantName}
            docLabel="Purchase Invoice"
            letterhead={letterhead}
          />
          <View>
            <Text style={styles.docTitle}>{invoice.name}</Text>
            <Text style={styles.docSub}>
              {fmtDate(invoice.postingDate)}
              {invoice.dueDate ? `  ·  due ${fmtDate(invoice.dueDate)}` : ""}
            </Text>
            {invoice.supplierInvoiceNo && (
              <Text style={styles.docSub}>Bill #: {invoice.supplierInvoiceNo}</Text>
            )}
            <Text style={styles.docSub}>Status: {invoice.status}</Text>
          </View>
        </View>

        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Bill from</Text>
          <Text style={styles.strong}>{invoice.supplier.supplierName}</Text>
          {invoice.supplier.email && <Text>{invoice.supplier.email}</Text>}
          {invoice.supplier.mobile && <Text>{invoice.supplier.mobile}</Text>}
          {invoice.supplier.gstin && (
            <Text style={{ color: "#6b7280" }}>GSTIN: {invoice.supplier.gstin}</Text>
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
          {invoice.items.map((it, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colItem}>
                <Text style={styles.strong}>
                  {it.itemCode ? `${it.itemCode} — ` : ""}
                  {it.itemName ?? ""}
                </Text>
                {showDesc && it.description && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>{it.description}</Text>
                )}
              </View>
              <Text style={styles.colQty}>{Number(it.qty)}</Text>
              <Text style={styles.colRate}>{fmt(it.rate)}</Text>
              <Text style={styles.colAmount}>{fmt(it.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBox}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>
              {fmt(invoice.netTotal)} {invoice.currency}
            </Text>
          </View>
          {showTaxes &&
            invoice.taxes?.map((t, i) => (
              <View key={i} style={styles.totalRow}>
                <Text style={{ color: "#6b7280" }}>
                  {t.description} ({Number(t.rate)}%)
                </Text>
                <Text>{fmt(t.taxAmount)}</Text>
              </View>
            ))}
          <View style={styles.grandTotalRow}>
            <Text style={styles.strong}>Grand Total</Text>
            <Text style={styles.strong}>
              {fmt(invoice.grandTotal)} {invoice.currency}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={{ color: "#6b7280" }}>Outstanding</Text>
            <Text style={{ color: "#6b7280" }}>
              {fmt(invoice.outstandingAmt)} {invoice.currency}
            </Text>
          </View>
        </View>

        {showRemarks && invoice.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Remarks</Text>
            <Text>{invoice.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
