import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  assign,
  changeStatus,
  createAgent,
  createCustomer,
  createTicket,
} from './helpers/factories';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Agents (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('creates agents (active by default) and lists them', async () => {
    const agent = await createAgent(app, { name: 'Priya', email: 'priya@desk.example' });
    expect(agent.active).toBe(true);

    await createAgent(app, { name: 'Jonas', email: 'jonas@desk.example' });
    const res = await request(app.getHttpServer())
      .get('/agents?sortBy=name&sortOrder=asc')
      .expect(200);
    expect(res.body.data.map((a: { name: string }) => a.name)).toEqual(['Jonas', 'Priya']);
    expect(res.body.meta.total).toBe(2);
  });

  it('rejects invalid input and duplicate e-mails', async () => {
    await request(app.getHttpServer()).post('/agents').send({ name: 'No Email' }).expect(400);
    await createAgent(app, { email: 'dup@desk.example' });
    const res = await request(app.getHttpServer())
      .post('/agents')
      .send({ name: 'Again', email: 'DUP@desk.example' })
      .expect(409);
    expect(res.body.code).toBe('AGENT_EMAIL_TAKEN');
  });

  it('filters by active flag', async () => {
    const a = await createAgent(app);
    await createAgent(app);
    await request(app.getHttpServer()).patch(`/agents/${a.id}`).send({ active: false }).expect(200);

    const inactive = await request(app.getHttpServer()).get('/agents?active=false').expect(200);
    expect(inactive.body.data.map((x: { id: number }) => x.id)).toEqual([a.id]);
    const active = await request(app.getHttpServer()).get('/agents?active=true').expect(200);
    expect(active.body.meta.total).toBe(1);
    await request(app.getHttpServer()).get('/agents?active=maybe').expect(400);
  });

  it.each([
    ['name', { name: null }],
    ['active', { active: null }],
    ['name', { name: '' }],
    ['active', { active: 'yes' }],
  ])('rejects an invalid or null %s on update with 400 (never 500)', async (field, body) => {
    const agent = await createAgent(app);
    const res = await request(app.getHttpServer())
      .patch(`/agents/${agent.id}`)
      .send(body)
      .expect(400);
    expect(res.body.details[0].field).toBe(field);
  });

  it('returns 404 for unknown agents', async () => {
    const res = await request(app.getHttpServer()).get('/agents/4242').expect(404);
    expect(res.body.code).toBe('AGENT_NOT_FOUND');
    await request(app.getHttpServer()).patch('/agents/4242').send({ active: false }).expect(404);
  });

  it('shows the open-ticket workload and blocks deactivation while tickets are open', async () => {
    const customer = await createCustomer(app);
    const agent = await createAgent(app);
    const ticket = await createTicket(app, customer.id);
    await assign(app, ticket.id, agent.id).expect(200);

    const detail = await request(app.getHttpServer()).get(`/agents/${agent.id}`).expect(200);
    expect(detail.body.openTicketCount).toBe(1);

    const blocked = await request(app.getHttpServer())
      .patch(`/agents/${agent.id}`)
      .send({ active: false })
      .expect(409);
    expect(blocked.body).toMatchObject({
      code: 'AGENT_HAS_OPEN_TICKETS',
      details: { openTicketCount: 1 },
    });

    // Once the ticket is resolved it no longer counts as workload.
    await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);
    await changeStatus(app, ticket.id, 'RESOLVED').expect(200);
    const ok = await request(app.getHttpServer())
      .patch(`/agents/${agent.id}`)
      .send({ active: false })
      .expect(200);
    expect(ok.body.active).toBe(false);
  });
});
