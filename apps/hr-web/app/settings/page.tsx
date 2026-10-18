"use client";

// Per-user settings — currently just the language switcher. Server-side
// tenant defaults live at Tenant.locale (settable via admin); this page
// lets each user override for their session/device.

import { Card, PageHeader } from "../../components/ui";
import { SUPPORTED_LOCALES, useLocale, useT } from "../../lib/i18n";

const LABELS: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
};

export default function SettingsPage() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <main className="p-8 space-y-6 max-w-xl">
      <PageHeader title={t("nav.dashboard")} subtitle="Personal preferences (this device)" />
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Language / भाषा</h3>
        <div className="flex flex-wrap gap-2">
          {SUPPORTED_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`px-4 py-2 rounded border ${
                l === locale
                  ? "bg-brand-600 text-white border-brand-700"
                  : "bg-white border-ink-muted/20 hover:border-ink-muted/40"
              }`}
            >
              {LABELS[l] ?? l}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          {t("common.save")}: {t("common.save")} · {t("common.cancel")}: {t("common.cancel")} ·{" "}
          {t("pluralize.invoices", { count: 3 })}
        </p>
      </Card>
    </main>
  );
}
