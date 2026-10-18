import * as React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { fmt, fmtDate } from "../styles";

// 80mm thermal-friendly POS receipt. Narrow, monospaced-ish layout so it
// renders correctly on the common thermal-printer sizes (80mm ≈ 226pt at
// 72 DPI). Font is Helvetica for the PDF preview; when a tenant sends the
// receipt straight to an ESC/POS printer via the browser's Print dialog,
// the browser rasterises the PDF and the printer handles the rest.

const styles = StyleSheet.create({
  // 80mm wide, height auto-grows per line count. `size: [226, 800]` gives
  // us plenty of paper — receipts under this length just leave whitespace,
  // and taller ones will page-break at 800pt (unlikely for a real receipt).
  page: { padding: 12, fontSize: 8, fontFamily: "Helvetica" },
  center: { textAlign: "center" },
  strong: { fontFamily: "Helvetica-Bold" },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "center" },
  small: { fontSize: 7, color: "#4b5563" },
  hr: { borderBottomWidth: 0.5, borderBottomColor: "#000", marginVertical: 4 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  itemRow: { flexDirection: "row", marginTop: 2 },
  colName: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colRate: { flex: 1.2, textAlign: "right" },
  colAmt: { flex: 1.4, textAlign: "right" },
  grand: {
    borderTopWidth: 1,
    borderTopColor: "#000",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingVertical: 3,
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
  },
});

export interface POSReceiptProps {
  tenantName: string;
  addressText?: string | null;
  footerText?: string | null;
  invoice: {
    name: string;
    postingDate: string | Date;
    currency: string;
    netTotal: number | string;
    totalTaxes: number | string;
    grandTotal: number | string;
    roundedTotal?: number | string | null;
    customer: { customerName: string };
    items: {
      itemCode?: string | null;
      itemName?: string | null;
      qty: number | string;
      rate: number | string;
      amount: number | string;
    }[];
    taxes?: { description: string; taxAmount: number | string }[];
  };
  // Split-tender + change breakdown. Cashier UI passes these directly.
  tenders?: { mode: string; amount: number | string; reference?: string | null }[];
  changeGiven?: number | string | null;
  cashier?: string | null;
  sessionName?: string | null;
}

export function POSReceiptDocument(props: POSReceiptProps) {
  const {
    tenantName,
    addressText,
    footerText,
    invoice,
    tenders,
    changeGiven,
    cashier,
    sessionName,
  } = props;
  const total =
    invoice.roundedTotal != null && Number(invoice.roundedTotal) !== 0
      ? invoice.roundedTotal
      : invoice.grandTotal;

  return (
    <Document>
      <Page size={[226, 800]} style={styles.page}>
        <Text style={styles.title}>{tenantName}</Text>
        {addressText ? (
          <Text style={[styles.small, styles.center]}>{addressText}</Text>
        ) : null}
        <View style={styles.hr} />

        <View style={styles.row}>
          <Text style={styles.strong}>{invoice.name}</Text>
          <Text>{fmtDate(invoice.postingDate)}</Text>
        </View>
        <Text style={styles.small}>Customer: {invoice.customer.customerName}</Text>
        {cashier ? <Text style={styles.small}>Cashier: {cashier}</Text> : null}
        {sessionName ? <Text style={styles.small}>Session: {sessionName}</Text> : null}
        <View style={styles.hr} />

        <View style={styles.row}>
          <Text style={[styles.strong, styles.colName]}>Item</Text>
          <Text style={[styles.strong, styles.colQty]}>Qty</Text>
          <Text style={[styles.strong, styles.colRate]}>Rate</Text>
          <Text style={[styles.strong, styles.colAmt]}>Amt</Text>
        </View>
        {invoice.items.map((it, idx) => (
          <View key={idx} style={styles.itemRow}>
            <Text style={styles.colName}>
              {it.itemName ?? it.itemCode ?? "Item"}
            </Text>
            <Text style={styles.colQty}>{fmt(it.qty)}</Text>
            <Text style={styles.colRate}>{fmt(it.rate)}</Text>
            <Text style={styles.colAmt}>{fmt(it.amount)}</Text>
          </View>
        ))}
        <View style={styles.hr} />

        <View style={styles.row}>
          <Text>Subtotal</Text>
          <Text>
            {invoice.currency} {fmt(invoice.netTotal)}
          </Text>
        </View>
        {invoice.taxes?.map((t, i) => (
          <View style={styles.row} key={i}>
            <Text>{t.description}</Text>
            <Text>{fmt(t.taxAmount)}</Text>
          </View>
        ))}
        <View style={styles.grand}>
          <Text>TOTAL</Text>
          <Text>
            {invoice.currency} {fmt(total)}
          </Text>
        </View>

        {tenders && tenders.length > 0 ? (
          <View style={{ marginTop: 6 }}>
            <Text style={styles.strong}>Paid</Text>
            {tenders.map((t, i) => (
              <View key={i} style={styles.row}>
                <Text>
                  {t.mode}
                  {t.reference ? ` · ${t.reference}` : ""}
                </Text>
                <Text>{fmt(t.amount)}</Text>
              </View>
            ))}
            {changeGiven != null && Number(changeGiven) > 0 ? (
              <View style={styles.row}>
                <Text style={styles.strong}>Change</Text>
                <Text style={styles.strong}>{fmt(changeGiven)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.hr} />
        {footerText ? (
          <Text style={[styles.small, styles.center]}>{footerText}</Text>
        ) : (
          <Text style={[styles.small, styles.center]}>Thank you</Text>
        )}
      </Page>
    </Document>
  );
}
