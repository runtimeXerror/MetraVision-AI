import type { Paged, ProductRow } from '@/types/api';

import { get } from './client';

/**
 * Products.
 *
 * Derived from inspection history rather than a product master — see the
 * backend controller for why the department has no catalogue authority here.
 */

export interface ProductFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  productCategory?: string;
  inspectorId?: string;
  from?: string;
  to?: string;
}

export function listProducts(filters: ProductFilters = {}): Promise<Paged<ProductRow>> {
  return get<Paged<ProductRow>>('/products', filters as Record<string, unknown>);
}
