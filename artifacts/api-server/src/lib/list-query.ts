import type { Request, Response } from "express";

export const LIST_PAGE_SIZE = 20;

export interface ListQuery {
  page: number;
  offset: number;
  search: string;
}

export interface Pagination {
  page: number;
  pageSize: 20;
  total: number;
  totalPages: number;
}

export function readListQuery(
  req: Request,
  res: Response,
): ListQuery | null {
  const rawPage = req.query.page;
  const rawSearch = req.query.search;
  const pageText = rawPage === undefined ? "1" : rawPage;
  if (
    typeof pageText !== "string" ||
    !/^[1-9]\d{0,5}$/.test(pageText) ||
    (rawSearch !== undefined && typeof rawSearch !== "string") ||
    (typeof rawSearch === "string" && rawSearch.length > 100)
  ) {
    res.status(400).json({ error: "Choose a valid page and search term." });
    return null;
  }
  const page = Number(pageText);
  return {
    page,
    offset: (page - 1) * LIST_PAGE_SIZE,
    search: typeof rawSearch === "string" ? rawSearch.trim() : "",
  };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function paginationFor(page: number, total: number): Pagination {
  return {
    page,
    pageSize: LIST_PAGE_SIZE,
    total,
    totalPages: Math.ceil(total / LIST_PAGE_SIZE),
  };
}
