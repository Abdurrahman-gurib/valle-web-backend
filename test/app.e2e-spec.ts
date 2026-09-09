/**
 * End-to-end tests run against the dev PostgreSQL database
 * (schema.sql + seed.sql loaded, env from .env / .env.example).
 *
 * They are OPT-IN: set TEST_DB=1 to enable them, so the suite never fails
 * on machines without a reachable database.
 *
 *   TEST_DB=1 npm run test:e2e
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const DB_AVAILABLE = process.env.TEST_DB === '1';
const describeE2e = DB_AVAILABLE ? describe : describe.skip;

describe('e2e placeholder', () => {
  it('skips database e2e tests unless TEST_DB=1 is set', () => {
    expect(true).toBe(true);
  });
});

describeE2e('VALLÉ Advenature Park API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health reports ok with db connectivity', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe(true);
  });

  it('GET /api/catalog returns the full catalog shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/catalog').expect(200);
    for (const key of [
      'CAT', 'ACTS', 'PINS', 'RESTOS', 'PACKS', 'GAL', 'COMBO', 'CINE',
      'RATEP', 'PL', 'PHOTO', 'TEAM', 'HERO', 'ENTRY_A', 'ENTRY_C',
    ]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it('GET /api/experiences/:id 404s on unknown ids', async () => {
    await request(app.getHttpServer())
      .get('/api/experiences/does-not-exist')
      .expect(404);
  });
});
