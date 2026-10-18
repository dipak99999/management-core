import { redirect } from "next/navigation";

// /settings is a nav category, not a page — send to the first tab.
export default function SettingsIndex(): never {
  redirect("/settings/notifications");
}
