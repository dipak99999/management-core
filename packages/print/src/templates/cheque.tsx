import * as React from "react";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import { fmt, fmtDate } from "../styles";

// Cheque print — deliberately minimalist because banks use pre-printed
// cheque paper. We only render the FILL-IN fields (date, payee, amount
// in words + digits) at positions that match a common Indian cheque
// layout. Staff tests once with a blank sheet + a real cheque overlay to
// calibrate offsets for their specific bank's chequebook, then keeps the
// layout constant.
//
// Layout constants match the "standard" Indian personal/current cheque
// dimensions (203mm × 89mm = 8" × 3.5"). Printer's mm-to-pt conversion
// is handled by react-pdf via `size={[width, height]}` in points.

const MM_TO_PT = 2.83464567;
const CHEQUE_W = 203 * MM_TO_PT;
const CHEQUE_H = 89 * MM_TO_PT;

export interface ChequePrintProps {
  entry: {
    name: string;                      // PE-0001 (informational only, printed as light footer)
    partyName: string;                 // payee
    paidAmount: number | string;
    currency: string;
    chequeDate: string | Date;         // separate from postingDate to allow post-dated cheques
    /** Pre-formatted amount-in-words (Indian: `amountInIndianWords` from
     *  @lumaara/db). Kept as a prop so this template package stays
     *  dep-free — the route composes and passes in. */
    amountWords: string;
  };
}

export function ChequeDocument({ entry }: ChequePrintProps) {
  const amountNum = Number(entry.paidAmount);
  const words = entry.amountWords;
  return (
    <Document title={`Cheque ${entry.name}`}>
      <Page size={[CHEQUE_W, CHEQUE_H]} style={{ padding: 0 }}>
        {/* Date — top right of most Indian cheques, 8 boxes for DDMMYYYY */}
        <View style={{ position: "absolute", top: 24, right: 32 }}>
          <Text style={{ fontFamily: "Courier", fontSize: 12, letterSpacing: 6 }}>
            {formatChequeDate(entry.chequeDate)}
          </Text>
        </View>

        {/* Payee — "Pay" line, 2 lines available for long names */}
        <View style={{ position: "absolute", top: 60, left: 60, right: 140 }}>
          <Text style={{ fontFamily: "Courier", fontSize: 13 }}>
            {entry.partyName}
          </Text>
        </View>

        {/* Amount in words — 2 lines under payee */}
        <View style={{ position: "absolute", top: 92, left: 20, right: 140 }}>
          <Text style={{ fontFamily: "Courier", fontSize: 11 }}>
            {words}
          </Text>
        </View>

        {/* Amount in digits — right-side box, aligned right */}
        <View
          style={{
            position: "absolute",
            top: 92,
            right: 32,
            width: 100,
            textAlign: "right",
          }}
        >
          <Text style={{ fontFamily: "Courier", fontSize: 14 }}>
            {fmt(amountNum)}
          </Text>
        </View>

        {/* Voucher reference — light footer, non-fill area */}
        <View style={{ position: "absolute", bottom: 4, left: 4 }}>
          <Text style={{ fontSize: 5, color: "#9ca3af" }}>
            Ref: {entry.name}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function formatChequeDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  // DDMMYYYY — no separators, so each digit lands in its own pre-printed box.
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

// Re-export helper we import above so callers don't need a second import.
export { fmtDate };
