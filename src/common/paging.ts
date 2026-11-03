/** Rows per page of a back-office list when the caller does not say. */
export const DEFAULT_PAGE_SIZE = 25;
/** Largest page a back-office list serves. */
export const MAX_PAGE_SIZE = 100;

export interface Paging {
  page: number;
  pageSize: number;
}

/**
 * The DTOs already validate these, but the services are also called directly
 * (tests, future jobs) so the bounds are enforced here too.
 */
export function resolvePaging(query: { page?: number; pageSize?: number }): Paging {
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(Number(query.pageSize) || DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize };
}

/** OFFSET of the first row of a page. */
export const pageOffset = ({ page, pageSize }: Paging): number => (page - 1) * pageSize;

/** One page of a back-office list. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
