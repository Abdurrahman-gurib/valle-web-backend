import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Experience, Setting } from '../entities';

export type ParkState = 'open' | 'partial' | 'closed';
export interface ParkStatus {
  state: ParkState;
  /** What guests read, e.g. "Ziplines paused until the wind drops, back around 14:00." */
  message: string;
  /** Experience ids paused right now. */
  pausedActivities: string[];
  /** Names for the ids, for pages that have no catalog at hand (e-mail, WhatsApp). */
  pausedNames: string[];
  updatedAt: string | null;
  updatedBy: string;
}

export const DEFAULT_STATUS: ParkStatus = { state: 'open', message: '', pausedActivities: [], pausedNames: [], updatedAt: null, updatedBy: '' };

/**
 * What the park looks like today, set by the desk: open, partial (some
 * activities paused, usually for wind or rain) or closed. Read by the site's
 * banner, the ticket, the activity pages and the evening-before reminder.
 */
@Injectable()
export class ParkStatusService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    @InjectRepository(Experience) private readonly experiences: Repository<Experience>,
  ) {}

  async get(): Promise<ParkStatus> {
    const row = await this.settings.findOne({ where: { key: 'park_status' } });
    return this.parse(row?.value);
  }

  async set(input: { state: ParkState; message?: string; pausedActivities?: string[] }, by: string): Promise<ParkStatus> {
    const all = await this.experiences.find();
    const ids = new Set(all.map((e) => e.id));
    const paused = [...new Set((input.pausedActivities ?? []).filter((id) => ids.has(id)))];
    const state: ParkState = input.state === 'closed' ? 'closed' : input.state === 'partial' || paused.length > 0 ? 'partial' : 'open';
    const value = { state, message: (input.message ?? '').trim().slice(0, 240), pausedActivities: state === 'closed' ? [] : paused, updatedAt: new Date().toISOString(), updatedBy: by };
    await this.settings.save(Object.assign(new Setting(), { key: 'park_status', value: JSON.stringify(value) }));
    return this.parse(JSON.stringify(value));
  }

  async parse(raw: string | undefined): Promise<ParkStatus> {
    try {
      const v = JSON.parse(raw || '{}') as Partial<ParkStatus>;
      const state: ParkState = v.state === 'partial' || v.state === 'closed' ? v.state : 'open';
      const pausedActivities = Array.isArray(v.pausedActivities) ? v.pausedActivities.filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
      const names = pausedActivities.length ? new Map((await this.experiences.find()).map((e) => [e.id, e.name])) : new Map<string, string>();
      return {
        state, message: typeof v.message === 'string' ? v.message.slice(0, 240) : '', pausedActivities,
        pausedNames: pausedActivities.map((id) => names.get(id) ?? id),
        updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null, updatedBy: typeof v.updatedBy === 'string' ? v.updatedBy : '',
      };
    } catch {
      return DEFAULT_STATUS;
    }
  }

  /** One line for a message to a guest, or '' when the park is simply open. */
  async line(): Promise<string> {
    const s = await this.get();
    if (s.state === 'open' && !s.message) return '';
    const head = s.state === 'closed' ? 'The park is CLOSED today' : s.state === 'partial' ? `Partly open today${s.pausedNames.length ? `: paused ${s.pausedNames.join(', ')}` : ''}` : 'Park notice';
    return `${head}${s.message ? ` — ${s.message}` : ''}`;
  }
}
