import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In, ObjectLiteral, Repository } from 'typeorm';
import { JobApplication, JobVacancy } from '../entities';
import type { StaffPrincipal } from '../staff/auth/staff-auth.types';
import { MAX_PAGE_SIZE } from './dto/hr.dto';
import { HrService, slugify } from './hr.service';

interface WhereCall {
  sql: string;
  params: Record<string, unknown>;
}

/** Records every clause a service method builds, so the SQL can be asserted. */
class FakeQueryBuilder {
  readonly wheres: WhereCall[] = [];
  readonly selects: [string, string][] = [];
  orderByCall: [string, string] | null = null;
  groupByCall: string | null = null;
  skipCall: number | null = null;
  takeCall: number | null = null;

  constructor(
    private readonly result: {
      many?: unknown[];
      manyAndCount?: [unknown[], number];
      raw?: unknown[];
      count?: number;
    },
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
  select(expr: string, alias: string): this {
    this.selects.push([expr, alias]);
    return this;
  }
  addSelect(expr: string, alias: string): this {
    this.selects.push([expr, alias]);
    return this;
  }
  groupBy(field: string): this {
    this.groupByCall = field;
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
  getMany(): Promise<unknown[]> {
    return Promise.resolve(this.result.many ?? []);
  }
  getManyAndCount(): Promise<[unknown[], number]> {
    return Promise.resolve(this.result.manyAndCount ?? [[], 0]);
  }
  getRawMany(): Promise<unknown[]> {
    return Promise.resolve(this.result.raw ?? []);
  }
  getCount(): Promise<number> {
    return Promise.resolve(this.result.count ?? 0);
  }
}

const HR: StaffPrincipal = {
  id: 'staff-hr',
  email: 'hr@vallepark.com',
  name: 'HR',
  role: 'hr',
};

function vacancy(over: Partial<JobVacancy> = {}): JobVacancy {
  return {
    id: 'v1',
    slug: 'zipline-guide',
    title: 'Zipline guide',
    department: 'Adventure',
    location: 'Chamouny, Mauritius',
    employment: 'full-time',
    summary: 'Run the line.',
    description: 'Long copy.',
    requirements: 'Head for heights',
    benefits: 'Meals on shift',
    salaryRange: 'Rs 22,000 - Rs 28,000',
    status: 'published',
    closesOn: '2026-09-30',
    createdBy: 'staff-hr',
    createdAt: new Date('2026-08-01T06:00:00.000Z'),
    updatedAt: new Date('2026-08-02T06:00:00.000Z'),
    ...over,
  };
}

function application(over: Partial<JobApplication> = {}): JobApplication {
  return {
    id: 'a1',
    vacancyId: 'v1',
    fullName: 'Ariane Léger',
    email: 'ariane@example.com',
    phone: '+230 5555 1234',
    cvUrl: 'https://drive.example.com/cv.pdf',
    coverLetter: 'I would love to join.',
    yearsExperience: 3,
    status: 'new',
    hrNote: '',
    reviewedBy: null,
    createdAt: new Date('2026-08-05T06:00:00.000Z'),
    updatedAt: new Date('2026-08-05T06:00:00.000Z'),
    ...over,
  };
}

type Repo<T extends ObjectLiteral> = jest.Mocked<Repository<T>> & {
  createQueryBuilder: jest.Mock;
};

/** Query builders are handed out in call order so each carries its own result. */
function makeRepo<T extends ObjectLiteral>(
  builders: FakeQueryBuilder[] = [],
): Repo<T> {
  const queue = [...builders];
  const repo = {
    createQueryBuilder: jest.fn(() => queue.shift() ?? new FakeQueryBuilder({})),
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: unknown) => Promise.resolve(input)),
    delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    count: jest.fn().mockResolvedValue(0),
  };
  return repo as unknown as Repo<T>;
}

function build(repos: {
  vacancy?: Repo<JobVacancy>;
  application?: Repo<JobApplication>;
}): HrService {
  return new HrService(
    repos.vacancy ?? makeRepo<JobVacancy>(),
    repos.application ?? makeRepo<JobApplication>(),
  );
}

