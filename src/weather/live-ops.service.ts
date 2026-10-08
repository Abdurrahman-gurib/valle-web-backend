import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Experience } from '../entities/experience.entity';
import { Setting } from '../entities/setting.entity';
import { ParkStatusService } from './park-status.service';

/**
 * What the desk knows about each activity right now: the wait at the start,
 * where to meet, a note ("briefing every 20 minutes"). Stored in the
 * `activity_ops` setting and read by the ticket page on the visit day, next
 * to the park status (paused activities).
 */
export interface ActivityOps { waitMin: number | null; meetingPoint: string; note: string }
export interface LiveOpsView {
  updatedAt: string | null;
  updatedBy: string;
  activities: Record<string, ActivityOps & { name: string; paused: boolean }>;
}

const clampWait = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(240, Math.round(v)) : null);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

@Injectable()
export class LiveOpsService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    @InjectRepository(Experience) private readonly experiences: Repository<Experience>,
    private readonly parkStatus: ParkStatusService,
  ) {}

  async get(): Promise<LiveOpsView> {
    const [row, exps, status] = await Promise.all([
      this.settings.findOne({ where: { key: 'activity_ops' } }),
      this.experiences.find({ order: { sortOrder: 'ASC' } }),
      this.parkStatus.get(),
    ]);
    let raw: Record<string, Partial<ActivityOps>> & { _meta?: { updatedAt?: string; updatedBy?: string } } = {};
    try { raw = JSON.parse(row?.value || '{}'); } catch { raw = {}; }
    const paused = new Set(status.pausedActivities);
    const activities: LiveOpsView['activities'] = {};
    for (const e of exps) {
      if (e.priceMode === 'entry' || e.priceMode === 'kiosk') continue;
      const o = raw[e.id] ?? {};
      activities[e.id] = { name: e.name, waitMin: clampWait(o.waitMin), meetingPoint: text(o.meetingPoint, 160), note: text(o.note, 160), paused: status.state === 'closed' || paused.has(e.id) };
    }
    return { updatedAt: raw._meta?.updatedAt ?? null, updatedBy: raw._meta?.updatedBy ?? '', activities };
  }

  async set(input: Record<string, Partial<ActivityOps>>, by: string): Promise<LiveOpsView> {
    const current = await this.get();
    const next: Record<string, ActivityOps | { updatedAt: string; updatedBy: string }> = {};
    for (const [id, cur] of Object.entries(current.activities)) {
      const o = input[id];
      next[id] = o
        ? { waitMin: clampWait(o.waitMin), meetingPoint: o.meetingPoint !== undefined ? text(o.meetingPoint, 160) : cur.meetingPoint, note: o.note !== undefined ? text(o.note, 160) : cur.note }
        : { waitMin: cur.waitMin, meetingPoint: cur.meetingPoint, note: cur.note };
    }
    next._meta = { updatedAt: new Date().toISOString(), updatedBy: by };
    await this.settings.save(Object.assign(new Setting(), { key: 'activity_ops', value: JSON.stringify(next) }));
    return this.get();
  }
}
