import type { ValueTransformer } from 'typeorm';

/** pg returns NUMERIC columns as strings, so expose them as JS numbers. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : parseFloat(value),
};
