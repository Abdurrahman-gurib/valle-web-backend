import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ObjectLiteral, Repository } from 'typeorm';
import { JobApplication, JobVacancy } from '../entities';
import { CareersService } from './careers.service';
import { ApplyToVacancyDto } from './dto/careers.dto';

interface WhereCall {
  sql: string;
  params: Record<string, unknown>;
}

/** Records every clause the service builds, so the SQL can be asserted. */
class FakeQueryBuilder {
  readonly wheres: WhereCall[] = [];
  orderByCall: [string, string] | null = null;

  constructor(private readonly result: { many?: unknown[] }) {}

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
  getMany(): Promise<unknown[]> {
    return Promise.resolve(this.result.many ?? []);
  }
}

const PUBLISHED: JobVacancy = {
  id: 'v1',
  slug: 'zipline-guide',
  title: 'Zipline guide',
  department: 'Adventure',
  location: 'Chamouny, Mauritius',
  employment: 'full-time',
  summary: 'Run the line, keep everyone safe.',
  description: 'Full description of the role.',
  requirements: 'Fluent English\nHead for heights',
  benefits: 'Meals on shift',
  salaryRange: 'Rs 22,000 - Rs 28,000',
  status: 'published',
  closesOn: '2026-09-30',
  createdBy: 'staff-1',
  createdAt: new Date('2026-08-01T06:00:00.000Z'),
  updatedAt: new Date('2026-08-02T06:00:00.000Z'),
};

type Repo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

function makeRepo<T extends ObjectLiteral>(
  builders: FakeQueryBuilder[] = [],
): Repo<T> {
  const queue = [...builders];
  const repo = {
    createQueryBuilder: jest.fn(() => queue.shift() ?? new FakeQueryBuilder({})),
    findOne: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn(),
  };
  return repo as unknown as Repo<T>;
}

function build(repos: {
  vacancy?: Repo<JobVacancy>;
  application?: Repo<JobApplication>;
}): CareersService {
  return new CareersService(
    repos.vacancy ?? makeRepo<JobVacancy>(),
    repos.application ?? makeRepo<JobApplication>(),
  );
}

const APPLICATION: ApplyToVacancyDto = {
  fullName: 'Ariane Léger',
  email: 'ariane@example.com',
  phone: '+230 5555 1234',
  cvUrl: 'https://drive.example.com/cv.pdf',
  coverLetter: 'I would love to join.',
  yearsExperience: 3,
};

describe('CareersService.listPublished', () => {
  it('asks only for published rows, newest first', async () => {
    const qb = new FakeQueryBuilder({ many: [PUBLISHED] });
    const service = build({ vacancy: makeRepo<JobVacancy>([qb]) });

    await service.listPublished();

    expect(qb.wheres).toEqual([
      { sql: 'v.status = :status', params: { status: 'published' } },
    ]);
    expect(qb.orderByCall).toEqual(['v.createdAt', 'DESC']);
  });

  it('returns the card fields only: no id, no author, no long copy', async () => {
    const qb = new FakeQueryBuilder({ many: [PUBLISHED] });
    const service = build({ vacancy: makeRepo<JobVacancy>([qb]) });

    const [card] = await service.listPublished();

    expect(card).toEqual({
      slug: 'zipline-guide',
      title: 'Zipline guide',
      department: 'Adventure',
      location: 'Chamouny, Mauritius',
      employment: 'full-time',
      summary: 'Run the line, keep everyone safe.',
      salaryRange: 'Rs 22,000 - Rs 28,000',
      closesOn: '2026-09-30',
      postedOn: '2026-08-01',
    });
    expect(Object.keys(card)).not.toContain('id');
    expect(Object.keys(card)).not.toContain('createdBy');
  });
});

describe('CareersService.findPublished', () => {
  it('pins the status in the query so a draft cannot be read', async () => {
    const vacancy = makeRepo<JobVacancy>();
    vacancy.findOne.mockResolvedValue(PUBLISHED);

    const detail = await build({ vacancy }).findPublished('zipline-guide');

    expect(vacancy.findOne).toHaveBeenCalledWith({
      where: { slug: 'zipline-guide', status: 'published' },
    });
    expect(detail.description).toBe('Full description of the role.');
    expect(detail.requirements).toBe('Fluent English\nHead for heights');
  });

  it('answers 404 with the same message for a draft and for a typo', async () => {
    const vacancy = makeRepo<JobVacancy>();
    vacancy.findOne.mockResolvedValue(null);
    const service = build({ vacancy });

    // The draft case and the missing case are the same call and the same
    // message: the endpoint must not confirm that an unposted role exists.
    await expect(service.findPublished('secret-draft')).rejects.toThrow(
      new NotFoundException('No such vacancy'),
    );
    await expect(service.findPublished('nothing-here')).rejects.toThrow(
      new NotFoundException('No such vacancy'),
    );
  });

  it('rejects a slug that could never have been generated without a query', async () => {
    const vacancy = makeRepo<JobVacancy>();

    await expect(build({ vacancy }).findPublished('Zip Line%')).rejects.toThrow(
      NotFoundException,
    );
    expect(vacancy.findOne).not.toHaveBeenCalled();
  });
});

