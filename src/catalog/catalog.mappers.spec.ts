import type { Category, Experience, ExperienceGallery, GalleryShot, PhotoAddon, PhotoTier, PriceListEntry } from '../entities';
import { mapCategories, mapGalleries, mapPhoto, mapPriceList, mapRatePrices } from './catalog.mappers';

describe('catalog mappers', () => {
  it('orders categories as the seed does, unknown ones last', () => {
    const cats = ['tours', 'zzz', 'adventure', 'kids'].map((id) => ({ id, name: id, badge: '', color: '', fg: '', pulse: false }) as unknown as Category);
    expect(Object.keys(mapCategories(cats))).toEqual(['adventure', 'kids', 'tours', 'zzz']);
  });

  it('keeps only rate-dependent experiences in RATEP, NR falling back to RR', () => {
    const exps = [{ id: 'a', priceRr: 100, priceNr: null }, { id: 'b', priceRr: null, priceNr: 5 }, { id: 'c', priceRr: 1, priceNr: 2 }] as Experience[];
    expect(mapRatePrices(exps)).toEqual({ a: [100, 100], c: [1, 2] });
  });

  it('groups the price list by key in insertion order', () => {
    const rows = [{ groupKey: 'zipline', label: 'A', rr: 1, nr: 2 }, { groupKey: 'admission', label: 'B', rr: 3, nr: 4 }, { groupKey: 'zipline', label: 'C', rr: 5, nr: 6 }] as PriceListEntry[];
    const PL = mapPriceList(rows);
    expect(Object.keys(PL)).toEqual(['zipline', 'admission']);
    expect(PL.zipline).toEqual([{ n: 'A', rr: 1, nr: 2 }, { n: 'C', rr: 5, nr: 6 }]);
  });

  it('keys galleries by shot order, skips shots without a gallery and falls back to the first shot as poster', () => {
    const galleries = [{ experienceId: 'luge', eyebrow: 'e', t1: '1', t2: '2', copy: 'c', foot: 'f', cta: 'go', video: 'v.mp4', videoPoster: null }, { experienceId: 'quad', eyebrow: '', t1: '', t2: '', copy: '', foot: '', cta: '', video: null, videoPoster: null }] as unknown as ExperienceGallery[];
    const shots = [{ experienceId: 'orphan', src: 'o.jpg', tag: '', cap: '', pos: null, sortOrder: 0 }, { experienceId: 'luge', src: 'b.jpg', tag: 't', cap: 'c', pos: 'top', sortOrder: 2 }, { experienceId: 'luge', src: 'a.jpg', tag: 't', cap: 'c', pos: null, sortOrder: 1 }] as unknown as GalleryShot[];
    const GAL = mapGalleries(galleries, shots);
    expect(Object.keys(GAL)).toEqual(['luge', 'quad']);
    expect(GAL.luge.shots.map((s) => s.src)).toEqual(['a.jpg', 'b.jpg']);
    expect(GAL.luge.shots[1]).toEqual({ src: 'b.jpg', tag: 't', cap: 'c', pos: 'top' });
    expect(GAL.luge.video).toEqual({ src: 'v.mp4', poster: 'a.jpg' });
    expect(GAL.quad.video).toBeUndefined();
  });

  it('splits photo tiers and add-ons per rate', () => {
    const tiers = [{ rate: 'rr', sortOrder: 0, name: 'R', color: '', activitiesLabel: '', singleLabel: '', dblLabel: '' }, { rate: 'nr', sortOrder: 1, name: 'N', color: '', activitiesLabel: '', singleLabel: '', dblLabel: '' }] as unknown as PhotoTier[];
    const addons = [{ rate: 'nr', text: 'USB', priceLabel: 'Rs 100' }] as PhotoAddon[];
    const PHOTO = mapPhoto(tiers, addons);
    expect(PHOTO.rr.tiers.map((t) => t.key)).toEqual(['photo:rr:0']);
    expect(PHOTO.nr.tiers.map((t) => t.key)).toEqual(['photo:nr:1']);
    expect(PHOTO.nr.addons).toEqual([{ t: 'USB', p: 'Rs 100' }]);
    expect(PHOTO.rr.addons).toEqual([]);
  });
});
