import {
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';
import { computeBooking } from '../../bookings/pricing';
import {
  Booking,
  BookingAudit,
  BookingLine,
  ChatConversation,
  Experience,
  Quote,
  Setting,
} from '../../entities';
import type { StaffPrincipal } from '../auth/staff-auth.types';
import { MAX_PAGE_SIZE } from './dto/list-bookings.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { StaffBookingsService } from './staff-bookings.service';

interface WhereCall {
  sql: string;
  params: Record<string, unknown>;
}

/** Records every clause a service method builds, so the SQL can be asserted. */
class FakeQueryBuilder {
  readonly wheres: WhereCall[] = [];
  orderByCall: [string, string] | null = null;
  skipCall: number | null = null;
  takeCall: number | null = null;
  selectCall: [string, string] | null = null;

  constructor(
    private readonly result: { many?: [unknown[], number]; count?: number; raw?: unknown },
  ) {}

  where(sql: string, params: Record<string, unknown> = {}): this {
    this.wheres.length = 0;
    this.wheres.push({ sql, params });
    return this;
  }
  andWhere(sql: string, params: Record<string, unknown> = {}): this {
    this.wheres.push({ sql, params });
    return this;
  }
  orderBy(field: string, dir: string): this {
    this.orderByCall = [field, dir];
    return this;
  }
  skip(n: number): this {
    this.skipCall = n;
    return this;
  }
  take(n: number): this {
    this.takeCall = n;
    return this;
  }
  select(expr: string, alias: string): this {
    this.selectCall = [expr, alias];
    return this;
  }
  getManyAndCount(): Promise<[unknown[], number]> {
    return Promise.resolve(this.result.many ?? [[], 0]);
  }
  getCount(): Promise<number> {
    return Promise.resolve(this.result.count ?? 0);
  }
  getRawOne(): Promise<unknown> {
    return Promise.resolve(this.result.raw ?? null);
  }
}

// ------------------------------------------------------------------- fixtures

type EntityCtor<T extends object> = new () => T;

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return Object.assign(
    new Booking(),
    {
      id: 'b1',
      refCode: 'VAL-1234-26',
      visitDate: '2026-08-20',
      slot: 'morning' as const,
      adults: 2,
      kids: 1,
      rate: 'rr' as const,
      guestName: 'Ariane Léger',
      phone: '+230 5555 1234',
      email: 'ariane@example.com',
      nationality: 'MU',
      payMode: 'gate' as const,
      status: 'confirmed',
      entryAmount: 1250,
      subtotal: 4250,
      discount: 0,
      total: 4250,
      currency: 'MUR',
      staffNote: '',
      updatedAt: new Date('2026-08-06T09:30:00.000Z'),
      updatedBy: null,
      createdAt: new Date('2026-08-06T09:30:00.000Z'),
    },
    overrides,
  );
}

function makeLine(overrides: Partial<BookingLine> = {}): BookingLine {
  return Object.assign(
    new BookingLine(),
    {
      id: 1,
      bookingId: 'b1',
      experienceId: null,
      label: 'line',
      adults: 0,
      kids: 0,
      units: 0,
      amount: 0,
      sortOrder: 0,
    },
    overrides,
  );
}

function makeExperience(overrides: Partial<Experience> = {}): Experience {
  return Object.assign(
    new Experience(),
    {
      id: 'zipline',
      name: 'Zipline',
      categoryId: 'adventure',
      thrill: 5,
      durationLabel: '90 min',
      ageLabel: '8+',
      basePrice: 1200,
      priceMode: 'pp' as const,
      flatLabel: null,
      image: '/images/zipline.jpg',
      blurb: 'Fly over the gorge',
      detail: null,
      priceRr: 1200,
      priceNr: 1800,
      sortOrder: 1,
    },
    overrides,
  );
}

function makeSetting(key: string, value: string): Setting {
  return Object.assign(new Setting(), { key, value });
}

const ENTRY_SETTINGS = [
  makeSetting('entry_adult', '500'),
  makeSetting('entry_child', '250'),
];

const STAFF: StaffPrincipal = {
  id: 'staff-1',
  email: 'sales@vallepark.com',
  name: 'Sales Desk',
  role: 'manager',
};

const BOOKING: Booking = makeBooking();

// --------------------------------------------------------------- fake plumbing

