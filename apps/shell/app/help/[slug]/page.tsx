import Link from "next/link";
import { notFound } from "next/navigation";
import { findArticle, HELP_ARTICLES } from "../../../lib/help-articles";

// Pre-render every article at build time — the content is static.
export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = findArticle(slug);
  return { title: a ? `${a.title} · Lumaara Help` : "Help · Lumaara" };
}

// Minimal markdown-ish renderer. Handles ## / ### / lists / bold / inline
// `code` / links [text](url). Full markdown pulled in only if we need it;
// keeping this inline avoids a dep for a few dozen docs.
function renderBody(src: string): React.ReactNode {
  const lines = src.trim().split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let listKind: "ol" | "ul" | null = null;
  const flushList = () => {
    if (!listKind) return;
    const Tag = listKind;
    out.push(
      <Tag key={`l-${out.length}`} className={`${listKind === "ol" ? "list-decimal" : "list-disc"} ms-6 my-3 space-y-1`}>
        {listBuf.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inline(item) }} />)}
      </Tag>,
    );
    listBuf = [];
    listKind = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      out.push(<h2 key={`h-${out.length}`} className="text-xl font-semibold mt-6 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={`h-${out.length}`} className="text-base font-semibold mt-5 mb-1">{line.slice(4)}</h3>);
    } else if (/^\d+\. /.test(line)) {
      if (listKind !== "ol") flushList();
      listKind = "ol";
      listBuf.push(line.replace(/^\d+\. /, ""));
    } else if (line.startsWith("- ")) {
      if (listKind !== "ul") flushList();
      listKind = "ul";
      listBuf.push(line.slice(2));
    } else if (line === "") {
      flushList();
    } else {
      flushList();
      out.push(
        <p key={`p-${out.length}`} className="my-3 text-ink" dangerouslySetInnerHTML={{ __html: inline(line) }} />,
      );
    }
  }
  flushList();
  return out;
}
// Inline markdown: **bold**, `code`, [text](url). HTML-escapes everything
// else to prevent injection from a (future) user-authored article.
function inline(s: string): string {
  const esc = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return esc
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-canvas-warm rounded text-sm">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-ink underline hover:no-underline">$1</a>',
    );
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = findArticle(slug);
  if (!article) notFound();

  return (
    <main className="min-h-screen bg-canvas p-8">
      <article className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-muted mb-2 flex items-center gap-2">
          <Link href="/help" className="hover:text-ink">Help</Link>
          <span>/</span>
          <span>{article.category}</span>
        </nav>
        <h1 className="text-3xl font-semibold mb-2">{article.title}</h1>
        <p className="text-ink-muted mb-6">{article.summary}</p>
        <div className="prose max-w-none text-ink">
          {renderBody(article.body)}
        </div>
        <footer className="mt-10 pt-6 border-t border-ink/10 text-xs text-ink-muted">
          Last reviewed {new Date(article.lastReviewed).toLocaleDateString()} ·{" "}
          <Link href="/admin/tickets" className="underline">
            Something wrong? File a ticket
          </Link>
        </footer>
      </article>
    </main>
  );
}
