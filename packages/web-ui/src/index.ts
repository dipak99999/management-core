// @lumaara/web-ui — shared primitives for all 8 web apps.
//
// Add new reusable widgets here. The old apps/<name>/components/ui.tsx
// files are per-app duplicates of the "core" primitives (DataTable, Toast,
// etc.) kept for backward-compat. New features ship through this package.

// Command palette
export {
  CommandPalette,
  CommandPaletteProvider,
  useCommandPalette,
  useRegisterCommand,
  type Command,
  type CommandGroup,
  type SearchHit,
} from "./command-palette";

// Keyboard shortcuts
export {
  KeyboardProvider,
  useKeyboardShortcut,
  KeyboardCheatsheet,
  useOpenCheatsheet,
} from "./keyboard";

// Hover doc preview
export {
  DocPreview,
  DocPreviewProvider,
  useDocPreview,
  type DocPreviewData,
} from "./doc-preview";

// Undo toasts
export {
  UndoToastProvider,
  useUndoToast,
  undoableAction,
} from "./undo-toast";

// Contextual empty states
export { SmartEmptyState, type SmartEmptyAction } from "./smart-empty-state";

// Bulk selection
export {
  useBulkSelect,
  BulkActionBar,
  SelectCheckbox,
  type BulkAction,
} from "./bulk-select";
export { standardBulkActions } from "./bulk-actions-std";

// Inline edit
export { InlineEditCell, type InlineEditType } from "./inline-edit";

// Saved views
export {
  useSavedViews,
  SavedViewsMenu,
  type SavedView,
  type SavedViewsBackend,
} from "./saved-views";
export { SavedViewsControls } from "./saved-views-controls";

// Activity timeline
export {
  ActivityTimeline,
  CommentComposer,
  type ActivityEntry,
} from "./activity-timeline";
export { DocActivityPanel } from "./doc-activity-panel";

// First-run tour
export { Tour, useTour, type TourStep } from "./tour";

// Progressive disclosure
export { ProgressiveForm, FormSection } from "./progressive-form";

// Smart defaults
export { useSmartDefaults, type SmartDefaultsBackend } from "./smart-defaults";

// AI primitives
export {
  AISuggestionChips,
  AIDiffModal,
  AISlashInput,
  AIBudgetPill,
  AIBudgetPillLive,
  useSaveAsRule,
  type AISuggestion,
  type AIDiff,
  type AiRulesBackend,
  type SavedRule,
  type SlashCommand,
} from "./ai";
export { NextActionsPanel } from "./next-actions-panel";
export { AiDraftForm } from "./ai-draft-form";

// Realtime
export { useRealtime, type RealtimeMessage } from "./realtime";
export { useRealtimeList } from "./use-realtime-list";

// Standard page-level ergonomics (⌘K + keyboard shortcuts in one call).
export { useListPageCommands, useDocPageCommands } from "./list-page";

// Backend-wiring helpers for persistence hooks.
export {
  makeUIBackends,
  UIBackendsProvider,
  useUIBackends,
  useOptionalUIBackends,
  type HttpClient,
  type UIBackends,
} from "./backends";