interface FakeState {
  booking: Booking | null;
  lines: BookingLine[];
  experiences: Experience[];
  settings: Setting[];
  audit: BookingAudit[];
}

/**
 * A tiny in-memory EntityManager: enough of find/findOne/create/save/delete for
 * the update path, and it applies the writes so the returned detail reflects
 * what the service actually persisted.
 */
class FakeManager {
  readonly deleted: { entity: string; criteria: unknown }[] = [];
  readonly lockModes: unknown[] = [];

  constructor(readonly state: FakeState) {}

  findOne<T extends object>(
    ctor: EntityCtor<T>,
    options: { lock?: unknown },
  ): Promise<T | null> {
    if (ctor === (Booking as unknown as EntityCtor<T>)) {
      this.lockModes.push(options.lock);
      return Promise.resolve(this.state.booking as unknown as T | null);
    }
    return Promise.resolve(null);
  }

  find<T extends object>(
    ctor: EntityCtor<T>,
    options?: { where?: Record<string, unknown>; take?: number },
  ): Promise<T[]> {
    if (ctor === (BookingLine as unknown as EntityCtor<T>)) {
      const where = options?.where ?? {};
      // The re-pricing read filters on experienceId (Not(IsNull())).
      const rows =
        'experienceId' in where
          ? this.state.lines.filter((l) => l.experienceId !== null)
          : this.state.lines;
      return Promise.resolve([...rows] as unknown as T[]);
    }
    if (ctor === (BookingAudit as unknown as EntityCtor<T>)) {
      const rows = this.state.audit.slice(0, options?.take ?? 20);
      return Promise.resolve(rows as unknown as T[]);
    }
    if (ctor === (Experience as unknown as EntityCtor<T>)) {
      return Promise.resolve([...this.state.experiences] as unknown as T[]);
    }
    if (ctor === (Setting as unknown as EntityCtor<T>)) {
      return Promise.resolve([...this.state.settings] as unknown as T[]);
    }
    return Promise.resolve([]);
  }

  create<T extends object>(ctor: EntityCtor<T>, values: Partial<T>): T {
    return Object.assign(new ctor(), values);
  }

  save(a: unknown, b?: unknown): Promise<unknown> {
    const value = b === undefined ? a : b;
    const rows: unknown[] = Array.isArray(value) ? value : [value];
    for (const row of rows) {
      if (row instanceof BookingLine) {
        this.state.lines.push(row);
      } else if (row instanceof BookingAudit) {
        // The DB fills created_at; TypeORM hands it back on the saved entity.
        row.createdAt = row.createdAt ?? new Date('2026-08-07T10:00:00.000Z');
        this.state.audit.unshift(row); // newest first
      } else if (row instanceof Booking) {
        this.state.booking = row;
      }
    }
    return Promise.resolve(value);
  }

  delete(ctor: EntityCtor<object>, criteria: unknown): Promise<unknown> {
    if (ctor === (BookingLine as unknown as EntityCtor<object>)) {
      this.state.lines = [];
      this.deleted.push({ entity: 'BookingLine', criteria });
    }
    return Promise.resolve({ affected: 0 });
  }
}

type Repo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

/** Query builders are handed out in call order so each one can carry its own result. */
function makeRepo<T extends ObjectLiteral>(
  builders: FakeQueryBuilder[] = [],
): Repo<T> & { builders: FakeQueryBuilder[] } {
  const queue = [...builders];
  const repo = {
    builders,
    createQueryBuilder: jest.fn(
      () => queue.shift() ?? new FakeQueryBuilder({}),
    ),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    count: jest.fn(),
  };
  return repo as unknown as Repo<T> & { builders: FakeQueryBuilder[] };
}

function build(repos: {
  dataSource?: DataSource;
  booking?: Repo<Booking>;
  line?: Repo<BookingLine>;
  audit?: Repo<BookingAudit>;
  quote?: Repo<Quote>;
  chat?: Repo<ChatConversation>;
}): StaffBookingsService {
  return new StaffBookingsService(
    repos.dataSource ?? ({} as DataSource),
    repos.booking ?? makeRepo<Booking>(),
    repos.line ?? makeRepo<BookingLine>(),
    repos.audit ?? makeRepo<BookingAudit>(),
    repos.quote ?? makeRepo<Quote>(),
    repos.chat ?? makeRepo<ChatConversation>(),
  );
}

