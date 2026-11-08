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

describe('Concurrent requests (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('lets exactly one of many racing status changes win; the others get a 409, never a 500', async () => {
    const customer = await createCustomer(app);
    const agent = await createAgent(app);

    // Several rounds: lock contention on SQLite is probabilistic, so one round can get lucky.
    for (let round = 0; round < 12; round++) {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);

      const responses = await Promise.all(
        Array.from({ length: 40 }, () => changeStatus(app, ticket.id, 'IN_PROGRESS')),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s >= 500)).toHaveLength(0);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(39);

      const detail = await request(app.getHttpServer()).get(`/tickets/${ticket.id}`).expect(200);
      expect(detail.body.status).toBe('IN_PROGRESS');
      expect(detail.body.statusHistory).toHaveLength(2); // creation + exactly one transition
    }
  });

  it('keeps unassign and start-work from corrupting the "IN_PROGRESS needs an assignee" invariant', async () => {
    const customer = await createCustomer(app);
    const agent = await createAgent(app);
    const ticket = await createTicket(app, customer.id);
    await assign(app, ticket.id, agent.id).expect(200);

    await Promise.all([
      request(app.getHttpServer()).delete(`/tickets/${ticket.id}/assignee`),
      changeStatus(app, ticket.id, 'IN_PROGRESS'),
    ]);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    // Whatever order the requests ran in, a ticket in progress must still have its owner.
    if (after.status === 'IN_PROGRESS') expect(after.assigneeId).not.toBeNull();
  });
});
