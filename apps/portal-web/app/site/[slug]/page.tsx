"use client";

// Public WebPage renderer. Anonymous — no session required (see
// PortalShell.isPublic prefix list). The page's bodyHtml is inserted via
// dangerouslySetInnerHTML because that's exactly what the admin author
// signed up for: raw HTML they wrote gets rendered verbatim.
//
// This is safe *within* the multi-tenant model — only staff with WebPage
// write permission can create the HTML — but never invoke this renderer
// with untrusted content. If we ever accept HTML from external submitters,
// pipe it through DOMPurify at write time first.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { cmsApi, type PublicWebPage } from "../../../lib/api";

export default function PublicWebPageRoute() {
  const params = useParams<{ slug: string }>();
  const [page, setPage] = useState<PublicWebPage | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.slug) return;
    cmsApi
      .getPage(params.slug)
      .then((p) => {
        if (!p) setNotFound(true);
        else {
          setPage(p);
          // Set document.title so the browser tab reads the page title
          // instead of the layout's "Lumaara · Self-Service Portal".
          document.title = p.title;
          if (p.description) {
            let el = document.querySelector<HTMLMetaElement>('meta[name="description"]');
            if (!el) {
              el = document.createElement("meta");
              el.setAttribute("name", "description");
              document.head.appendChild(el);
            }
            el.setAttribute("content", p.description);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [params?.slug]);

  if (error)
    return (
      <div className="min-h-screen grid place-items-center text-red-600">
        {error}
      </div>
    );
  if (notFound)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-ink">404</h1>
          <p className="mt-2">This page hasn't been published.</p>
        </div>
      </div>
    );
  if (!page)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        Loading…
      </div>
    );

  return (
    <>
      {page.headHtml && (
        // We render the operator's custom <head> chunk into <body> because
        // Next's App Router owns the <head>. Browsers still parse <link>,
        // <style>, and <script> tags found in the body — imperfect but
        // matches the LandingPage rendering approach.
        <div dangerouslySetInnerHTML={{ __html: page.headHtml }} />
      )}
      <div dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
    </>
  );
}
