"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { useT } from "@lumaara/web-i18n";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  Toast,
} from "../../../components/ui";

interface Pref {
  category: string;
  channel: string;
  enabled: boolean;
}

const CATEGORIES = ["workflow", "mentions", "digests", "direct", "updates", "broadcast"];
const CHANNELS = ["inapp", "email", "sms"];

export default function NotificationSettingsPage() {
  const t = useT();
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setPrefs(await api.get<Pref[]>("/notification-preferences"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Notification",
    plural: "Notifications",
    refresh: load,
  });

  async function toggle(category: string, channel: string, enabled: boolean) {
    setBusy(true);
    try {
      await api.post("/notification-preferences", { category, channel, enabled });
      setPrefs((prev) =>
        prev.map((p) =>
          p.category === category && p.channel === channel ? { ...p, enabled } : p,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const get = (c: string, ch: string) =>
    prefs.find((p) => p.category === c && p.channel === ch)?.enabled ?? false;

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: t("Settings") }, { label: t("Notifications") }]}
        title="Notification preferences"
        subtitle="Choose which channels deliver notifications, by category."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← {t("Back")}
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-2xl">
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-start text-ink-muted">
              <tr>
                <th className="px-4 py-2">{t("Category")}</th>
                {CHANNELS.map((ch) => (
                  <th key={ch} className="px-4 py-2 text-center capitalize">
                    {ch}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c} className="border-t border-ink-muted/10">
                  <td className="px-4 py-2 capitalize font-medium text-ink">{c}</td>
                  {CHANNELS.map((ch) => (
                    <td key={ch} className="px-4 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={get(c, ch)}
                        onChange={(e) => toggle(c, ch, e.target.checked)}
                        aria-label={`${c} notifications via ${ch}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}