interface Harness {
  service: StaffBookingsService;
  manager: FakeManager;
  transaction: jest.Mock;
}

/** A service whose transaction() hands the callback one shared FakeManager. */
function harness(state: Partial<FakeState> = {}): Harness {
  const manager = new FakeManager({
    booking: state.booking ?? null,
    lines: state.lines ?? [],
    experiences: state.experiences ?? [],
    settings: state.settings ?? ENTRY_SETTINGS,
    audit: state.audit ?? [],
  });
  const transaction = jest.fn(
    (run: (m: EntityManager) => Promise<unknown>): Promise<unknown> =>
      run(manager as unknown as EntityManager),
  );
  const dataSource = { transaction } as unknown as DataSource;
  return { service: build({ dataSource }), manager, transaction };
}

// ----------------------------------------------------------------------- tests

describe('StaffBookingsService.list', () => {
  it('turns q into a single ILIKE clause with one bound, wildcard-wrapped param', async () => {
    const qb = new FakeQueryBuilder({ many: [[BOOKING], 1] });
    const service = build({ booking: makeRepo<Booking>([qb]) });

    await service.list({ q: '  ariane  ' });

    expect(qb.wheres).toHaveLength(1);
    const [clause] = qb.wheres;
    expect(clause.sql).toContain('b.refCode ILIKE :q');
    expect(clause.sql).toContain('b.guestName ILIKE :q');
    expect(clause.sql).toContain('b.email ILIKE :q');
    expect(clause.sql).toContain('b.phone ILIKE :q');
    // One parameter for all four columns, trimmed, and the term never inlined.
    expect(Object.keys(clause.params)).toEqual(['q']);
    expect(clause.params.q).toBe('%ariane%');
    expect(clause.sql).not.toContain('ariane');
  });

  it('binds status / from / to as separate parameters and sorts newest first', async () => {
    const qb = new FakeQueryBuilder({ many: [[], 0] });
    const service = build({ booking: makeRepo<Booking>([qb]) });

    await service.list({
      status: 'cancelled',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(qb.wheres.map((w) => w.sql)).toEqual([
      'b.status = :status',
      'b.visitDate >= :from',
      'b.visitDate <= :to',
    ]);
    expect(Object.assign({}, ...qb.wheres.map((w) => w.params))).toEqual({
      status: 'cancelled',
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(qb.orderByCall).toEqual(['b.createdAt', 'DESC']);
  });

  it('maps rows to the BookingRow shape, without the staff-only note', async () => {
    const qb = new FakeQueryBuilder({ many: [[BOOKING], 1] });
    const service = build({ booking: makeRepo<Booking>([qb]) });

    const { items, total } = await service.list({});

    expect(total).toBe(1);
    expect(items[0]).toEqual({
      id: 'b1',
      refCode: 'VAL-1234-26',
      visitDate: '2026-08-20',
      slot: 'morning',
      adults: 2,
      kids: 1,
      rate: 'rr',
      guestName: 'Ariane Léger',
      email: 'ariane@example.com',
      phone: '+230 5555 1234',
      nationality: 'MU',
      payMode: 'gate',
      status: 'confirmed',
      entryAmount: 1250,
      subtotal: 4250,
      discount: 0,
      total: 4250,
      currency: 'MUR',
      createdAt: '2026-08-06T09:30:00.000Z',
    });
  });
});

describe('StaffBookingsService paging', () => {
  it('defaults to page 1 / 25 per page', async () => {
    const qb = new FakeQueryBuilder({ many: [[], 0] });
    const service = build({ booking: makeRepo<Booking>([qb]) });

    const result = await service.list({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(25);
    expect(qb.skipCall).toBe(0);
    expect(qb.takeCall).toBe(25);
  });

  it('clamps an oversized pageSize to MAX_PAGE_SIZE and a bad page to 1', async () => {
    const qb = new FakeQueryBuilder({ many: [[], 0] });
    const service = build({ booking: makeRepo<Booking>([qb]) });

    const result = await service.list({ page: 0, pageSize: 5000 });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(MAX_PAGE_SIZE);
    expect(qb.skipCall).toBe(0);
    expect(qb.takeCall).toBe(MAX_PAGE_SIZE);
  });

  it('offsets by page for quotes too, newest first', async () => {
    const qb = new FakeQueryBuilder({ many: [[], 0] });
    const service = build({ quote: makeRepo<Quote>([qb]) });

    const result = await service.listQuotes({ page: 3, pageSize: 10 });

    expect(result).toEqual({ items: [], total: 0, page: 3, pageSize: 10 });
    expect(qb.skipCall).toBe(20);
    expect(qb.takeCall).toBe(10);
    expect(qb.orderByCall).toEqual(['q.createdAt', 'DESC']);
  });
});

describe('StaffBookingsService.detail', () => {
  it('returns the booking with its lines, internal note and audit trail', async () => {
    const booking = makeRepo<Booking>();
    booking.findOne.mockResolvedValue(makeBooking({ staffNote: 'Wheelchair access' }));
    const line = makeRepo<BookingLine>();
    line.find.mockResolvedValue([
      makeLine({ label: 'Park entry', adults: 2, kids: 1, amount: 1250 }),
    ]);
    const audit = makeRepo<BookingAudit>();
    audit.find.mockResolvedValue([
      Object.assign(new BookingAudit(), {
        id: '2',
        bookingId: 'b1',
        staffId: 'staff-1',
        staffEmail: 'sales@vallepark.com',
        action: 'status',
        changes: { status: { from: 'confirmed', to: 'arrived' } },
        createdAt: new Date('2026-08-07T10:00:00.000Z'),
      }),
    ]);

    const service = build({ booking, line, audit });
    const detail = await service.detail('VAL-1234-26');

    expect(detail.refCode).toBe('VAL-1234-26');
    expect(detail.rate).toBe('rr');
    expect(detail.staffNote).toBe('Wheelchair access');
    expect(detail.lines).toEqual([
      { label: 'Park entry', adults: 2, kids: 1, units: 0, amount: 1250 },
    ]);
    expect(detail.audit).toEqual([
      {
        at: '2026-08-07T10:00:00.000Z',
        staffEmail: 'sales@vallepark.com',
        action: 'status',
        changes: { status: { from: 'confirmed', to: 'arrived' } },
      },
    ]);
    expect(line.find).toHaveBeenCalledWith({
      where: { bookingId: 'b1' },
      order: { sortOrder: 'ASC' },
    });
    // Newest first, capped at 20 entries.
    expect(audit.find).toHaveBeenCalledWith({
      where: { bookingId: 'b1' },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 20,
    });
  });

  it('throws NotFound for an unknown reference code', async () => {
    const booking = makeRepo<Booking>();
    booking.findOne.mockResolvedValue(null);

    await expect(build({ booking }).detail('VAL-0000-26')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('StaffBookingsService.update: re-pricing', () => {
  const EXPERIENCES = [
    makeExperience(),
    makeExperience({
      id: 'buggy',
      name: 'Buggy',
      categoryId: 'adventure',
      basePrice: 3500,
      priceMode: 'flat',
      flatLabel: '/ buggy',
      priceRr: null,
      priceNr: null,
      sortOrder: 2,
    }),
  ];

  function partyHarness(): Harness {
    return harness({
      booking: makeBooking(),
      experiences: EXPERIENCES,
      lines: [
        makeLine({
          id: 1,
          experienceId: null,
          label: 'Park entry · 2 adults · 1 child',
          adults: 2,
          kids: 1,
          amount: 1250,
          sortOrder: 0,
        }),
        makeLine({
          id: 2,
          experienceId: 'zipline',
          label: 'Zipline · 2 adults · 1 child',
          adults: 2,
          kids: 1,
          amount: 3000,
          sortOrder: 1,
        }),
      ],
    });
  }

  it('re-prices a party change to exactly what a fresh booking of that party costs', async () => {
    const { service, manager } = partyHarness();

    const detail = await service.update('VAL-1234-26', { adults: 3 }, STAFF);

    // The reference: price this party from scratch with the same experience lines.
    const fresh = computeBooking(
      EXPERIENCES,
      { entryAdult: 500, entryChild: 250 },
      {
        adults: 3,
        kids: 1,
        rate: 'rr',
        items: [{ id: 'zipline', adults: 2, kids: 1, units: 0 }],
      },
    );

    expect(detail.entryAmount).toBe(fresh.entry);
    expect(detail.subtotal).toBe(fresh.subtotal);
    expect(detail.discount).toBe(fresh.discount);
    expect(detail.total).toBe(fresh.total);
    expect(detail.lines).toEqual(
      fresh.lines.map((l) => ({
        label: l.label,
        adults: l.adults,
        kids: l.kids,
        units: l.units,
        amount: l.amount,
      })),
    );

    // And the concrete numbers: entry 3 × 500 + 1 × 250, zipline 2 × 1200 + 1 × 600.
    expect(detail.entryAmount).toBe(1750);
    expect(detail.subtotal).toBe(4750);
    expect(detail.discount).toBe(0);
    expect(detail.total).toBe(4750);
    expect(detail.lines[0].label).toBe('Park entry · 3 adults · 1 child');

    // The old lines were replaced, not appended to.
    expect(manager.deleted).toEqual([
      { entity: 'BookingLine', criteria: { bookingId: 'b1' } },
    ]);
    expect(manager.state.lines).toHaveLength(2);
  });

  it('re-prices a rate change with the non-resident price and audits only the rate', async () => {
    const { service, manager } = partyHarness();

    const detail = await service.update('VAL-1234-26', { rate: 'nr' }, STAFF);

    // entry 1250 + zipline (1800 × 2 + 900 × 1)
    expect(detail.rate).toBe('nr');
    expect(detail.subtotal).toBe(1250 + 4500);
    expect(detail.total).toBe(5750);
    expect(manager.state.audit[0].changes).toEqual({
      rate: { from: 'rr', to: 'nr' },
    });
    expect(manager.state.audit[0].action).toBe('edit');
  });

  it('locks the row for update and records the operator on the booking', async () => {
    const { service, manager } = partyHarness();

    await service.update('VAL-1234-26', { kids: 0 }, STAFF);

    expect(manager.lockModes).toEqual([{ mode: 'pessimistic_write' }]);
    expect(manager.state.booking?.updatedBy).toBe('staff-1');
    expect(manager.state.booking?.kids).toBe(0);
  });
});

describe('StaffBookingsService.update: audit trail', () => {
  it('writes an audit row for a status-only change and leaves the money alone', async () => {
    const { service, manager } = harness({
      booking: makeBooking(),
      lines: [makeLine({ label: 'Park entry', amount: 1250 })],
    });

    const detail = await service.update(
      'VAL-1234-26',
      { status: 'arrived' },
      STAFF,
    );

    expect(detail.status).toBe('arrived');
    // Untouched: no re-pricing, no line rewrite.
    expect(detail.entryAmount).toBe(1250);
    expect(detail.subtotal).toBe(4250);
    expect(detail.discount).toBe(0);
    expect(detail.total).toBe(4250);
    expect(manager.deleted).toEqual([]);
    expect(manager.state.lines).toHaveLength(1);

    expect(manager.state.audit).toHaveLength(1);
    const [entry] = manager.state.audit;
    expect(entry.bookingId).toBe('b1');
    expect(entry.staffId).toBe('staff-1');
    expect(entry.staffEmail).toBe('sales@vallepark.com');
    expect(entry.action).toBe('status');
    expect(entry.changes).toEqual({
      status: { from: 'confirmed', to: 'arrived' },
    });
    expect(detail.audit[0].action).toBe('status');
  });

  it('records exactly the fields that moved, not every field submitted', async () => {
    const { service, manager } = harness({
      booking: makeBooking(),
      lines: [makeLine({ label: 'Park entry', amount: 1250 })],
    });

    await service.update(
      'VAL-1234-26',
      {
        // guestName and slot are resubmitted unchanged, so they are not audited.
        guestName: 'Ariane Léger',
        slot: 'morning',
        visitDate: '2026-08-22',
        staffNote: '  Late arrival, hold the briefing  ',
      },
      STAFF,
    );

    expect(manager.state.audit[0].changes).toEqual({
      visitDate: { from: '2026-08-20', to: '2026-08-22' },
      staffNote: { from: '', to: 'Late arrival, hold the briefing' },
    });
    expect(manager.state.audit[0].action).toBe('edit');
    expect(manager.state.booking?.staffNote).toBe(
      'Late arrival, hold the briefing',
    );
  });

  it('tags a note-only edit as a note', async () => {
    const { service, manager } = harness({ booking: makeBooking() });

    await service.update('VAL-1234-26', { staffNote: 'Called the guest' }, STAFF);

    expect(manager.state.audit[0].action).toBe('note');
  });

  it('writes nothing at all when the submitted values match the stored row', async () => {
    const { service, manager } = harness({ booking: makeBooking() });

    const detail = await service.update(
      'VAL-1234-26',
      { status: 'confirmed', guestName: 'Ariane Léger' },
      STAFF,
    );

    expect(manager.state.audit).toEqual([]);
    expect(manager.state.booking?.updatedBy).toBeNull();
    expect(detail.status).toBe('confirmed');
  });
});

describe('StaffBookingsService.update: rejections', () => {
  it('rejects an empty body with 400 and never opens a transaction', async () => {
    const { service, transaction } = harness({ booking: makeBooking() });

    await expect(service.update('VAL-1234-26', {}, STAFF)).rejects.toThrow(
      BadRequestException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown reference code with NotFound', async () => {
    const { service } = harness({ booking: null });

    await expect(
      service.update('VAL-0000-26', { status: 'cancelled' }, STAFF),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to leave a booking with neither an email nor a phone', async () => {
    const { service } = harness({
      booking: makeBooking({ phone: '', email: 'ariane@example.com' }),
    });

    await expect(
      service.update('VAL-1234-26', { email: '' }, STAFF),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateBookingDto', () => {
  // The same options main.ts registers globally.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  const meta = {
    type: 'body' as const,
    metatype: UpdateBookingDto,
    data: '',
  };

  it('refuses a client-sent total, so money can never come from the request', async () => {
    const hostile: Record<string, unknown> = {
      status: 'arrived',
      total: 1,
      discount: 999,
      subtotal: 1,
      entryAmount: 1,
    };

    await expect(pipe.transform(hostile, meta)).rejects.toBeDefined();
    // The same body without the money fields is perfectly valid.
    await expect(pipe.transform({ status: 'arrived' }, meta)).resolves.toEqual({
      status: 'arrived',
    });
  });

  it('rejects an out-of-range party and a bad status', async () => {
    await expect(pipe.transform({ adults: 13 }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ kids: -1 }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ status: 'refunded' }, meta)).rejects.toBeDefined();
    await expect(
      pipe.transform({ visitDate: '2026-02-31' }, meta),
    ).rejects.toBeDefined();
  });

  it('accepts an empty email as "clear this address" but not a malformed one', async () => {
    await expect(pipe.transform({ email: '' }, meta)).resolves.toEqual({
      email: '',
    });
    await expect(pipe.transform({ email: 'nope' }, meta)).rejects.toBeDefined();
  });
});

describe('StaffBookingsService.stats', () => {
  it('returns the four dashboard counters', async () => {
    const booking = makeRepo<Booking>([
      new FakeQueryBuilder({ count: 4 }), // bookingsToday
      new FakeQueryBuilder({ count: 7 }), // arrivalsToday
      new FakeQueryBuilder({ raw: { sum: '128500' } }), // revenueMonth
    ]);
    const chat = makeRepo<ChatConversation>();
    chat.count.mockResolvedValue(2);

    const stats = await build({ booking, chat }).stats();

    expect(stats).toEqual({
      bookingsToday: 4,
      arrivalsToday: 7,
      openChats: 2,
      revenueMonth: 128500,
    });
    expect(chat.count).toHaveBeenCalledWith({ where: { status: 'open' } });
  });

  it('excludes cancellations from arrivals and reports 0 revenue for an empty month', async () => {
    const arrivals = new FakeQueryBuilder({ count: 0 });
    const booking = makeRepo<Booking>([
      new FakeQueryBuilder({ count: 0 }),
      arrivals,
      new FakeQueryBuilder({ raw: { sum: null } }),
    ]);
    const chat = makeRepo<ChatConversation>();
    chat.count.mockResolvedValue(0);

    const stats = await build({ booking, chat }).stats();

    expect(stats.revenueMonth).toBe(0);
    expect(arrivals.wheres.map((w) => w.sql)).toEqual([
      'b.visitDate = :today',
      'b.status <> :cancelled',
    ]);
    // "today" is the park's calendar day, not the server's.
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Indian/Mauritius',
    });
    expect(arrivals.wheres[0].params).toEqual({ today });
    expect(arrivals.wheres[1].params).toEqual({ cancelled: 'cancelled' });
  });
});
