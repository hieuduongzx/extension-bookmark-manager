// Skeleton placeholders shown while initial state loads.
// Avoids the "blank flash" before content appears.

function storedSidebarWidth(): number {
  const raw = Number(localStorage.getItem('bm-sidebar-width'));
  return Number.isFinite(raw) && raw > 0 ? raw : 220;
}

export function SidebarSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{ width: storedSidebarWidth() }}
      className="bg-[var(--surface)] border-r border-[var(--border)] flex flex-col h-full shrink-0 animate-pulse"
    >
      <div className="px-3.5 py-3.5 flex items-center gap-2.5 border-b border-[var(--border)]">
        <div className="w-7 h-7 rounded-[7px] bg-[var(--surface-2)]" />
        <div className="space-y-1.5 flex-1">
          <div className="h-3 w-24 rounded bg-[var(--surface-2)]" />
          <div className="h-2.5 w-16 rounded bg-[var(--surface-2)]" />
        </div>
      </div>
      <div className="px-3 py-4 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={`core-${i}`} className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        ))}
        <div className="h-3 w-16 rounded bg-[var(--surface-2)] mt-4" />
        {[...Array(4)].map((_, i) => (
          <div key={`coll-${i}`} className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        ))}
      </div>
    </div>
  );
}

export function SearchBarSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex items-center justify-between gap-2 py-2.5 px-5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 animate-pulse"
    >
      <div className="flex-1 min-w-0">
        <div className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)] max-w-md" />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        <div className="h-8 w-24 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        <div className="h-8 w-16 rounded-[var(--radius)] bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}

interface BookmarkListSkeletonProps {
  count?: number;
}

export function BookmarkListSkeleton({ count = 6 }: BookmarkListSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="p-5 grid gap-3.5 animate-pulse"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))' }}
    >
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden flex flex-col"
        >
          <div className="w-full h-24 bg-[var(--surface-2)]" />
          <div className="p-3 pt-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-[var(--radius)] bg-[var(--surface-2)] shrink-0 -mt-6 ring-2 ring-[var(--surface)]" />
              <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="h-3 w-4/5 rounded bg-[var(--surface-2)]" />
                <div className="h-2.5 w-1/2 rounded bg-[var(--surface-2)]" />
              </div>
            </div>
            <div className="flex gap-1.5 pt-1">
              <div className="h-4 w-12 rounded-full bg-[var(--surface-2)]" />
              <div className="h-4 w-14 rounded-full bg-[var(--surface-2)]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModalSkeleton() {
  return (
    <div className="ui-dialog-backdrop">
      <div
        role="status"
        aria-label="Loading"
        className="w-full max-w-xs bg-[var(--surface)] rounded-[12px] border border-[var(--border)] shadow-pop p-6 flex flex-col items-center gap-3"
      >
        <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full ui-spin" />
        <p className="text-xs text-[var(--text-muted)] m-0">Loading…</p>
      </div>
    </div>
  );
}

export function QuickSaveSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="popup-shell animate-pulse">
      <div className="popup-header">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-[7px] bg-[var(--surface-2)]" />
          <div className="space-y-1">
            <div className="h-3 w-28 rounded bg-[var(--surface-2)]" />
            <div className="h-2.5 w-20 rounded bg-[var(--surface-2)]" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-7 h-7 rounded-[7px] bg-[var(--surface-2)]" />
          <div className="w-7 h-7 rounded-[7px] bg-[var(--surface-2)]" />
        </div>
      </div>

      <div className="popup-tabs-wrap">
        <div className="h-[34px] rounded-[9px] bg-[var(--surface-2)]" />
      </div>

      <div className="popup-body space-y-2.5">
        <div className="popup-preview-card">
          <div className="w-8 h-8 rounded-[8px] bg-[var(--surface-2)] shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-[var(--surface-2)]" />
            <div className="h-2.5 w-2/3 rounded bg-[var(--surface-2)]" />
          </div>
        </div>
        <div className="popup-card space-y-3">
          <div className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)]" />
          <div className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)]" />
          <div className="h-8 rounded-[var(--radius)] bg-[var(--surface-2)]" />
          <div className="h-14 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        </div>
      </div>

      <div className="popup-footer">
        <div className="h-8 w-24 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        <div className="h-8 flex-1 rounded-[var(--radius)] bg-[var(--surface-2)]" />
      </div>
    </div>
  );
}