describe('slugify', () => {
  it('derives a lowercase dashed slug from the title', () => {
    expect(slugify('Zipline Guide')).toBe('zipline-guide');
    expect(slugify('  Food & Beverage Supervisor  ')).toBe(
      'food-beverage-supervisor',
    );
  });

  it('strips accents and punctuation rather than escaping them', () => {
    expect(slugify('Chef de Réception (Été)')).toBe('chef-de-reception-ete');
    expect(slugify("Guide d'aventure")).toBe('guide-d-aventure');
  });

  it('never returns an empty or dash-only slug', () => {
    expect(slugify('!!! ???')).toBe('vacancy');
    expect(slugify('---')).toBe('vacancy');
  });

  it('caps the length without leaving a trailing dash', () => {
    const slug = slugify(`${'word '.repeat(40)}`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('HrService.listVacancies', () => {
  it('counts applications in ONE grouped query, not one per vacancy', async () => {
    const list = new FakeQueryBuilder({
      many: [vacancy({ id: 'v1' }), vacancy({ id: 'v2', slug: 'chef' })],
    });
    const counts = new FakeQueryBuilder({
      raw: [{ vacancyId: 'v1', count: '4' }],
    });
    const applicationRepo = makeRepo<JobApplication>([counts]);

    const { items } = await build({
      vacancy: makeRepo<JobVacancy>([list]),
      application: applicationRepo,
    }).listVacancies({});

    // Two vacancies, exactly one count query, and no per-row count() at all.
    expect(applicationRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(applicationRepo.count).not.toHaveBeenCalled();
    expect(counts.groupByCall).toBe('a.vacancyId');
    expect(counts.selects).toEqual([
      ['a.vacancyId', 'vacancyId'],
      ['COUNT(*)', 'count'],
    ]);
    expect(counts.wheres[0].params).toEqual({ ids: ['v1', 'v2'] });
    expect(items.map((i) => i.applicationCount)).toEqual([4, 0]);
  });

  it('includes drafts, filters by status when asked, and sorts newest first', async () => {
    const list = new FakeQueryBuilder({ many: [vacancy({ status: 'draft' })] });
    const { items } = await build({
      vacancy: makeRepo<JobVacancy>([list]),
    }).listVacancies({ status: 'draft' });

    expect(list.wheres).toEqual([
      { sql: 'v.status = :status', params: { status: 'draft' } },
    ]);
    expect(list.orderByCall).toEqual(['v.createdAt', 'DESC']);
    expect(items[0].status).toBe('draft');
  });

  it('skips the count query entirely when there are no vacancies', async () => {
    const applicationRepo = makeRepo<JobApplication>();
    const { items } = await build({
      vacancy: makeRepo<JobVacancy>([new FakeQueryBuilder({ many: [] })]),
      application: applicationRepo,
    }).listVacancies({});

    expect(items).toEqual([]);
    expect(applicationRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('HrService.createVacancy', () => {
  const payload = {
    title: 'Zipline Guide',
    employment: 'full-time' as const,
    status: 'published' as const,
  };

  it('derives the slug server-side and records the author from the session', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([new FakeQueryBuilder({ raw: [] })]);
    vacancyRepo.save.mockResolvedValue(vacancy({ slug: 'zipline-guide' }));

    const row = await build({ vacancy: vacancyRepo }).createVacancy(payload, HR);

    expect(vacancyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'zipline-guide', createdBy: 'staff-hr' }),
    );
    expect(row.slug).toBe('zipline-guide');
    expect(row.applicationCount).toBe(0);
  });

  it('de-duplicates a taken slug with a numeric suffix', async () => {
    const lookup = new FakeQueryBuilder({
      raw: [{ slug: 'zipline-guide' }, { slug: 'zipline-guide-2' }],
    });
    const vacancyRepo = makeRepo<JobVacancy>([lookup]);
    vacancyRepo.save.mockResolvedValue(vacancy({ slug: 'zipline-guide-3' }));

    await build({ vacancy: vacancyRepo }).createVacancy(payload, HR);

    // The base and its siblings are read with bound parameters only.
    expect(lookup.wheres[0].sql).toBe('v.slug = :base OR v.slug LIKE :prefix');
    expect(lookup.wheres[0].params).toEqual({
      base: 'zipline-guide',
      prefix: 'zipline-guide-%',
    });
    expect(vacancyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'zipline-guide-3' }),
    );
  });

  it('looks again when the unique index rejects a slug it lost a race for', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([
      new FakeQueryBuilder({ raw: [] }),
      new FakeQueryBuilder({ raw: [{ slug: 'zipline-guide' }] }),
    ]);
    vacancyRepo.save
      .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
      .mockResolvedValueOnce(vacancy({ slug: 'zipline-guide-2' }));

    const row = await build({ vacancy: vacancyRepo }).createVacancy(payload, HR);

    expect(vacancyRepo.save).toHaveBeenCalledTimes(2);
    expect(row.slug).toBe('zipline-guide-2');
  });

  it('does not swallow an unrelated database error', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([new FakeQueryBuilder({ raw: [] })]);
    vacancyRepo.save.mockRejectedValue(
      Object.assign(new Error('not null violation'), { code: '23502' }),
    );

    await expect(
      build({ vacancy: vacancyRepo }).createVacancy(payload, HR),
    ).rejects.toThrow('not null violation');
    expect(vacancyRepo.save).toHaveBeenCalledTimes(1);
  });

  it('defaults the optional copy instead of writing null', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([new FakeQueryBuilder({ raw: [] })]);
    vacancyRepo.save.mockResolvedValue(vacancy());

    await build({ vacancy: vacancyRepo }).createVacancy(
      { title: 'Chef', employment: 'seasonal', status: 'draft' },
      HR,
    );

    expect(vacancyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        department: '',
        summary: '',
        description: '',
        requirements: '',
        benefits: '',
        salaryRange: '',
        location: 'Chamouny, Mauritius',
        closesOn: null,
      }),
    );
  });
});

describe('HrService.updateVacancy', () => {
  it('applies only the supplied fields and leaves the public slug alone', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([new FakeQueryBuilder({ raw: [] })]);
    vacancyRepo.findOne.mockResolvedValue(vacancy());

    const row = await build({ vacancy: vacancyRepo }).updateVacancy('v1', {
      title: 'Senior zipline guide',
      status: 'closed',
    });

    expect(row.title).toBe('Senior zipline guide');
    expect(row.status).toBe('closed');
    // Renaming must not move a URL already shared with candidates.
    expect(row.slug).toBe('zipline-guide');
    expect(row.summary).toBe('Run the line.');
  });

  it('treats a null closesOn as "clear the date"', async () => {
    const vacancyRepo = makeRepo<JobVacancy>([new FakeQueryBuilder({ raw: [] })]);
    vacancyRepo.findOne.mockResolvedValue(vacancy());

    const row = await build({ vacancy: vacancyRepo }).updateVacancy('v1', {
      closesOn: null,
    });

    expect(row.closesOn).toBeNull();
  });

  it('throws NotFound for an unknown id', async () => {
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.findOne.mockResolvedValue(null);

    await expect(
      build({ vacancy: vacancyRepo }).updateVacancy('nope', { title: 'X Y Z' }),
    ).rejects.toThrow(NotFoundException);
    expect(vacancyRepo.save).not.toHaveBeenCalled();
  });
});

