import { PrismaClient } from "@prisma/client";
import { withTenantGuardExtension } from "./tenant-guard";
import { withRlsExtension } from "./rls-context";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Prisma defaults transactionOptions to {maxWait: 2000, timeout: 5000}. That's
// too tight for our heavier flows (payroll bulk-generate, PI submit with 50
// lines + GL posting + asset auto-create can push 10-15 s locally, more
// under load). Bump the default to 30 s so we don't get spurious P2028s
// mid-flow. Per-call overrides still work — `prisma.$transaction(fn, { timeout: 60000 })`.
function buildClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    transactionOptions: {
      maxWait: 5_000,
      timeout: 30_000,
    },
  });
  // Two Prisma `$extends` query extensions, applied in order:
  //
  //   1. withTenantGuardExtension — application-side cross-tenant leak
  //      guard. Throws (production) or warns (dev) when a tenant-scoped
  //      set-returning query omits tenantId in its `where`. Bypass
  //      per-call with `{ ...args, __allowCrossTenant: true }` (see
  //      withCrossTenant helper).
  //
  //   2. withRlsExtension — DB-layer tenant isolation. No-op unless
  //      RLS_ENFORCE=true AND the connection uses the `lumaara_app`
  //      NOSUPERUSER role. When active, wraps every tenant-scoped query
  //      in a transaction that SET LOCALs `app.current_tenant_id` from
  //      the AsyncLocalStorage frame installed by requireAuth. The POC
  //      policies landed in migration 20261002050000; see PRODUCTION.md
  //      § 1 for the switchover runbook.
  return withRlsExtension(withTenantGuardExtension(base));
}

