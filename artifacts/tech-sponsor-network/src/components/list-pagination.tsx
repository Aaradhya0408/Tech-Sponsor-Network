export interface PaginationData {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function ListPagination({
  pagination,
  onPageChange,
  className = "",
}: {
  pagination?: PaginationData;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (!pagination) return null;
  const pages = Math.max(1, pagination.totalPages);
  return (
    <nav
      aria-label="List pages"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground ${className}`}
    >
      <span>
        {pagination.total === 0
          ? "No results"
          : `Page ${pagination.page} of ${pages} · ${pagination.total} total`}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          disabled={pagination.page <= 1}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pages, pagination.page + 1))}
          disabled={pagination.page >= pages}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
