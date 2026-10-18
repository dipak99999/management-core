import * as React from "react";
import { Document } from "@react-pdf/renderer";
import type {
  PrintLetterhead,
  PrintFormatOverrides,
  SalesInvoicePrintProps,
} from "./sales-invoice";
import { SalesInvoiceDocument } from "./sales-invoice";

// H3: Bulk print — one PDF containing N invoices, each rendered as the
// single-doc template. Implemented by reusing SalesInvoiceDocument's first
// Page for each invoice: we generate a fresh single-doc, extract its Page
// element via cloning, and wrap them together. To keep things simple, we
// just render each SalesInvoiceDocument as its own Document element inside a
// wrapping Document — but @react-pdf collapses nested Documents, so instead
// we call SalesInvoiceDocument for its side-effect of rendering markup and
// pull out its children.

export interface SalesInvoiceBulkProps {
  tenantName: string;
  letterhead?: PrintLetterhead | null;
  format?: PrintFormatOverrides | null;
  invoices: SalesInvoicePrintProps["invoice"][];
}

export function SalesInvoiceBulkDocument({
  tenantName,
  letterhead,
  format,
  invoices,
}: SalesInvoiceBulkProps) {
  return (
    <Document title={`Invoices-${new Date().toISOString().slice(0, 10)}`}>
      {invoices.map((inv, idx) => {
        // Render each invoice as its own single-doc; extract its Page. Since
        // SalesInvoiceDocument returns a Document element containing one Page,
        // we grab the Page from its children.
        const single = SalesInvoiceDocument({
          tenantName,
          letterhead,
          format,
          invoice: inv,
        });
        const pageElement = extractFirstPage(single);
        if (!pageElement) return null;
        // Force a unique key so React doesn't complain across the loop.
        return {
          ...pageElement,
          key: `${inv.name}-${idx}`,
        };
      })}
    </Document>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFirstPage(doc: any): any {
  if (!doc || !doc.props) return null;
  const children = doc.props.children;
  if (Array.isArray(children)) return children[0] ?? null;
  return children ?? null;
}
