import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Setting } from '../entities';
import {
  cutoffs, parsePolicy, policyProblems, RETENTION_BOUNDS, RETENTION_DEFAULTS, RetentionCutoffs, RetentionPolicy,
} from './retention.policy';

export type RetentionCategory =
  | 'chatConversations' | 'quotes' | 'tableReservations' | 'jobApplications'
  | 'bookingPhotos' | 'bookingDrafts' | 'slotHolds' | 'bookingsAnonymised';
export type RetentionCounts = Record<RetentionCategory, number>;

export interface RetentionRun {
  id: string; startedAt: string; finishedAt: string; dryRun: boolean; ok: boolean; trigger: string;
  counts: Partial<RetentionCounts>; detail: string;
}

export interface RetentionStatus {
  enabled: boolean;
  policy: RetentionPolicy;
  defaults: RetentionPolicy;
  bounds: typeof RETENTION_BOUNDS;
  runs: RetentionRun[];
}

interface Rule {
  key: RetentionCategory;
  table: string;
  /** WHERE clause over `t`, with $1 bound to the cut-off from `param`. */
  where: string;
  param: (c: RetentionCutoffs) => Date | string;
}

/**
 * What goes and when. Deletions rely on these foreign keys (schema.sql and
 * migrations 004, 006, 010, 018): chat_messages and chat_attachments CASCADE
 * from chat_conversations; nothing references quotes, table_reservations,
 * job_applications, booking_photos, booking_drafts or slot_holds. Bookings are
 * never deleted (booking_lines, payments, waivers and the audit CASCADE from
 * them, and the books need them): their personal fields are cleared instead.
 * There is no password-reset token table yet; add a rule here when there is.
 */
// Business decision (2026-10-14): chats, quote requests, table requests, job
// applications and visit photos are KEPT, never deleted. Only expired technical
// records (unfinished booking drafts, temporary slot holds) are cleared.
export const RULES: Rule[] = [
  { key: 'bookingDrafts', table: 'booking_drafts', where: 't.expires_at < $1', param: (c) => c.expiredBefore },
  { key: 'slotHolds', table: 'slot_holds', where: 't.expires_at < $1', param: (c) => c.expiredBefore },
];

const ANONYMISE_WHERE = 't.visit_date < $1::date AND t.anonymised_at IS NULL';

export const RETENTION_BATCH = 500;
/** How often the job wakes up; it runs when no real run finished in the last RUN_EVERY_HOURS (so restarts and replicas do not repeat it). */
const SWEEP_MS = 60 * 60_000;
const RUN_EVERY_HOURS = 20;

