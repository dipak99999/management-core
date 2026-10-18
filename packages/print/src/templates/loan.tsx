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

export interface LoanPrintProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  loan: {
    name: string;
    disbursementDate?: string | Date | null;
    status: string;
    principal: number | string;
    interestRate: number | string;
    termMonths: number;
    emi: number | string;
    outstanding: number | string;
    employee: {
      employeeCode: string;
      employeeName: string;
    };
    loanType: string;
    schedule: {
      installmentNo: number;
      dueDate: string | Date;
      principalAmount: number | string;
      interestAmount: number | string;
      totalAmount: number | string;
      balanceAfter: number | string;
      isPaid: boolean;
    }[];
  };
}

export function LoanDocument({
  tenantName,
  letterhead,
  format,
  loan,
}: LoanPrintProps) {
  const size = (format?.paperSize as "A4" | "LETTER" | "LEGAL") ?? "A4";
  const orientation = (format?.orientation as "portrait" | "landscape") ?? "portrait";
  return (
    <Document title={loan.name}>
      <Page size={size} orientation={orientation} style={styles.page}>
        <Watermark text={format?.watermark ?? null} />
        <View style={styles.headerRow}>
          <LetterheadHeader
            tenantName={tenantName}
            docLabel="Loan Agreement"
            letterhead={letterhead}
          />
          <View>
            <Text style={styles.docTitle}>{loan.name}</Text>
            {loan.disbursementDate && (
              <Text style={styles.docSub}>Disbursed {fmtDate(loan.disbursementDate)}</Text>
            )}
            <Text style={styles.docSub}>Status: {loan.status}</Text>
          </View>
        </View>

        <FormatHeaderBanner format={format} />

        <View style={styles.block}>
          <Text style={styles.label}>Borrower</Text>
          <Text style={styles.strong}>
            {loan.employee.employeeName}{" "}
            <Text style={{ fontFamily: "Helvetica", color: "#6b7280" }}>
              {loan.employee.employeeCode}
            </Text>
          </Text>
          <Text style={{ color: "#6b7280" }}>{loan.loanType}</Text>
        </View>

        <View
          style={{
            flexDirection: "row",
            gap: 12,
            marginVertical: 12,
          }}
        >
          {[
            ["Principal", fmt(loan.principal)],
            ["Interest %", `${Number(loan.interestRate)}%`],
            ["Term", `${loan.termMonths} mo`],
            ["EMI", fmt(loan.emi)],
            ["Outstanding", fmt(loan.outstanding)],
          ].map(([label, val], i) => (
            <View
              key={i}
              style={{
                flex: 1,
                backgroundColor: "#f3f4f6",
                padding: 8,
                borderRadius: 4,
              }}
            >
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.strong}>{val}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.label, { marginTop: 8 }]}>Repayment schedule</Text>
        <View>
          <View style={[styles.row, styles.th]}>
            <Text style={{ flex: 0.6 }}>#</Text>
            <Text style={{ flex: 1.5 }}>Due date</Text>
            <Text style={{ flex: 1.3, textAlign: "right" }}>Principal</Text>
            <Text style={{ flex: 1.3, textAlign: "right" }}>Interest</Text>
            <Text style={{ flex: 1.3, textAlign: "right" }}>EMI</Text>
            <Text style={{ flex: 1.5, textAlign: "right" }}>Balance</Text>
            <Text style={{ flex: 0.7, textAlign: "right" }}>Paid?</Text>
          </View>
          {loan.schedule.map((r) => (
            <View key={r.installmentNo} style={[styles.row, styles.td]}>
              <Text style={{ flex: 0.6 }}>{r.installmentNo}</Text>
              <Text style={{ flex: 1.5 }}>{fmtDate(r.dueDate)}</Text>
              <Text style={{ flex: 1.3, textAlign: "right" }}>{fmt(r.principalAmount)}</Text>
              <Text style={{ flex: 1.3, textAlign: "right" }}>{fmt(r.interestAmount)}</Text>
              <Text style={{ flex: 1.3, textAlign: "right" }}>{fmt(r.totalAmount)}</Text>
              <Text style={{ flex: 1.5, textAlign: "right" }}>{fmt(r.balanceAfter)}</Text>
              <Text style={{ flex: 0.7, textAlign: "right" }}>{r.isPaid ? "PAID" : ""}</Text>
            </View>
          ))}
        </View>

        <FormatFooterBlocks format={format} />
        <PageFooter format={format} letterhead={letterhead} />
      </Page>
    </Document>
  );
}