describe('HrService.deleteVacancy', () => {
  it('deletes a role nobody applied to', async () => {
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.findOne.mockResolvedValue(vacancy());
    const applicationRepo = makeRepo<JobApplication>();
    applicationRepo.count.mockResolvedValue(0);

    const result = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).deleteVacancy('v1');

    expect(result).toEqual({ ok: true });
    expect(vacancyRepo.delete).toHaveBeenCalledWith({ id: 'v1' });
  });

  it('refuses with 409 and tells HR to close it instead', async () => {
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.findOne.mockResolvedValue(vacancy());
    const applicationRepo = makeRepo<JobApplication>();
    applicationRepo.count.mockResolvedValue(3);

    const service = build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    });

    // Applications cascade in the database, so this delete would destroy
    // candidate history.
    await expect(service.deleteVacancy('v1')).rejects.toThrow(ConflictException);
    await expect(service.deleteVacancy('v1')).rejects.toThrow(/closed/);
    expect(vacancyRepo.delete).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown id', async () => {
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.findOne.mockResolvedValue(null);

    await expect(
      build({ vacancy: vacancyRepo }).deleteVacancy('nope'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('HrService.listApplications', () => {
  it('binds every filter as a parameter and searches name and email with one term', async () => {
    const qb = new FakeQueryBuilder({ manyAndCount: [[application()], 1] });
    const applicationRepo = makeRepo<JobApplication>([qb]);
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.find.mockResolvedValue([vacancy()]);

    const page = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).listApplications({
      vacancyId: 'v1',
      status: 'new',
      q: '  ariane  ',
    });

    expect(qb.wheres.map((w) => w.sql)).toEqual([
      'a.vacancyId = :vacancyId',
      'a.status = :status',
      '(a.fullName ILIKE :q OR a.email ILIKE :q)',
    ]);
    const term = qb.wheres[2];
    expect(Object.keys(term.params)).toEqual(['q']);
    expect(term.params.q).toBe('%ariane%');
    expect(term.sql).not.toContain('ariane');
    expect(qb.orderByCall).toEqual(['a.createdAt', 'DESC']);
    expect(page.total).toBe(1);
  });

  it('resolves vacancy titles in one query for the whole page', async () => {
    const rows = [
      application({ id: 'a1', vacancyId: 'v1' }),
      application({ id: 'a2', vacancyId: 'v1' }),
      application({ id: 'a3', vacancyId: 'v2' }),
    ];
    const applicationRepo = makeRepo<JobApplication>([
      new FakeQueryBuilder({ manyAndCount: [rows, 3] }),
    ]);
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.find.mockResolvedValue([
      vacancy({ id: 'v1', title: 'Zipline guide' }),
      vacancy({ id: 'v2', slug: 'chef', title: 'Chef' }),
    ]);

    const page = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).listApplications({});

    expect(vacancyRepo.find).toHaveBeenCalledTimes(1);
    expect(vacancyRepo.find).toHaveBeenCalledWith({
      where: { id: In(['v1', 'v2']) },
    });
    expect(page.items.map((i) => i.vacancyTitle)).toEqual([
      'Zipline guide',
      'Zipline guide',
      'Chef',
    ]);
  });

  it('defaults to page 1 / 25 and clamps an oversized pageSize', async () => {
    const first = new FakeQueryBuilder({ manyAndCount: [[], 0] });
    const second = new FakeQueryBuilder({ manyAndCount: [[], 0] });
    const service = build({
      application: makeRepo<JobApplication>([first, second]),
    });

    const plain = await service.listApplications({});
    expect(plain.page).toBe(1);
    expect(plain.pageSize).toBe(25);
    expect(first.skipCall).toBe(0);
    expect(first.takeCall).toBe(25);

    const clamped = await service.listApplications({ page: 0, pageSize: 5000 });
    expect(clamped.page).toBe(1);
    expect(clamped.pageSize).toBe(MAX_PAGE_SIZE);
    expect(second.takeCall).toBe(MAX_PAGE_SIZE);
  });

  it('returns the applicant detail HR needs, including the internal note', async () => {
    const applicationRepo = makeRepo<JobApplication>([
      new FakeQueryBuilder({
        manyAndCount: [[application({ hrNote: 'Strong fit' })], 1],
      }),
    ]);
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.find.mockResolvedValue([vacancy()]);

    const page = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).listApplications({});

    expect(page.items[0]).toEqual({
      id: 'a1',
      vacancyId: 'v1',
      vacancyTitle: 'Zipline guide',
      vacancySlug: 'zipline-guide',
      fullName: 'Ariane Léger',
      email: 'ariane@example.com',
      phone: '+230 5555 1234',
      cvUrl: 'https://drive.example.com/cv.pdf',
      coverLetter: 'I would love to join.',
      yearsExperience: 3,
      status: 'new',
      hrNote: 'Strong fit',
      reviewedBy: null,
      createdAt: '2026-08-05T06:00:00.000Z',
      updatedAt: '2026-08-05T06:00:00.000Z',
    });
  });
});

