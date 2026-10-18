"use client";

// Catch-all for sidebar links that don't have a hand-built page yet.
// Static routes always win over this dynamic segment, so existing pages
// are unaffected; anything not listed in MODULE_NAV still 404s.

import { notFound, useParams } from "next/navigation";
import { GenericDoctypeList } from "../../components/generic-doctype-list";
import { MODULE_NAME, MODULE_NAV } from "../../components/module-nav";

const BASE_PATH = "/crm";

export default function GenericDoctypePage() {
  const { doctype } = useParams<{ doctype: string }>();
  const link = MODULE_NAV.flatMap((g) => g.links).find((l) => l.href === `${BASE_PATH}/${doctype}`);
  if (!link) notFound();
  return <GenericDoctypeList moduleName={MODULE_NAME} slug={doctype} label={link.label} />;
}
