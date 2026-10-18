export { renderPdf } from "./render";
export { styles, fmt, fmtDate } from "./styles";
export { t, tf, normalizeLocale, SUPPORTED_LOCALES } from "./i18n";
export type { SupportedLocale } from "./i18n";
export {
  LetterheadHeader,
  FormatHeaderBanner,
  FormatFooterBlocks,
  Watermark,
  PageFooter,
  CoverPage,
} from "./letterhead";
export type {
  PrintLetterhead as SharedPrintLetterhead,
  PrintFormatOverrides as SharedPrintFormatOverrides,
} from "./letterhead";

export { SalesInvoiceDocument } from "./templates/sales-invoice";
export type {
  SalesInvoicePrintProps,
  PrintLetterhead,
  PrintFormatOverrides,
} from "./templates/sales-invoice";
export { SalesInvoiceBulkDocument } from "./templates/sales-invoice-bulk";
export type { SalesInvoiceBulkProps } from "./templates/sales-invoice-bulk";
export { SalarySlipDocument } from "./templates/salary-slip";
export type { SalarySlipPrintProps } from "./templates/salary-slip";

export { PurchaseInvoiceDocument } from "./templates/purchase-invoice";
export type { PurchaseInvoicePrintProps } from "./templates/purchase-invoice";
export { PaymentEntryDocument } from "./templates/payment-entry";
export type { PaymentEntryPrintProps } from "./templates/payment-entry";
export { ChequeDocument } from "./templates/cheque";
export type { ChequePrintProps } from "./templates/cheque";
export { JournalEntryDocument } from "./templates/journal-entry";
export type { JournalEntryPrintProps } from "./templates/journal-entry";
export { DeliveryNoteDocument } from "./templates/delivery-note";
export type { DeliveryNotePrintProps } from "./templates/delivery-note";
export { PurchaseReceiptDocument } from "./templates/purchase-receipt";
export type { PurchaseReceiptPrintProps } from "./templates/purchase-receipt";
export { QuotationDocument } from "./templates/quotation";
export type { QuotationPrintProps } from "./templates/quotation";
export { SalesOrderDocument } from "./templates/sales-order";
export type { SalesOrderPrintProps } from "./templates/sales-order";
export { StockEntryDocument } from "./templates/stock-entry";
export type { StockEntryPrintProps } from "./templates/stock-entry";
export { ExpenseClaimDocument } from "./templates/expense-claim";
export type { ExpenseClaimPrintProps } from "./templates/expense-claim";
export { LoanDocument } from "./templates/loan";
export type { LoanPrintProps } from "./templates/loan";
export { Form16aDocument } from "./templates/form-16a";
export type { Form16aPrintProps } from "./templates/form-16a";
export { POSReceiptDocument } from "./templates/pos-receipt";
export type { POSReceiptProps } from "./templates/pos-receipt";
