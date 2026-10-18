"use client";

import { SavedViewsMenu } from "./saved-views";
import { useOptionalUIBackends } from "./backends";
import { useSavedViews } from "./saved-views";

/**
 * One-call saved-views menu for a list page. Collapses the common
 * three-step wiring (useOptionalUIBackends → useSavedViews → render
 * SavedViewsMenu) into a single component.
 *
 *   <FilterBar
 *     search={{ value: search, onChange: setSearch, ... }}
 *     actions={
 *       <SavedViewsControls
 *         listKey="accounting-web:sales-invoices"
 *         current={{ search, statusFilter }}
 *         onApply={(f) => {
 *           setSearch(f.search);
 *           setStatusFilter(f.statusFilter);
 *         }}
 *       />
 *     }
 *   />
 *
 * The caller still owns setter wiring because filter state is page-
 * specific — but imports and hook plumbing are now one line.
 */
export function SavedViewsControls<F>({
  listKey,
  current,
  onApply,
}: {
  listKey: string;
  current: F;
  onApply: (f: F) => void;
}) {
  const backends = useOptionalUIBackends();
  const views = useSavedViews<F>(listKey, backends?.views);
  return <SavedViewsMenu controller={views} currentFilters={current} onApply={onApply} />;
}
