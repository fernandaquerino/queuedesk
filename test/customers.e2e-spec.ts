import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createCustomer } from './helpers/factories';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('creates a customer and normalises the e-mail', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: '  Dana Whitfield ', email: '  Dana@Northwind.EXAMPLE ', company: 'Northwind' })
      .expect(201);

    expect(res.body).toMatchObject({
      name: 'Dana Whitfield',
      email: 'dana@northwind.example',
      company: 'Northwind',
    });
    expect(res.body.id).toEqual(expect.any(Number));
    await request(app.getHttpServer()).get(`/customers/${res.body.id}`).expect(200);
  });

  it.each([
    ['missing name', { email: 'a@b.example' }, 'name'],
    ['blank name', { name: '   ', email: 'a@b.example' }, 'name'],
    ['invalid e-mail', { name: 'A', email: 'not-an-email' }, 'email'],
    ['name too long', { name: 'x'.repeat(121), email: 'a@b.example' }, 'name'],
    ['non-string name', { name: 42, email: 'a@b.example' }, 'name'],
  ])('rejects %s with 400 and field details', async (_label, body, field) => {
    const res = await request(app.getHttpServer()).post('/customers').send(body).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.map((d: { field: string }) => d.field)).toContain(field);
  });

  it('rejects unknown properties', async () => {
    const res = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'A', email: 'a@b.example', isAdmin: true })
      .expect(400);
    expect(res.body.details[0].field).toBe('isAdmin');
  });

  it('rejects a duplicate e-mail (case-insensitively) with 409', async () => {
    await createCustomer(app, { email: 'same@example.com' });
    const res = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'Other', email: 'SAME@example.com' })
      .expect(409);
    expect(res.body.code).toBe('CUSTOMER_EMAIL_TAKEN');
  });

  it('returns 404 for an unknown customer and 400 for a malformed id', async () => {
    const missing = await request(app.getHttpServer()).get('/customers/9999').expect(404);
    expect(missing.body.code).toBe('CUSTOMER_NOT_FOUND');
    await request(app.getHttpServer()).get('/customers/abc').expect(400);
    await request(app.getHttpServer()).get('/customers/0').expect(400);
    await request(app.getHttpServer()).get('/customers/99999999999').expect(400);
  });

  it('lists customers with pagination, sorting and search', async () => {
    for (const name of ['Charlie', 'Alice', 'Bob', 'Alicia', 'Dora']) {
      await createCustomer(app, { name, email: `${name.toLowerCase()}@example.com` });
    }

    const page1 = await request(app.getHttpServer())
      .get('/customers?sortBy=name&sortOrder=asc&pageSize=2&page=1')
      .expect(200);
    expect(page1.body.data.map((c: { name: string }) => c.name)).toEqual(['Alice', 'Alicia']);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const page3 = await request(app.getHttpServer())
      .get('/customers?sortBy=name&sortOrder=asc&pageSize=2&page=3')
      .expect(200);
    expect(page3.body.data.map((c: { name: string }) => c.name)).toEqual(['Dora']);

    const search = await request(app.getHttpServer())
      .get('/customers?search=ALIC&sortBy=name&sortOrder=asc')
      .expect(200);
    expect(search.body.data.map((c: { name: string }) => c.name)).toEqual(['Alice', 'Alicia']);
    expect(search.body.meta.total).toBe(2);
  });

  it('validates pagination parameters', async () => {
    await request(app.getHttpServer()).get('/customers?pageSize=1000').expect(400);
    await request(app.getHttpServer()).get('/customers?page=0').expect(400);
    await request(app.getHttpServer()).get('/customers?sortBy=password').expect(400);
    await request(app.getHttpServer()).get('/customers?sortOrder=sideways').expect(400);
  });
});
