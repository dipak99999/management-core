"use client";

// Printable certificate view. The certificate is centered and framed like
// a paper award. The Print button + back link get hidden when printing.

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../../../lib/api";
import { loadSession } from "../../../../../lib/auth";
import { AppShell } from "../../../../../components/app-shell";
import { SHELL_NAV } from "../../../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
} from "../../../../../components/ui";

interface CertificateDetail {
  id: string;
  certificateNumber: string;
  issuedAt: string;
  course: {
    id: string;
    name: string;
    description: string | null;
    coverColor: string;
    estimatedMinutes: number | null;
  };
}

export default function CertificatePage() {
  const params = useParams<{ id: string }>();
  const [cert, setCert] = useState<CertificateDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const session = useMemo(() => loadSession(), []);
  const learnerEmail = session?.user.email ?? "—";
  const learnerName = session?.user.fullName ?? session?.user.email ?? "—";

  useEffect(() => {
    (async () => {
      try {
        setCert(await api.get<CertificateDetail>(`/learn/certificates/${params.id}`));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load certificate");
      }
    })();
  }, [params.id]);

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Learn", href: "/admin/learn?tab=certs" },
    { label: cert ? `Certificate ${cert.certificateNumber}` : "Certificate" },
  ];

  if (err) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Certificate"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{err}</Card>
      </AppShell>
    );
  }

  if (!cert) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading certificate…" />
        <Skeleton className="h-96 max-w-2xl mx-auto" rounded="rounded-lg" />
      </AppShell>
    );
  }

  const issued = new Date(cert.issuedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
        }
      `}</style>

      <div className="no-print">
        <PageHeader
          breadcrumb={breadcrumb}
          title="Certificate"
          subtitle={`No. ${cert.certificateNumber}`}
          actions={
            <>
              <Button variant="secondary" onClick={() => history.back()} type="button">
                ← Back
              </Button>
              <Button variant="brand" onClick={() => window.print()} type="button">
                Print
              </Button>
            </>
          }
        />
      </div>

      <div className="max-w-2xl mx-auto">
        <article
          className="bg-white border-8 border-double border-brand-600 rounded-lg p-10 text-center shadow-md"
          style={{ fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" }}
        >
          <div className="text-xs uppercase tracking-[0.4em] text-brand-700 font-semibold">
            Certificate
          </div>
          <div
            className="text-4xl mt-2 mb-6 text-brand-800"
            style={{ fontFamily: "'Snell Roundhand', 'Apple Chancery', 'Zapfino', cursive" }}
          >
            of Completion
          </div>

          <div className="text-sm text-gray-500 uppercase tracking-widest">Awarded to</div>
          <div className="text-3xl font-semibold text-gray-900 mt-2 mb-1">{learnerName}</div>
          <div className="text-xs text-gray-500 mb-6">{learnerEmail}</div>

          <div className="text-sm text-gray-600">for successfully completing</div>
          <div className="text-2xl font-semibold text-gray-900 mt-2 mb-2">
            {cert.course.name}
          </div>
          {cert.course.description && (
            <p className="text-sm text-gray-600 max-w-md mx-auto italic mb-6">
              {cert.course.description}
            </p>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200 flex items-end justify-between text-xs text-gray-600">
            <div className="text-start">
              <div className="uppercase tracking-widest text-[10px] text-gray-500">
                Issued on
              </div>
              <div className="text-sm text-gray-800 font-medium mt-0.5">{issued}</div>
            </div>
            <div className="text-end">
              <div className="uppercase tracking-widest text-[10px] text-gray-500">
                Certificate No.
              </div>
              <div className="font-mono text-sm text-gray-800 mt-0.5">
                {cert.certificateNumber}
              </div>
            </div>
          </div>
        </article>
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="LearnCertificate" docId={params.id} />
      </div>
</AppShell>
  );
}
