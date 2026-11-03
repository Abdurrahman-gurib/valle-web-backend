/** Rows bucketed by a key, each bucket keeping the input order. */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** The `settings` rows as a key -> value map. */
export function settingsMap(rows: readonly { key: string; value: string }[]): Map<string, string> {
  return new Map(rows.map((s) => [s.key, s.value]));
}