export const emptyCounts = (): RetentionCounts => ({
  chatConversations: 0, quotes: 0, tableReservations: 0, jobApplications: 0,
  bookingPhotos: 0, bookingDrafts: 0, slotHolds: 0, bookingsAnonymised: 0,
});

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private sweep: ReturnType<typeof setInterval> | null = null;
  private running = false;
  readonly enabled: boolean;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(Setting) private readonly settingRepo: Repository<Setting>,
    config: ConfigService,
  ) {
    this.enabled = (config.get<string>('RETENTION_JOB') ?? '1') !== '0';
  }

  onModuleInit(): void {
    if (!this.enabled || process.env.NODE_ENV === 'test') return;
    this.sweep = setInterval(() => { void this.runIfDue(); }, SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweep) clearInterval(this.sweep);
  }

  async policy(): Promise<RetentionPolicy> {
    const row = await this.settingRepo.findOne({ where: { key: 'retention' } });
    return parsePolicy(row?.value);
  }

  async savePolicy(patch: Partial<RetentionPolicy>): Promise<RetentionStatus> {
    const problems = policyProblems(patch);
    if (problems.length) throw new BadRequestException(problems.join('; '));
    const next: Record<string, number> = { ...(await this.policy()) };
    for (const [k, v] of Object.entries(patch)) if (typeof v === 'number') next[k] = v;
    await this.settingRepo.save(Object.assign(new Setting(), { key: 'retention', value: JSON.stringify(next) }));
    return this.status();
  }

  async status(): Promise<RetentionStatus> {
    const rows: { id: string; started_at: Date; finished_at: Date; dry_run: boolean; ok: boolean; trigger: string; counts: Partial<RetentionCounts>; detail: string }[] =
      await this.db.query(
        `SELECT id, started_at, finished_at, dry_run, ok, trigger, counts, detail
           FROM retention_runs ORDER BY finished_at DESC, id DESC LIMIT 30`,
      );
    return {
      enabled: this.enabled,
      policy: await this.policy(),
      defaults: RETENTION_DEFAULTS,
      bounds: RETENTION_BOUNDS,
      runs: rows.map((r) => ({
        id: String(r.id), startedAt: new Date(r.started_at).toISOString(), finishedAt: new Date(r.finished_at).toISOString(),
        dryRun: r.dry_run, ok: r.ok, trigger: r.trigger, counts: r.counts ?? {}, detail: r.detail,
      })),
    };
  }

  /** Counts what a run would remove or anonymise now. Changes nothing. */
  async preview(now = new Date()): Promise<{ policy: RetentionPolicy; cutoffs: RetentionCutoffs; counts: RetentionCounts }> {
    const policy = await this.policy();
    const c = cutoffs(policy, now);
    const counts = emptyCounts();
    for (const rule of RULES) {
      const r = await this.db.query(`SELECT count(*)::int AS n FROM ${rule.table} t WHERE ${rule.where}`, [rule.param(c)]);
      counts[rule.key] = Number(r[0]?.n ?? 0);
    }
    const b = await this.db.query(`SELECT count(*)::int AS n FROM bookings t WHERE ${ANONYMISE_WHERE}`, [c.bookingVisitBefore]);
    counts.bookingsAnonymised = Number(b[0]?.n ?? 0);
    return { policy, cutoffs: c, counts };
  }

  async runIfDue(now = new Date()): Promise<void> {
    try {
      const r = await this.db.query(
        'SELECT 1 FROM retention_runs WHERE NOT dry_run AND finished_at > $1 LIMIT 1',
        [new Date(now.getTime() - RUN_EVERY_HOURS * 3600_000)],
      );
      if (r.length) return;
      await this.run('schedule', now);
    } catch (e) {
      this.logger.error(`retention check failed: ${(e as Error).message}`);
    }
  }

  /** One real run: every category in batches, each batch in its own transaction. Always logs a retention_runs row. */
  async run(trigger: 'schedule' | 'manual', now = new Date()): Promise<RetentionCounts> {
    if (this.running) throw new BadRequestException('A retention run is already in progress');
    this.running = true;
    const startedAt = new Date();
    const counts = emptyCounts();
    let ok = true;
    let detail = '';
    try {
      const policy = await this.policy();
      const c = cutoffs(policy, now);
      for (const rule of RULES) {
        counts[rule.key] = await this.inBatches((m) => m.query(
          `WITH doomed AS (SELECT t.id FROM ${rule.table} t WHERE ${rule.where} LIMIT ${RETENTION_BATCH} FOR UPDATE SKIP LOCKED),
                gone AS (DELETE FROM ${rule.table} WHERE id IN (SELECT id FROM doomed) RETURNING 1)
           SELECT count(*)::int AS n FROM gone`,
          [rule.param(c)],
        ));
      }
      counts.bookingsAnonymised = await this.inBatches((m) => this.anonymiseBatch(m, c.bookingVisitBefore));
    } catch (e) {
      ok = false;
      detail = (e as Error).message.slice(0, 2000);
    } finally {
      this.running = false;
    }
    const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
    if (ok) this.logger.log(`retention run (${trigger}): ${summary}`);
    else this.logger.error(`retention run (${trigger}) FAILED after ${summary}: ${detail}`);
    await this.db.query(
      'INSERT INTO retention_runs (started_at, dry_run, ok, trigger, counts, detail) VALUES ($1, false, $2, $3, $4::jsonb, $5)',
      [startedAt, ok, trigger, JSON.stringify(counts), detail],
    ).catch((e: Error) => this.logger.error(`could not record the retention run: ${e.message}`));
    return counts;
  }

  /** Records a preview in the log so managers can see what it would have done. */
  async recordPreview(counts: RetentionCounts): Promise<void> {
    await this.db.query(
      "INSERT INTO retention_runs (started_at, dry_run, ok, trigger, counts, detail) VALUES (now(), true, true, 'manual', $1::jsonb, 'dry run: nothing changed')",
      [JSON.stringify(counts)],
    );
  }

  /** Repeats `batch` (one transaction each) until it affects fewer rows than a full batch. */
  private async inBatches(batch: (m: EntityManager) => Promise<{ n: number }[] | number>): Promise<number> {
    let total = 0;
    for (let i = 0; i < 100_000; i++) {
      const res = await this.db.transaction(batch);
      const n = typeof res === 'number' ? res : Number(res[0]?.n ?? 0);
      total += n;
      if (n < RETENTION_BATCH) break;
    }
    return total;
  }

  /**
   * Clears the personal fields of up to one batch of bookings past the
   * accounting period, and of their waivers, audit diffs and payment payloads.
   * Amounts, dates, lines, statuses and receipt numbers stay for the books.
   */
  private async anonymiseBatch(m: EntityManager, visitBefore: string): Promise<number> {
    const rows: { id: string }[] = await m.query(
      `SELECT t.id FROM bookings t WHERE ${ANONYMISE_WHERE} ORDER BY t.visit_date LIMIT ${RETENTION_BATCH} FOR UPDATE SKIP LOCKED`,
      [visitBefore],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return 0;
    await m.query(
      `UPDATE bookings SET guest_name = 'Removed', email = '', phone = '', staff_note = '', leader_name = '',
              participants = '[]'::jsonb, idempotency_key = NULL, anonymised_at = now()
        WHERE id = ANY($1::uuid[])`, [ids],
    );
    await m.query(
      `UPDATE waivers SET participant_name = 'Removed', signed_by = 'Removed', guardian_name = '', address = '',
              email = '', phone = '', id_number = '', emergency_name = '', emergency_phone = '', medical_notes = '',
              signature_png = '', ip = '', user_agent = '', group_participants = NULL,
              birth_date = make_date(extract(year FROM birth_date)::int, 1, 1), anonymised_at = now()
        WHERE booking_id = ANY($1::uuid[])`, [ids],
    );
    await m.query("UPDATE booking_audit SET changes = '{}'::jsonb WHERE booking_id = ANY($1::uuid[])", [ids]);
    await m.query('UPDATE payments SET raw = NULL WHERE booking_id = ANY($1::uuid[])', [ids]);
    return ids.length;
  }
}
