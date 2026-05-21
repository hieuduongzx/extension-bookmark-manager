// Skeleton placeholders shown while initial state loads.
// Avoids the "blank flash" before content appears.

export function SidebarSkeleton() {
  return (
    <div className="w-52 bg-white border-r border-zinc-200 flex flex-col h-full shrink-0 animate-pulse">
      <div className="p-4 border-b border-zinc-100 flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-zinc-200" />
        <div className="h-3 w-20 rounded bg-zinc-200" />
      </div>
      <div className="p-3 space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={`core-${i}`} className="h-[34px] rounded-md bg-zinc-100" />
        ))}
        <div className="h-3 w-16 rounded bg-zinc-200 mt-6" />
        {[...Array(4)].map((_, i) => (
          <div key={`coll-${i}`} className="h-[34px] rounded-md bg-zinc-100" />
        ))}
      </div>
    </div>
  );
}

export function SearchBarSkeleton() {
  return (
    <div className="flex items-center justify-between py-3 px-5 border-b border-zinc-200 bg-white shrink-0 animate-pulse">
      <div className="flex-1 max-w-md">
        <div className="h-8 rounded-md bg-zinc-100" />
      </div>
      <div className="flex items-center gap-3 ml-4">
        <div className="h-8 w-20 rounded-md bg-zinc-100" />
        <div className="h-8 w-24 rounded-md bg-zinc-100" />
        <div className="h-8 w-16 rounded-md bg-zinc-200" />
      </div>
    </div>
  );
}

interface BookmarkListSkeletonProps {
  count?: number;
}

export function BookmarkListSkeleton({ count = 6 }: BookmarkListSkeletonProps) {
  return (
    <div className="p-5 grid grid-cols-2 lg:grid-cols-6 gap-4 animate-pulse">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden min-h-[140px] flex flex-col">
          <div className="w-full h-32 bg-zinc-100" />
          <div className="p-3 flex-1 flex flex-col gap-2">
            <div className="h-3 w-3/4 rounded bg-zinc-200" />
            <div className="h-2 w-1/2 rounded bg-zinc-100" />
            <div className="mt-auto flex gap-1.5">
              <div className="h-3 w-10 rounded bg-zinc-100" />
              <div className="h-3 w-12 rounded bg-zinc-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ModalSkeleton() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-xl border border-zinc-200 shadow-xl p-6 flex flex-col items-center gap-3">
        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-zinc-500">Loading...</p>
      </div>
    </div>
  );
}
