"use client";
import {
  CommandPaletteProvider,
  CommandPalette,
  KeyboardProvider,
  KeyboardCheatsheet,
  UndoToastProvider,
} from "@lumaara/web-ui";
import type { ReactNode } from "react";

// Portal-web is customer-facing (external users). Doc-preview endpoints
// are staff-oriented and gated on tenant users, so we skip
// DocPreviewProvider here. If we add a portal-preview endpoint later,
// drop it in alongside the other providers.
export function UIProviders({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      <CommandPaletteProvider>
        <UndoToastProvider>
          {children}
          <CommandPalette />
          <KeyboardCheatsheet />
        </UndoToastProvider>
      </CommandPaletteProvider>
    </KeyboardProvider>
  );
}