export const prisma = global.__prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export * from "@prisma/client";
export {
  TENANT_SCOPED_MODELS,
  withTenantGuardExtension,
  attachTenantGuard,
  withCrossTenant,
} from "./tenant-guard";
export {
  fiscalYearWindow,
  tdsQuarter,
  checkCumulativeYtdCrossed,
  generate26q,
  checkCumulativeYtdSalesCrossed,
  generate27eq,
  computeMonthlyTdsDue,
  loadForm16aData,
  isValidPan,
} from "./tds";
export type {
  Tds26qRow,
  Tds26qResult,
  Tcs27eqRow,
  Tcs27eqResult,
  TdsMonthlyDueRow,
  Form16aPayment,
  Form16aData,
} from "./tds";
export {
  createBackupJob,
  runBackupJob,
  runBackupOnce,
  uploadBackupToS3,
  pruneBackups,
  verifyBackupArchive,
} from "./backup";
export type { BackupKind, VerifyResult } from "./backup";
export { seedTenantChartOfAccounts, seedTenantDefaults } from "./seed-tenant";
export {
  postGLEntries,
  cancelGLEntries,
  requireTenantDefaults,
  accountForPaymentMode,
} from "./gl-posting";
export type { GLLine, PostGLParams, TenantDefaults, VoucherType } from "./gl-posting";
export { resolveCompanyForVoucher, companyPrefix } from "./company-resolve";
export type { ResolvedCompany } from "./company-resolve";
export { cloneCoAForCompany } from "./coa-clone";
export { requireEffectiveDefaults, pickEffective } from "./effective-defaults";
export type { EffectiveDefaults } from "./effective-defaults";
export { backfillLegacyCompanyIds } from "./legacy-companyid-backfill";
export type { BackfillResult } from "./legacy-companyid-backfill";
export { backfillUserCompanyAccess } from "./backfill-user-company-access";
export type { UserAccessBackfillResult } from "./backfill-user-company-access";
export { computeICSide, buildFromLines, buildToLines } from "./ic-fx";
export type { ICSideInput, ICSideComputed } from "./ic-fx";
export {
  STANDINGS,
  standingForScore,
  scoreOnTimeDelivery,
  scoreFulfillment,
  scoreResponseRate,
  combineWeighted,
  recomputeScorecard,
} from "./supplier-scorecard";
export type { CriterionFormula, ScorecardShape } from "./supplier-scorecard";
export { sortForPickWalk, pickProgress, findActiveConflicts } from "./pick-list";
export type { DNLineForPick, PickRow, ActiveConflict } from "./pick-list";
export { stubProvider, pickProvider } from "./llm";
export type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";
export { extractInvoiceFromLLM, validateExtractedInvoice } from "./ai-invoice-extract";
export type { ExtractedInvoice, InvoiceExtractInput } from "./ai-invoice-extract";
export { extractReceiptFromLLM, validateExtractedReceipt } from "./ai-receipt-extract";
export type { ExtractedReceipt, ReceiptExtractInput } from "./ai-receipt-extract";
export { extractBusinessCardFromLLM, validateExtractedBusinessCard } from "./ai-business-card-extract";
export type { ExtractedBusinessCard, BusinessCardExtractInput } from "./ai-business-card-extract";
export { extractBankStatementFromLLM, validateExtractedBankStatement } from "./ai-bank-statement-extract";
export type { ExtractedBankStatement, ExtractedBankTxn, BankStatementExtractInput } from "./ai-bank-statement-extract";
export { extractVendorQuoteFromLLM, validateExtractedVendorQuote } from "./ai-vendor-quote-extract";
export type { ExtractedVendorQuote, ExtractedVendorQuoteLine, VendorQuoteExtractInput } from "./ai-vendor-quote-extract";
export { assertAiBudgetAvailable, monthToDateAiSpendUsd, AiBudgetExceededError } from "./ai-budget";
export {
  triageTicketFromLLM,
  shouldAutoApply,
  AUTO_APPLY_THRESHOLD,
} from "./ai-ticket-triage";
export type { TicketTriageResponse, TicketTriageInput } from "./ai-ticket-triage";
export {
  normalizeName,
  scoreCandidatePair,
  findDuplicatePairs,
} from "./duplicate-match";
export type {
  MatchCandidate,
  MatchWeights,
  MatchResult,
  CandidatePair,
} from "./duplicate-match";
export { scanDuplicates, mergeDuplicates } from "./duplicate-scan";
export type { DuplicateDoctype, ScanResult, MergeResult } from "./duplicate-scan";
export { forecastCashPosition, firstNegativeBucket } from "./cash-forecast";
export type {
  UpcomingReceipt,
  UpcomingPayment,
  ForecastBucket,
  CashForecastInput,
} from "./cash-forecast";
export { computeVariance, summarizeByRootType } from "./budget-variance";
export type { BudgetRow, BudgetVariance, RootTypeTotal } from "./budget-variance";
export { computeRevaluation, buildRevaluationJE } from "./fx-revaluation";
export type {
  OpenAR,
  OpenAP,
  RateAsOf,
  RevaluationLine,
  RevaluationSummary,
} from "./fx-revaluation";
export {
  generateVariantCombos,
  variantCodeFor,
  variantNameFor,
} from "./variant-matrix";
export type { AttributeMatrix, VariantCombo } from "./variant-matrix";
export { runAutoReverse, firstOfNextMonth } from "./je-auto-reverse";
export type { AutoReverseResult, PostGLFn, NextNameFn } from "./je-auto-reverse";
export { resolveRate } from "./fx-resolve";
export type { ResolvedRate } from "./fx-resolve";
export { generateBankAdvice } from "./bank-advice";
export type {
  BankAdviceRow,
  BankAdviceResult,
  BankAdviceFormat,
  BankAdviceValidationIssue,
} from "./bank-advice";
export {
  validateAllocations,
  computeCommissions,
  ALLOCATION_SUM_TOLERANCE,
} from "./deal-splits";
export type {
  AllocationInput,
  AllocationValidationResult,
  CommissionLine,
} from "./deal-splits";
export {
  generateSlots,
  isSlotAvailable,
  localWallClockToUtc,
  tzOffsetMinutes,
} from "./booking-slots";
export type {
  AvailabilityWindowInput,
  BookingInput,
  MeetingTypeConfig,
  Slot,
} from "./booking-slots";
export {
  inviteeConfirmationEmail,
  ownerNotificationEmail,
  inviteeReminderEmail,
  inviteeCancellationEmail,
  ownerCancellationEmail,
} from "./booking-notifications";
export type { BookingContext } from "./booking-notifications";
export {
  validateStageTransition,
  loadActiveBlueprintStages,
} from "./pipeline-blueprints";
export type { BlueprintStage, BlueprintValidationResult } from "./pipeline-blueprints";
export { scoreLead } from "./lead-scoring";
export type { LeadScoreRule } from "./lead-scoring";
export {
  renderCheque,
  renderMicrBand,
  amountToWordsINR,
  fmtAmountINR,
  MICR_SYMBOLS,
} from "./cheque-print";
export type { ChequeInput, ChequeRenderable } from "./cheque-print";
export {
  encodeCode128B,
  renderCode128Svg,
  renderLabelGridHtml,
} from "./barcode-code128";
export type {
  BarcodeSvgOptions,
  LabelRow,
  LabelGridOptions,
} from "./barcode-code128";
export {
  fetchPlaidTransactions,
  validatePlaidCreds,
} from "./plaid-feed";
export type { PlaidCreds, NormalizedTxn } from "./plaid-feed";
export { checkFence, haversineMeters } from "./geo-fence";
export type { GeoFence, CheckinPoint, FenceCheckResult } from "./geo-fence";
export {
  StubFaceProvider,
  AwsRekognitionProvider,
  AzureFaceProvider,
  faceProviderFromSecrets,
  DEFAULT_FACE_MATCH_THRESHOLD,
} from "./face-recognition";
export type { FaceProvider } from "./face-recognition";
export {
  buildGmailAuthUrl,
  exchangeGmailCode,
  refreshGmailAccessToken,
  pollGmailNewMessages,
  buildOutlookAuthUrl,
  exchangeOutlookCode,
  refreshOutlookAccessToken,
  pollOutlookNewMessages,
} from "./gmail-sync";
export type { InboundMessage, OAuthTokenBundle } from "./gmail-sync";
export { generateForm24Q } from "./form-24q";
export type {
  Form24QInput,
  Form24QDeductor,
  Form24QChallan,
  Form24QDeductee,
  Form24QResult,
  Quarter,
} from "./form-24q";
export {
  t,
  makeTranslator,
  isSupportedLocale,
  BUNDLES,
  SUPPORTED_LOCALES,
} from "./i18n";
export type { Locale, TranslateParams } from "./i18n";
export {
  INTEGRATION_CATALOG,
  catalogFor,
} from "./integration-catalog";
export type { ProviderSlug, ProviderSpec, SecretField } from "./integration-catalog";
export {
  DocuSignProvider,
  StubESignProvider,
  ZohoSignProvider,
  esignProviderFromSecrets,
} from "./esign-providers";
export type {
  ESignProvider,
  ESignSigner,
  ESignEnvelopeInput,
  ESignEnvelopeResult,
} from "./esign-providers";
export {
  EasyPostProvider,
  StubShippingProvider,
  shippingProviderFromSecrets,
} from "./shipping-providers";
export type {
  Address as ShippingAddress,
  Parcel,
  RateQuote,
  Label as ShippingLabel,
  ShippingProvider,
} from "./shipping-providers";
export { computeCpqQuote } from "./cpq";
export type {
  CpqConfig,
  CpqQuestion,
  CpqPriceRule,
  CpqQuoteInput,
  CpqQuoteResult,
  CpqQuoteLine,
} from "./cpq";
export { assignJobs } from "./fsm-scheduler";
export type {
  ServiceJob,
  TechnicianAvailability,
  Assignment,
} from "./fsm-scheduler";
export {
  AnthropicProvider,
  OpenAIProvider,
  OllamaProvider,
  LLMCallError,
  llmProviderFromSecrets,
} from "./llm-providers";
export type { ProviderSecrets } from "./llm-providers";
export { LLMRouter, routerFromSecrets } from "./llm-router";
export type {
  LLMRouterConfig,
  RouteSpec,
  TelemetrySink,
} from "./llm-router";
export {
  resolveChatProvider,
  buildChatProviderFromSecrets,
  NoChatProviderError,
} from "./ai-chat-resolver";
export { resolveAgentRouter } from "./ai-provider-resolver";
export {
  getOrGenerateInsight,
  INSIGHT_DOCTYPES,
  type InsightDoctype,
  type InsightPayload,
  type Insight,
  type RiskFlag,
  type SuggestedAction,
} from "./entity-insights";
export {
  runAiInboxScan,
  type Finding as AiInboxFinding,
  type ScanResult as AiInboxScanResult,
} from "./ai-inbox-generators";
export type {
  ChatProvider,
  ChatProviderKind,
  ChatMessage,
  ChatResult,
} from "./ai-chat-resolver";
export {
  planTask,
  executePlan,
  AGENT_PLAN_SCHEMA,
} from "./agent-runtime";
export type {
  AgentPlan,
  PlannedStep,
  PlannerInput,
  ToolDispatcher,
  ExecutorHooks,
  ExecuteResult,
} from "./agent-runtime";
export {
  defineMcpTool,
  mcpToolCatalog,
  zodToJsonSchema,
  _resetMcpToolCatalog,
} from "./mcp-manifest";
export type { McpTool, McpToolMeta } from "./mcp-manifest";
export {
  STATIC_MCP_CATALOG,
  catalogByCategory,
  toolByName,
} from "./mcp-catalog";
export {
  estimateCostUsd,
  makeLoggerTelemetry,
  makeOtelTelemetry,
  chainTelemetry,
} from "./llm-telemetry";
export {
  REFERENCE_AGENTS,
  seedReferenceAgents,
  referenceAgentByKey,
} from "./agent-seed";
export type { ReferenceAgent } from "./agent-seed";
export {
  StubEmbeddingProvider,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  embeddingProviderFromSecrets,
  cosineSimilarity,
  contentHash,
} from "./embedding-provider";
export type { EmbeddingProvider, EmbedResult } from "./embedding-provider";
export {
  scoreEmbeddings,
  buildContent,
  DEFAULT_CONTENT_BUILDERS,
} from "./semantic-search";
export type {
  SearchInput,
  SearchHit,
  DoctypeContentBuilder,
} from "./semantic-search";
export { pivot } from "./bi-pivot";
export type {
  Measure,
  PivotSpec,
  PivotAxis,
  PivotCell,
  PivotResult,
  AggKind,
} from "./bi-pivot";
export {
  DOCTYPES,
  ACTIONS,
  DEFAULT_ROLE_PERMS,
  SYSTEM_ROLE_NAMES,
  seedTenantRoles,
  assignSystemManagerRole,
  getUserPermissions,
  getUserRoleNames,
} from "./seed-roles";
export type { DocType, PermAction } from "./seed-roles";
export {
  WORKFLOW_DOCTYPES,
  getActiveWorkflow,
  applyWorkflowTransition,
  availableActions,
} from "./workflow";
export type {
  WorkflowDoctype,
  ActiveWorkflow,
  ApplyParams,
  ApplyResult,
} from "./workflow";
export { evalFormula, evaluateComponents } from "./salary-formula";
export type { ComponentInput, ComponentEvaluated } from "./salary-formula";
export { computeEmi, buildSchedule } from "./loan-math";
export type { ScheduleRow } from "./loan-math";
export { buildDepreciationSchedule } from "./depreciation";
export type { DepScheduleRow } from "./depreciation";
export {
  CUSTOM_FIELD_DOCTYPES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_LINK_TARGETS,
  isCustomFieldDoctype,
  validateCustomData,
} from "./custom-fields";
export type { CustomFieldDoctype, CustomFieldType } from "./custom-fields";
export {
  REPORT_DOCTYPE_META,
  REPORTABLE_DOCTYPES,
  getDoctypeMeta,
} from "./report-meta";
export type { ColumnType, ColumnMeta, DoctypeMeta } from "./report-meta";
export { runReport } from "./report-runner";
export { nextName, seedNamingSeriesCounter } from "./naming";
export { resolveTaxTemplate, computeTaxLines, computeInvoiceTaxLines } from "./tax";
export type { ResolvedTaxRow, ResolvedTaxTemplate, ComputedTaxLine } from "./tax";
export type {
  FilterOp,
  Filter,
  Sort,
  ReportDefinition,
  ReportResult,
} from "./report-runner";
export { renderTemplate, resolveKey } from "./comm-render";
// Marketing P3 — BrandKit merge-var helpers for email template rendering.
export {
  loadBrandVars,
  applyBrandKit,
  BRAND_DEFAULTS,
} from "./brand-kit";
export type { BrandVars } from "./brand-kit";
export {
  resolveKpi,
  resolveChart,
  periodWindow,
} from "./dashboard-resolver";
export type {
  CardKind,
  Period,
  KpiCardConfig,
  ChartCardConfig,
  TextCardConfig,
  SavedReportCardConfig,
  CardConfig,
  KpiResult,
  ChartRow,
} from "./dashboard-resolver";
export { seedLeaveAnalytics } from "./seed-leave-analytics";
export { seedFinanceAnalytics } from "./seed-finance-analytics";
export { seedCrmAnalytics } from "./seed-crm-analytics";
export { seedMfgAnalytics } from "./seed-mfg-analytics";
export { seedPayrollAnalytics } from "./seed-payroll-analytics";
export {
  resolveMultiSeries,
  resolveXY,
  resolveHeatmap,
  resolveCalendar,
  resolveTree,
  resolveSankey,
  resolveBoxPlot,
  resolveHistogram,
  resolveGantt,
  resolveWordCloud,
  resolveKpiCards,
} from "./dashboard-advanced";
export type {
  AdvancedCardConfigBase,
  MultiSeriesConfig,
  XYConfig,
  HeatmapConfig,
  CalendarConfig,
  TreeConfig,
  SankeyConfig,
  BoxPlotConfig,
  HistogramConfig,
  GanttConfig,
  WordCloudConfig,
  KpiCardsConfig,
} from "./dashboard-advanced";
export { resolveLetterhead, resolvePrintFormat } from "./print-config";
export type {
  ResolvedLetterhead,
  ResolvedPrintFormat,
} from "./print-config";
export {
  parseCsv,
  toCsvRow,
  coerceCell,
  headerIndex,
  csvIterator,
} from "./csv";
export type { CsvValueType, CsvColumnSpec, ImportRowContext } from "./csv";
export { parseXlsxToRows, xlsxToCsv, isXlsxContent } from "./xlsx";
export {
  IMPORTERS,
  IMPORTABLE_DOCTYPES,
  runImport,
  runImportFromBuffer,
} from "./importers";
export type {
  ImporterDef,
  ImporterContext,
  ImporterResult,
  ImportRunResult,
} from "./importers";
export {
  emitEvent,
  processWebhookDeliveries,
  generateSigningSecret,
  verifyHmac,
} from "./events";
export type { EventPayload } from "./events";
export {
  createRazorpayOrder,
  verifyPaymentSignature,
  resolveRazorpayCreds,
  createPlatformOrder,
  fetchPayment,
  verifyWebhookSignature,
  NoBillingGatewayError,
} from "./razorpay";
export type {
  RazorpayOrderRequest,
  RazorpayOrderResponse,
  RazorpayCreds,
  RazorpayPayment,
} from "./razorpay";
export {
  buildClosingReconciliationLines,
  computeDifferences,
  computeExpectedRows,
  validateTenderTotal,
} from "./pos";
export { slugify, resolvePublishedAt, isPubliclyReadable } from "./cms";
export {
  assertAllResolved,
  assertSingleTenant,
  computeCartTotals,
  effectivePrice,
} from "./cart";
export {
  bucketEventsByDay,
  buildMonthGrid,
  shiftMonth,
  toIso as calendarToIso,
} from "./calendar";
export type {
  CalendarEvent,
  MonthGridCell,
  WeekStart,
} from "./calendar";
export {
  buildTree,
  collectIds,
  countTree,
  filterTree,
  flattenTree,
} from "./tree";
export type { TreeNode } from "./tree";
export {
  rankCandidates,
  scoreAmount,
  scoreDate,
  scoreDescription,
  scoreMatch,
  scoreReference,
} from "./bank-match";
export type { BankTxnLike, GlEntryLike, MatchScore } from "./bank-match";
export { missingSupplierError, partitionDropshipLines } from "./dropship";
export type { DropshipGroup, DropshipLineInput } from "./dropship";
export {
  expandBundleLine,
  expandBundleLines,
  validateBundleDefinition,
} from "./bundle";
export type {
  BundleComponentInput,
  BundleDefLike,
  BundleInput,
  ExpandedDnLine,
  SoLineForExpansion,
} from "./bundle";
export {
  collectAttributeOptions,
  findVariantByAttributes,
  parseVariantAttributes,
  validateVariantMetadata,
  variantsMatch,
} from "./variants";
export type { VariantAttrs, ValidateVariantInput } from "./variants";
export {
  advanceRecurringDate,
  isScheduleExhausted,
  previewUpcomingRuns,
} from "./recurring";
export type { Frequency } from "./recurring";
export {
  composeReminderBody,
  composeReminderSubject,
  daysBetween,
  parseReminderThresholds,
  pickReminderKind,
  sendPaymentReminder,
} from "./reminders";
export type {
  ReminderKind,
  ReminderThresholds,
  SendReminderInput,
} from "./reminders";
export {
  applyRule as applyPricingRule,
  pickBestRule as pickBestPricingRule,
  ruleMatches as pricingRuleMatches,
  specificityScore as pricingRuleSpecificity,
} from "./pricing-rules";
export type {
  PricingRuleLike,
  RuleMatchContext as PricingRuleContext,
} from "./pricing-rules";
export {
  computeLoyaltyBalance,
  computeLoyaltyDiscount,
  computePointsEarned,
  expiredEntryPayload,
  findExpiredUnprocessed,
  findExpiringSoon,
  quoteRedemption,
  sumRedeemedPoints,
} from "./loyalty";
export type {
  LoyaltyEntryLike,
  LoyaltyEntryType,
  LoyaltyProgramLike,
  RedemptionQuote,
  RedemptionQuoteInput,
} from "./loyalty";
export {
  latestScheduleDueDate,
  materializeSchedule,
  scheduleItemStatus,
} from "./payment-schedule";
export type {
  MaterializedScheduleRow,
  PaymentTermsItemLike,
  ScheduleRowStatus,
  ScheduleRowStatusInput,
} from "./payment-schedule";
export { normalizeCouponCode, validateCoupon } from "./coupons";
export type { CouponCodeLike, CouponValidation } from "./coupons";
export { allocateLandedCost, applyBumpToBin } from "./landed-cost";
export type {
  AllocationResult as LandedCostAllocation,
  LandedCostBump,
  LandedCostItemInput,
  LandedCostTaxInput,
} from "./landed-cost";
export {
  allocateToSchedule,
  derivePaidStatus,
  reverseFromSchedule,
} from "./schedule-allocation";
export type {
  AllocatableRow,
  AllocationResult as ScheduleAllocationResult,
  RowChange as ScheduleRowChange,
} from "./schedule-allocation";
export {
  deriveOverallStatus as deriveQIOverallStatus,
  mergeReadingsFromTemplate as mergeQIReadings,
} from "./quality-inspection";
export type {
  QIReadingLike,
  QIStatus,
  QITemplateParamLike,
} from "./quality-inspection";
export { classifyRecon } from "./stock-reconciliation";
export type {
  ReconChange,
  ReconInputs,
  ReconMode,
} from "./stock-reconciliation";
export { classifyBatchExpiry, pickBatchesForAlert } from "./batch-expiry";
export type {
  AlertPickInput as BatchAlertPickInput,
  BatchExpiryLike,
  BatchExpiryResult,
  BatchExpiryStatus,
} from "./batch-expiry";
export { parseStockCountRows } from "./stock-count-csv";
export type {
  StockCountParseResult,
  StockCountRowRaw,
  StockCountRowResolved,
} from "./stock-count-csv";
export {
  buildAllocationRow as buildLeaveAllocationRow,
  buildConsumptionReversalRow as buildLeaveConsumptionReversalRow,
  buildConsumptionRow as buildLeaveConsumptionRow,
  buildEncashmentReversalRow as buildLeaveEncashmentReversalRow,
  buildEncashmentRow as buildLeaveEncashmentRow,
  computeBalanceAfter as computeLeaveBalanceAfter,
  finalizeLedgerRow as finalizeLeaveLedgerRow,
} from "./leave-ledger";
export {
  appendOppNote,
  nextOppStatusForQuoteEvent,
} from "./opportunity-transitions";
export type {
  OppTransitionResult,
  OpportunityQuoteEvent,
  OpportunityStatus,
} from "./opportunity-transitions";
export { computeAdvanceReturn } from "./advance-return";
export type {
  AdvanceReturnInput,
  AdvanceReturnQuote,
} from "./advance-return";
export {
  composeSalarySlipBody,
  composeSalarySlipEmail,
  composeSalarySlipSubject,
} from "./salary-slip-email";
export type { SalarySlipEmailInput } from "./salary-slip-email";
export {
  amountInIndianWords,
  wholeToIndianWords,
} from "./amount-in-words";
export { computeDeferredSchedule } from "./deferred-revenue";
export type { DeferredScheduleRowInput } from "./deferred-revenue";
export { recomputeSleChain } from "./stock-repost";
export type {
  RepostResult,
  RepostSleUpdate,
  SleForRepost,
} from "./stock-repost";
export {
  canTransitionTask,
  summarizeDependencyReadiness,
} from "./task-dependency";
export type {
  Blocker as TaskDependencyBlocker,
  DependencyCheckResult as TaskDependencyCheck,
  DependencyLike as TaskDependencyLike,
  DependencyType as TaskDependencyType,
  FromTaskStatusMap,
  TaskStatus,
} from "./task-dependency";
export type {
  LeaveEntryType,
  LeaveLedgerRowInput,
  LeaveLedgerRowReady,
} from "./leave-ledger";
export type { CartLineInput, WebsiteItemLike } from "./cart";
export type {
  PaymentMethodConfig,
  OpeningBalance,
  ExpectedRow as POSExpectedRow,
  CountedByMode,
  DifferenceRow,
  GLLineShape as POSGLLineShape,
} from "./pos";
export { encryptSecrets, decryptSecrets } from "./secrets-crypto";
export type { EncryptedBlob, StoredSecrets } from "./secrets-crypto";
export { withTenant, withSuperAdmin } from "./rls";
export {
  runWithTenant,
  runAsSuperAdmin,
  currentTenantId,
  withRlsExtension,
  withTenantTx,
} from "./rls-context";
export {
  compileSegment,
  countSegment,
  evaluateSegment,
  SegmentError,
} from "./segment";
export type {
  Doctype as SegmentDoctype,
  Op as SegmentOp,
  Node as SegmentNode,
  ConditionNode as SegmentConditionNode,
  SegmentErrorCode,
  SegmentRow,
} from "./segment";
export { normalizeAndPersist } from "./bounce-normalize";
export type {
  NormalizedEvent,
  NormalizedEventType,
  NormalizedSeverity,
  NormalizeResult,
} from "./bounce-normalize";
export { getPrismaDelegate } from "./prisma-delegate";
export type { PrismaDelegateLike } from "./prisma-delegate";
export {
  createStripePaymentIntent,
  verifyStripeWebhookSignature,
} from "./stripe";
export type {
  StripePaymentIntentRequest,
  StripePaymentIntentResponse,
} from "./stripe";
export {
  loadS3Config,
  presignPutObject,
  presignGetObject,
  putObject,
  deleteObject,
} from "./s3";
export type { S3Config } from "./s3";
export { postSlackMessage } from "./slack";
export type { SlackMessage } from "./slack";
export {
  anonymizeCustomer,
  anonymizeSupplier,
  anonymizeEmployee,
  exportCustomerData,
  exportSupplierData,
  exportEmployeeData,
} from "./compliance";
export type { AnonResult } from "./compliance";
export { gstr1, gstr1Hsn, gstr3b, gstr9 } from "./gst";
export type { Gstr9Result, Gstr9MonthRow, Gstr9RateRow } from "./gst";
export {
  buildEwayBillPayload,
  canCancelEwb,
  classifyTaxLine,
  computeEwbValidity,
  quoteEwbExtension,
  splitTaxes,
  averageRates,
} from "./eway-bill";
export type {
  EwayBillPayload,
  EwayInvoice,
  EwayInvoiceLine,
  EwayTaxLine,
  EwayParty,
  EwayTransport,
  SupplyType,
  EwayDocType,
  SubSupplyType,
  TransactionType,
  TransMode,
  TaxBucket,
} from "./eway-bill";
export {
  buildEinvoicePayload,
  cancelStoredIrn,
  generateAndStoreIrn,
  getIrpAdapter,
  NoIrpAdapterError,
} from "./einvoice";
export type { EinvoicePayload, IrnResponse, IrpAdapter } from "./einvoice";
export type {
  Gstr1Row,
  Gstr1Result,
  Gstr1HsnRow,
  Gstr1HsnResult,
  Gstr3bResult,
} from "./gst";
// Marketing P1 — Suppression helpers + email tracking wrap.
export {
  isSuppressed,
  addSuppression,
  removeSuppression,
} from "./suppression";
export type { AddSuppressionInput } from "./suppression";
export { wrapLinksAndInjectPixel, unwrapForPreview } from "./tracker";
export type { WrapOptions } from "./tracker";
// Marketing P2 — A/B test variant helpers.
export {
  pickVariantForRecipient,
  hashToBucket,
  twoProportionZTest,
  standardNormalCdf,
  mergeVariantOverride,
} from "./campaign-variants";
export type {
  SignificanceResult,
  CampaignSendDefaults,
  VariantOverrides,
} from "./campaign-variants";
// Marketing P2 — SMS provider adapters + factory.
export {
  TestAdapter as SmsTestAdapter,
  TwilioAdapter as SmsTwilioAdapter,
  Msg91Adapter as SmsMsg91Adapter,
  getSmsAdapter,
  NoSmsProviderError,
} from "./sms-providers";
export type {
  SmsAdapter,
  SmsSendInput,
  SmsSendResult,
} from "./sms-providers";
// Marketing P2 — Journey graph validator + runner + trigger fan-out helper.
export {
  advanceEnrollment,
  fireJourneyTrigger,
  validateGraph,
  waitConfigToMs,
} from "./journey";
export type {
  JourneyEdge,
  JourneyNode,
  NodeKind as JourneyNodeKind,
  ValidateResult as JourneyValidateResult,
} from "./journey";
// Marketing P2 — WhatsApp Business Cloud API adapter (templates + send +
// webhook signature verification). Constructed per-tenant from a
// `TenantIntegration provider="whatsapp"` row.
export {
  WhatsappClient,
  WhatsappApiError,
  getWhatsappClient,
} from "./whatsapp";
export type {
  WhatsappCredentials,
  WhatsappSendResult,
  WhatsappTemplateComponent,
  WhatsappTemplateCreateResult,
  WhatsappTemplateSummary,
} from "./whatsapp";
// Marketing P3 — Social provider adapters (LinkedIn / FB Pages / IG Business
// / X-Twitter). Encrypted-per-account tokens live in TenantIntegration rows
// keyed by SocialAccount.id — see `packages/db/src/social-providers.ts`.
export {
  LinkedInAdapter,
  FacebookPagesAdapter,
  InstagramBusinessAdapter,
  XAdapter,
  getSocialAdapter,
  getSocialAdapterForTenant,
  upsertSocialCredentials,
  loadSocialCredentials,
  ensureFreshToken,
  makePkceVerifier,
  pkceChallenge,
} from "./social-providers";
export type {
  SocialPlatform,
  SocialAdapter,
  SocialCredentials,
  AccountContext as SocialAccountContext,
  PublishInput as SocialPublishInput,
  PublishResult as SocialPublishResult,
  EngagementMetrics as SocialEngagementMetrics,
  OAuthTokenExchange as SocialOAuthTokenExchange,
  OAuthRefreshResult as SocialOAuthRefreshResult,
} from "./social-providers";
// Marketing P3 — Webinar provider adapters (Zoom real, Webex + GoogleMeet
// stubbed). Constructed per-tenant from a `TenantIntegration provider=<lc>`
// row via `getWebinarAdapter(prisma, tenantId, provider)`.
export {
  ZoomAdapter,
  WebexAdapter,
  GoogleMeetAdapter,
  getWebinarAdapter,
} from "./webinar-providers";
export type {
  WebinarAdapter,
  WebinarProviderKey,
  WebinarCreateInput,
  WebinarCreateResult,
  WebinarUpdateInput,
  WebinarRegistrantInput,
  WebinarRegistrantResult,
  ZoomCredentials,
} from "./webinar-providers";
// Marketing P3 — Attribution + ROI engine. See packages/db/src/attribution.ts
// for the write path, per-invoice compute (LastTouch/FirstTouch/Linear), and
// per-source rollup used by the /admin/marketing/roi dashboard.
export {
  recordTouchpoint,
  attributeInvoice,
  splitByModel,
  getRoiBySource,
} from "./attribution";
export type {
  AttributionModel,
  AttributionSourceType,
  AttributionEvent,
  RecordTouchpointInput,
  AttributeInvoiceInput,
  GetRoiInput,
  RoiRow,
  RoiRowRaw,
} from "./attribution";
// Marketing P3 — AI content assist client + prompts (Anthropic SDK wrapper).
// Two-tier model routing (Haiku for cheap tasks, Sonnet for long-form) with
// ephemeral prompt-caching on the SYSTEM block. See ai-assist.ts header.
export {
  MODEL_HAIKU,
  MODEL_SONNET,
  REQUEST_TIMEOUT_MS,
  NoApiKeyError,
  SOCIAL_CHAR_LIMITS,
  loadBrandContext,
  resolveAnthropicApiKey,
  getAnthropicClient,
  buildSystemPrompt,
  buildSystemBlocks,
  parseStringArray,
  extractText,
  sanitizeHtml,
  subjectLinePrompt,
  writeEmailPrompt,
  rewritePrompt,
  summarizePrompt,
  socialCaptionPrompt,
} from "./ai-assist";

// Immutable audit trail (Phase 1.5) — SOC 2 Type II readiness.
// See packages/db/src/audit-chain.ts for the design + threat model.
export {
  computeEntryHash,
  nextChainHead,
  writeChainedAuditEntry,
  verifyChainForTenant,
  computeSuperAdminEntryHash,
  writeChainedSuperAdminEntry,
} from "./audit-chain";
export type { ChainVerification } from "./audit-chain";

// OpenAPI 3.1 spec generator (Phase 1.7) — auto-derived from the MCP
// catalog so external HTTP consumers see the same surface as MCP clients.
export { buildOpenApiSpec } from "./openapi-spec";
export type { OpenApiBuildOptions } from "./openapi-spec";
