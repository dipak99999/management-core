"use client";

import { useRouter } from "next/navigation";
import { useRegisterCommand } from "./command-palette";
import { useKeyboardShortcut } from "./keyboard";

/**
 * Standard list-page ergonomics in one hook. Registers:
 *   - ⌘K "New <singular>" (if `newHref` or `onNew` provided)
 *   - ⌘K "Refresh <plural>"
 *   - `n` keyboard shortcut → new
 *   - `r` keyboard shortcut → refresh
 *
 * Call once per list page. Nothing to render.
 */
export function useListPageCommands({
  singular,
  plural,
  group,
  newHref,
  onNew,
  refresh,
}: {
  singular: string;
  plural: string;
  group?: string;
  newHref?: string;
  onNew?: () => void;
  refresh: () => void | Promise<void>;
}): void {
  const router = useRouter();
  const groupLabel = group ?? plural;

  useRegisterCommand(
    newHref || onNew
      ? {
          id: `list:${plural}:new`,
          label: `New ${singular.toLowerCase()}`,
          group: groupLabel,
          shortcut: "n",
          run: () => (onNew ? onNew() : router.push(newHref!)),
        }
      : null,
  );

  useRegisterCommand({
    id: `list:${plural}:refresh`,
    label: `Refresh ${plural.toLowerCase()}`,
    group: groupLabel,
    shortcut: "r",
    run: () => void refresh(),
  });

  useKeyboardShortcut(
    "n",
    () => {
      if (onNew) onNew();
      else if (newHref) router.push(newHref);
    },
    `New ${singular.toLowerCase()}`,
    groupLabel,
  );

  useKeyboardShortcut(
    "r",
    () => void refresh(),
    `Refresh ${plural.toLowerCase()}`,
    groupLabel,
  );
}

/**
 * Standard doc-detail-page commands. Registers each named action as a
 * ⌘K command under "This document" and optionally binds a shortcut.
 */
export function useDocPageCommands(
  docLabel: string,
  actions: Array<{
    id: string;
    label: string;
    shortcut?: string;
    run: () => void | Promise<void>;
    enabled?: boolean;
  }>,
): void {
  for (const a of actions) {
    // Hooks must be called unconditionally; emit `null` to no-op per action.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useRegisterCommand(
      a.enabled === false
        ? null
        : {
            id: `doc:${docLabel}:${a.id}`,
            label: a.label,
            group: "This document",
            shortcut: a.shortcut,
            run: a.run,
          },
    );
  }
}
