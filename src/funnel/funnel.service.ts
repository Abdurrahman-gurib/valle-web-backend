import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { FunnelEvent } from '../entities';
import { FUNNEL_CHAIN, FUNNEL_STEPS, FunnelEventDto, LABELLED_STEPS } from './funnel.dto';

const PARK_TZ = 'Indian/Mauritius';
const MAX_DAYS = 92;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface FunnelRow { step: string; label: string; sid: string; createdAt: Date }
export interface FunnelReport {
  from: string;
  to: string;
  days: { date: string; counts: Record<string, number> }[];
  chain: { step: string; sessions: number; fromPrevious: number | null; fromStart: number | null }[];
  labels: Record<string, { label: string; count: number }[]>;
}

const parkDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: PARK_TZ });
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** Pure aggregation: per-day counts per step, distinct-sid conversion chain, label tallies. */
export function aggregateFunnel(rows: FunnelRow[], from: string, to: string): FunnelReport {
  const byDay = new Map<string, Record<string, number>>();
  const sids = new Map<string, Set<string>>(FUNNEL_CHAIN.map((s) => [s, new Set<string>()]));
  const labels = new Map<string, Map<string, number>>(LABELLED_STEPS.map((s) => [s, new Map<string, number>()]));
  for (const r of rows) {
    const day = parkDate(r.createdAt);
    const c = byDay.get(day) ?? Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0]));
    c[r.step] = (c[r.step] ?? 0) + 1;
    byDay.set(day, c);
    sids.get(r.step)?.add(r.sid);
    const l = labels.get(r.step);
    if (l && r.label) l.set(r.label, (l.get(r.label) ?? 0) + 1);
  }
  const start = sids.get(FUNNEL_CHAIN[0])!.size;
  const chain = FUNNEL_CHAIN.map((step, i) => {
    const sessions = sids.get(step)!.size;
    return {
      step,
      sessions,
      fromPrevious: i === 0 ? null : ratio(sessions, sids.get(FUNNEL_CHAIN[i - 1])!.size),
      fromStart: i === 0 ? null : ratio(sessions, start),
    };
  });
  return {
    from,
    to,
    days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, counts]) => ({ date, counts })),
    chain,
    labels: Object.fromEntries(
      [...labels.entries()].map(([step, m]) => [
        step,
        [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      ]),
    ),
  };
}

/** Park-day range [from, to] as instants (Mauritius is UTC+4, no DST). Defaults to the last 30 days. */
export function rangeOf(from?: string, to?: string, now = new Date()): { from: string; to: string; start: Date; end: Date } {
  const t = to || parkDate(now);
  const f = from || (ISO.test(t) ? new Date(Date.parse(t + 'T00:00:00Z') - 29 * 86_400_000).toISOString().slice(0, 10) : '');
  if (!ISO.test(f) || !ISO.test(t) || isNaN(Date.parse(f)) || isNaN(Date.parse(t))) throw new BadRequestException('from and to must be YYYY-MM-DD');
  if (f > t) throw new BadRequestException('from must be on or before to');
  if ((Date.parse(t) - Date.parse(f)) / 86_400_000 >= MAX_DAYS) throw new BadRequestException(`At most ${MAX_DAYS} days at a time`);
  return { from: f, to: t, start: new Date(f + 'T00:00:00+04:00'), end: new Date(Date.parse(t + 'T00:00:00+04:00') + 86_400_000 - 1) };
}

@Injectable()
export class FunnelService {
  constructor(@InjectRepository(FunnelEvent) private readonly repo: Repository<FunnelEvent>) {}

  async record(dto: FunnelEventDto): Promise<void> {
    await this.repo.insert({ step: dto.step, label: (dto.label ?? '').slice(0, 60), sid: dto.sid, path: (dto.path ?? '').slice(0, 80) });
  }

  async report(from?: string, to?: string): Promise<FunnelReport> {
    const r = rangeOf(from, to);
    const rows = await this.repo.find({ select: ['step', 'label', 'sid', 'createdAt'], where: { createdAt: Between(r.start, r.end) } });
    return aggregateFunnel(rows, r.from, r.to);
  }
}