describe('HrService.updateApplication', () => {
  it('records the reviewer from the session, never from the body', async () => {
    const applicationRepo = makeRepo<JobApplication>();
    applicationRepo.findOne.mockResolvedValue(application());
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.find.mockResolvedValue([vacancy()]);

    const row = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).updateApplication('a1', { status: 'shortlisted', hrNote: 'Call her' }, HR);

    expect(row.status).toBe('shortlisted');
    expect(row.hrNote).toBe('Call her');
    expect(row.reviewedBy).toBe('staff-hr');
  });

  it('rejects an empty patch rather than stamping a reviewer for nothing', async () => {
    const applicationRepo = makeRepo<JobApplication>();

    await expect(
      build({ application: applicationRepo }).updateApplication('a1', {}, HR),
    ).rejects.toThrow(BadRequestException);
    expect(applicationRepo.findOne).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown id', async () => {
    const applicationRepo = makeRepo<JobApplication>();
    applicationRepo.findOne.mockResolvedValue(null);

    await expect(
      build({ application: applicationRepo }).updateApplication(
        'nope',
        { status: 'rejected' },
        HR,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('HrService.stats', () => {
  it('returns the four back-office counters', async () => {
    const vacancyRepo = makeRepo<JobVacancy>();
    vacancyRepo.count
      .mockResolvedValueOnce(3) // published
      .mockResolvedValueOnce(2); // draft
    const week = new FakeQueryBuilder({ count: 9 });
    const applicationRepo = makeRepo<JobApplication>([week]);
    applicationRepo.count.mockResolvedValue(5);

    const stats = await build({
      vacancy: vacancyRepo,
      application: applicationRepo,
    }).stats();

    expect(stats).toEqual({
      openVacancies: 3,
      draftVacancies: 2,
      newApplications: 5,
      applicationsThisWeek: 9,
    });
    expect(vacancyRepo.count).toHaveBeenCalledWith({
      where: { status: 'published' },
    });
    expect(applicationRepo.count).toHaveBeenCalledWith({
      where: { status: 'new' },
    });
  });

  it('counts the week in the park timezone, not the server one', async () => {
    const week = new FakeQueryBuilder({ count: 0 });
    await build({ application: makeRepo<JobApplication>([week]) }).stats();

    expect(week.wheres[0].sql).toBe(
      '(a.createdAt AT TIME ZONE CAST(:tz AS text))::date >= :from',
    );
    const params = week.wheres[0].params as { tz: string; from: string };
    expect(params.tz).toBe('Indian/Mauritius');

    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Indian/Mauritius',
    });
    const expected = new Date(`${today}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() - 6);
    expect(params.from).toBe(expected.toISOString().slice(0, 10));
  });
});
