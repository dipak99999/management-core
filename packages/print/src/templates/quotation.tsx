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

export interface QuotationPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  quotation: {
    name: string;
    postingDate: string | Date;
    validTill?: string | Date | null;
    status: string;
    remarks?: string | null;
    currency: string;
    netTotal: number | string;
    party: {
      name: string;
      email?: string | null;
      mobile?: string | null;
      kind: "Customer" | "Lead";
    };
    items: {
      itemCode?: string;
      itemName?: string;
      description?: string | null;
      qty: number | string;
      rate: number | string;
      amount: number | string;
    }[];
  };
}

export function QuotationDocument({
  tenantName,
  letterhead,
  format,
  quotation,
}: QuotationPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={quotation.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Quotation" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{quotation.name}</Text>
            <Text style={styles.docSub}>{fmtDate(quotation.postingDate)}</Text>
            {quotation.validTill && (
              <Text style={styles.docSub}>Valid till {fmtDate(quotation.validTill)}</Text>
            )}
            <Text style={styles.docSub}>Status: {quotation.status}</Text>
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Quotation for ({quotation.party.kind})</Text>
          <Text style={styles.strong}>{quotation.party.name}</Text>
          {quotation.party.email && <Text>{quotation.party.email}</Text>}
          {quotation.party.mobile && <Text>{quotation.party.mobile}</Text>}
        </View>

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colItem}>Item</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colRate}>Rate</Text>
            <Text style={styles.colAmount}>Amount</Text>
          </View>
          {quotation.items.map((it, i) => (
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
              {fmt(quotation.netTotal)} {quotation.currency}
            </Text>
          </View>
        </View>

        {quotation.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Terms &amp; conditions</Text>
            <Text>{quotation.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
