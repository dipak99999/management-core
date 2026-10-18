// Route-level loading fallback. Next streams this immediately on any
// client-side navigation while the destination page.tsx fetches / compiles.
// Without it, the module content area goes blank during the transition — a
// couple of seconds of invisibility that feels like a hang. The AppShell
// (sidebar + topbar) stays rendered via the layout, so this file only
// renders a skeleton for the content area.
import { Skeleton, SkeletonList } from "../components/ui";

export default function RootLoading() {
  return (
    <main className="p-8 space-y-6">
      <div className="space-y-3">
        {/* PageHeader title + subtitle shimmer */}
        <Skeleton className="h-8 w-64" rounded="rounded-lg" />
        <Skeleton className="h-4 w-96" rounded="rounded" />
      </div>
      <div className="space-y-3">
        {/* FilterBar / tabs shimmer */}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" rounded="rounded-full" />
          <Skeleton className="h-9 w-24" rounded="rounded-full" />
          <Skeleton className="h-9 w-24" rounded="rounded-full" />
        </div>
        {/* Table rows shimmer */}
        <SkeletonList rows={6} />
      </div>
    </main>
  );
}
