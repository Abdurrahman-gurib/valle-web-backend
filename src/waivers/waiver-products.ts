import type { EntityManager } from 'typeorm';
import { packageActivityIds } from './waiver-rules';

/**
 * What the packages in a booking contain, as experience ids: a package line has
 * no experience id of its own, so its waiver needs and gate checks come from
 * its wording (product name, the deal's contents, the tier's item list, the
 * VIP and combo items). Read through the caller's repository manager with
 * plain SQL, so the services need no extra repositories; no manager (unit
 * tests with stub repositories) means no package contents.
 */
export async function productActivityMap(manager: EntityManager | undefined, productKeys: (string | null | undefined)[]): Promise<Map<string, string[]>> {
  const keys = [...new Set(productKeys.filter((k): k is string => !!k))];
  const out = new Map<string, string[]>();
  if (!keys.length || !manager || typeof manager.query !== 'function') return out;
  try {
    const [products, experiences] = await Promise.all([
      manager.query('SELECT key, name, contents FROM products WHERE key = ANY($1)', [keys]) as Promise<{ key: string; name: string; contents: string[] | null }[]>,
      manager.query('SELECT id, name FROM experiences') as Promise<{ id: string; name: string }[]>,
    ]);
    const tierKeys = keys.filter((k) => k.startsWith('pkg:')).map((k) => k.slice(4));
    const comboKeys = keys.filter((k) => k.startsWith('combo:')).map((k) => Number(k.slice(6))).filter(Number.isFinite);
    const [tierItems, comboItems, vipItems] = await Promise.all([
      tierKeys.length
        ? manager.query(`SELECT t.family || ':' || t.sort_order AS k, i.text FROM package_tiers t JOIN package_tier_items i ON i.tier_id = t.id WHERE t.family || ':' || t.sort_order = ANY($1)`, [tierKeys]) as Promise<{ k: string; text: string }[]>
        : Promise.resolve([] as { k: string; text: string }[]),
      comboKeys.length
        ? manager.query('SELECT c.sort_order AS n, i.text FROM combos c JOIN combo_items i ON i.combo_id = c.id WHERE c.sort_order = ANY($1)', [comboKeys]) as Promise<{ n: number; text: string }[]>
        : Promise.resolve([] as { n: number; text: string }[]),
      keys.includes('vip') ? manager.query('SELECT text FROM vip_items') as Promise<{ text: string }[]> : Promise.resolve([] as { text: string }[]),
    ]);
    for (const p of products) {
      const texts = [p.name, ...(p.contents ?? [])];
      if (p.key.startsWith('pkg:')) texts.push(...tierItems.filter((t) => 'pkg:' + t.k === p.key).map((t) => t.text));
      if (p.key.startsWith('combo:')) texts.push(...comboItems.filter((c) => 'combo:' + c.n === p.key).map((c) => c.text));
      if (p.key === 'vip') texts.push(...vipItems.map((v) => v.text));
      out.set(p.key, packageActivityIds(texts, experiences));
    }
  } catch {
    // contents are a best effort: without them the package simply adds no waiver need
  }
  return out;
}
