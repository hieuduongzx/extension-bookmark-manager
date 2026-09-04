// Skeleton placeholders shown while initial state loads.
// Avoids the "blank flash" before content appears.

// Mirror the sidebar's persisted width so the real sidebar doesn't jump on load.
function storedSidebarWidth(): number {
  const raw = Number(localStorage.getItem('bm-sidebar-width'));
  return Number.isFinite(raw) && raw > 0 ? raw : 208;
}

export function SidebarSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ width: storedSidebarWidth() }}
      className="bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200/80 dark:border-zinc-800 flex flex-col h-full shrink-0 animate-pulse"
    >
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="px-3 py-4 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={`core-${i}`} className="h-[34px] rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70" />
        ))}
        <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800 mt-4" />
        {[...Array(4)].map((_, i) => (
          <div key={`coll-${i}`} className="h-[34px] rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70" />
        ))}
      </div>
    </div>
  );
}

export function SearchBarSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex items-center justify-between gap-2 py-3 px-5 border-b border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0 animate-pulse">
      <div className="flex-1 min-w-0">
        <div className="h-8 rounded-md bg-zinc-100 dark:bg-zinc-800 max-w-md" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-7 w-20 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-7 w-24 rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-8 w-16 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>
    </div>
  );
}

interface BookmarkListSkeletonProps {
  count?: number;
}

export function BookmarkListSkeleton({ count = 6 }: BookmarkListSkeletonProps) {
  return (
    <div role="status" aria-label="Loading" className="p-5 grid gap-3 animate-pulse" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))' }}>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm overflow-hidden h-[112px] flex flex-col">
          <div className="w-full h-14 bg-zinc-100 dark:bg-zinc-800" />
          <div className="px-3 py-2 flex-1 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-zinc-700 shrink-0 -mt-5 ring-2 ring-white dark:ring-zinc-900" />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="h-3 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-2 w-1/2 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModalSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 dark:bg-black/60 backdrop-blur-sm">
      <div role="status" aria-label="Loading" className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xl p-6 flex flex-col items-center gap-3">
        <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading...</p>
      </div>
    </div>
  );
}

/**
 * Skeleton that matches the QuickSave popup dimensions (380px wide). The
 * Chrome extension popup sizes itself to the first painted content, so this
 * must stay the same shape as QuickSave — otherwise the popup opens at the
 * dashboard's 800×600 size and leaves a gray gutter on one side.
 */
export function QuickSaveSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="w-[380px] min-h-[420px] max-h-[560px] flex flex-col bg-white dark:bg-zinc-900 animate-pulse"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="flex items-center gap-1">
          <div className="w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-800" />
          <div className="w-14 h-7 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden px-4 py-3 space-y-3">
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700">
          <div className="w-8 h-8 rounded-md bg-zinc-200 dark:bg-zinc-700 shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-2.5 w-2/3 rounded bg-zinc-200/70 dark:bg-zinc-700/70" />
          </div>
        </div>

        <div className="h-4 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-8 rounded-md bg-zinc-100 dark:bg-zinc-800" />

        <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-8 rounded-md bg-zinc-100 dark:bg-zinc-800" />

        <div className="h-4 w-14 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-[56px] rounded-md bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex-1 h-8 rounded-md bg-zinc-200 dark:bg-zinc-700" />
      </div>
    </div>
  );
}
