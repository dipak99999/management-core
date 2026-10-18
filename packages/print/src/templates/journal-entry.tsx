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

// Journal Entry voucher. Two-column debit/credit table with a balance-check
// footer.

export interface JournalEntryPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  entry: {
    name: string;
    postingDate: string | Date;
    status: string;
    voucherType?: string | null;
    remarks?: string | null;
    lines: {
      accountName: string;
      debit: number | string;
      credit: number | string;
      partyType?: string | null;
      partyName?: string | null;
    }[];
  };
}

export function JournalEntryDocument({
  tenantName,
  letterhead,
  format,
  entry,
}: JournalEntryPrintProps) {
  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={entry.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader tenantName={tenantName} docLabel="Journal Entry" letterhead={letterhead} />
          <View>
            <Text style={styles.docTitle}>{entry.name}</Text>
            <Text style={styles.docSub}>{fmtDate(entry.postingDate)}</Text>
            <Text style={styles.docSub}>Status: {entry.status}</Text>
            {entry.voucherType && (
              <Text style={styles.docSub}>{entry.voucherType}</Text>
            )}
          </View>
        </View>
        <FormatHeaderBanner format={format} />

        <View style={styles.hr} />

        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={styles.colAcct}>Account</Text>
            <Text style={styles.colDebit}>Debit</Text>
            <Text style={styles.colCredit}>Credit</Text>
          </View>
          {entry.lines.map((l, i) => (
            <View key={i} style={[styles.row, styles.td]}>
              <View style={styles.colAcct}>
                <Text style={styles.strong}>{l.accountName}</Text>
                {l.partyName && (
                  <Text style={{ color: "#6b7280", fontSize: 9 }}>
                    {l.partyType}: {l.partyName}
                  </Text>
                )}
              </View>
              <Text style={styles.colDebit}>
                {Number(l.debit) > 0 ? fmt(l.debit) : ""}
              </Text>
              <Text style={styles.colCredit}>
                {Number(l.credit) > 0 ? fmt(l.credit) : ""}
              </Text>
            </View>
          ))}
          <View
            style={[
              styles.row,
              {
                borderTopWidth: 1,
                borderTopColor: "#111827",
                paddingVertical: 6,
                marginTop: 2,
              },
            ]}
          >
            <Text style={[styles.colAcct, styles.strong]}>Totals</Text>
            <Text style={[styles.colDebit, styles.strong]}>{fmt(totalDebit)}</Text>
            <Text style={[styles.colCredit, styles.strong]}>{fmt(totalCredit)}</Text>
          </View>
        </View>

        {entry.remarks && (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.label}>Narration</Text>
            <Text>{entry.remarks}</Text>
          </View>
        )}

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
