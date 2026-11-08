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
import { TEST_DATABASE_FILE } from './test-db';
import { existsSync } from 'node:fs';

describe('Persistence (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('uses a real SQLite file that is separate from the development database', () => {
    expect(process.env.DATABASE_URL).toBe('file:./test.db');
    expect(existsSync(TEST_DATABASE_FILE)).toBe(true);
    expect(TEST_DATABASE_FILE.endsWith('dev.db')).toBe(false);
  });

  it('keeps data after the application is shut down and started again', async () => {
    const customer = await createCustomer(app, { email: 'persist@example.com' });
    const agent = await createAgent(app);
    const ticket = await createTicket(app, customer.id, { subject: 'Survives restart' });
    await assign(app, ticket.id, agent.id).expect(200);
    await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);
    await request(app.getHttpServer())
      .post(`/tickets/${ticket.id}/comments`)
      .send({ body: 'Persisted comment', authorType: 'CUSTOMER' })
      .expect(201);

    await app.close();
    ({ app, prisma } = await createTestApp());

    const res = await request(app.getHttpServer()).get(`/tickets/${ticket.id}`).expect(200);
    expect(res.body).toMatchObject({
      subject: 'Survives restart',
      status: 'IN_PROGRESS',
      assigneeId: agent.id,
      customer: { email: 'persist@example.com' },
    });
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.statusHistory).toHaveLength(2);
  });

  it('enforces referential integrity at the database level', async () => {
    const customer = await createCustomer(app);
    await createTicket(app, customer.id);

    // A customer that still has tickets cannot be removed behind the API's back.
    await expect(prisma.customer.delete({ where: { id: customer.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    // Orphan tickets cannot be inserted either.
    await expect(
      prisma.ticket.create({ data: { subject: 's', description: 'd', customerId: 987654 } }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces unique e-mails at the database level (not just in the service)', async () => {
    await createCustomer(app, { email: 'unique@example.com' });
    await expect(
      prisma.customer.create({ data: { name: 'Dup', email: 'unique@example.com' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('deletes comments and history together with their ticket (cascade)', async () => {
    const customer = await createCustomer(app);
    const ticket = await createTicket(app, customer.id);
    await request(app.getHttpServer())
      .post(`/tickets/${ticket.id}/comments`)
      .send({ body: 'bye', authorType: 'CUSTOMER' })
      .expect(201);

    await prisma.ticket.delete({ where: { id: ticket.id } });

    expect(await prisma.ticketComment.count({ where: { ticketId: ticket.id } })).toBe(0);
    expect(await prisma.ticketStatusHistory.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});