describe('CareersService.apply', () => {
  it('stores the application against the published vacancy and returns only its id', async () => {
    const vacancy = makeRepo<JobVacancy>();
    vacancy.findOne.mockResolvedValue(PUBLISHED);
    const application = makeRepo<JobApplication>();
    application.save.mockResolvedValue({
      id: 'a1',
      email: 'ariane@example.com',
    } as JobApplication);

    const result = await build({ vacancy, application }).apply(
      'zipline-guide',
      APPLICATION,
    );

    // Nothing but the id comes back: the caller is anonymous.
    expect(result).toEqual({ id: 'a1' });
    expect(application.create).toHaveBeenCalledWith({
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
    });
  });

  it('defaults every optional field instead of writing null into a NOT NULL column', async () => {
    const vacancy = makeRepo<JobVacancy>();
    vacancy.findOne.mockResolvedValue(PUBLISHED);
    const application = makeRepo<JobApplication>();
    application.save.mockResolvedValue({ id: 'a2' } as JobApplication);

    await build({ vacancy, application }).apply('zipline-guide', {
      fullName: 'Jo',
      email: 'jo@example.com',
    });

    expect(application.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '',
        cvUrl: '',
        coverLetter: '',
        yearsExperience: null,
      }),
    );
  });

  it('never records an application against a vacancy that is not published', async () => {
    const vacancy = makeRepo<JobVacancy>();
    vacancy.findOne.mockResolvedValue(null);
    const application = makeRepo<JobApplication>();

    await expect(
      build({ vacancy, application }).apply('secret-draft', APPLICATION),
    ).rejects.toThrow(new NotFoundException('No such vacancy'));
    expect(application.save).not.toHaveBeenCalled();
  });
});

describe('ApplyToVacancyDto', () => {
  /** Same pipeline the global ValidationPipe runs: transform, then validate. */
  function check(payload: Record<string, unknown>): string[] {
    const dto = plainToInstance(ApplyToVacancyDto, payload);
    return validateSync(dto).map((e) => e.property);
  }

  it('accepts an http(s) CV link', () => {
    expect(
      check({
        fullName: 'Ariane',
        email: 'ariane@example.com',
        cvUrl: 'https://drive.example.com/cv.pdf',
      }),
    ).toEqual([]);
    expect(
      check({
        fullName: 'Ariane',
        email: 'ariane@example.com',
        cvUrl: 'http://cv.example.com/ariane',
      }),
    ).toEqual([]);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    '//evil.example.com/cv.pdf',
    'drive.example.com/cv.pdf',
  ])('rejects %s as a CV link', (cvUrl) => {
    // HR clicks this value, so anything that is not http(s) never gets stored.
    expect(
      check({ fullName: 'Ariane', email: 'ariane@example.com', cvUrl }),
    ).toContain('cvUrl');
  });

  it('rejects a CV link longer than 500 characters', () => {
    const cvUrl = `https://example.com/${'a'.repeat(500)}`;
    expect(
      check({ fullName: 'Ariane', email: 'ariane@example.com', cvUrl }),
    ).toContain('cvUrl');
  });

  it('treats the empty strings an untouched form posts as "not supplied"', () => {
    expect(
      check({
        fullName: '  Ariane  ',
        email: 'ARIANE@Example.com ',
        phone: '',
        cvUrl: '',
        coverLetter: '',
        yearsExperience: '',
      }),
    ).toEqual([]);

    const dto = plainToInstance(ApplyToVacancyDto, {
      fullName: '  Ariane  ',
      email: 'ARIANE@Example.com ',
      cvUrl: '',
      yearsExperience: '',
    });
    expect(dto.fullName).toBe('Ariane');
    expect(dto.email).toBe('ariane@example.com');
    expect(dto.cvUrl).toBeUndefined();
    // An empty number box must not silently become "0 years".
    expect(dto.yearsExperience).toBeUndefined();
  });

  it('enforces the name, email and cover letter bounds', () => {
    expect(check({ fullName: 'A', email: 'ariane@example.com' })).toContain(
      'fullName',
    );
    expect(check({ fullName: 'Ariane', email: 'not-an-email' })).toContain(
      'email',
    );
    expect(
      check({
        fullName: 'Ariane',
        email: 'ariane@example.com',
        coverLetter: 'x'.repeat(4001),
      }),
    ).toContain('coverLetter');
    expect(
      check({
        fullName: 'Ariane',
        email: 'ariane@example.com',
        yearsExperience: 61,
      }),
    ).toContain('yearsExperience');
  });
});
