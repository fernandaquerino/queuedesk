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

describe('Tickets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: { id: number };
  let agent: { id: number };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    customer = await createCustomer(app);
    agent = await createAgent(app);
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  describe('creation and validation', () => {
    it('creates an OPEN, unassigned ticket with MEDIUM priority and an initial history entry', async () => {
      const ticket = await createTicket(app, customer.id, { subject: '  Login broken  ' });

      expect(ticket).toMatchObject({
        subject: 'Login broken',
        status: 'OPEN',
        priority: 'MEDIUM',
        assigneeId: null,
        customerId: customer.id,
        comments: [],
      });
      expect(ticket.statusHistory).toHaveLength(1);
      expect(ticket.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: 'OPEN' });
    });

    it('honours an explicit priority', async () => {
      const ticket = await createTicket(app, customer.id, { priority: 'URGENT' });
      expect(ticket.priority).toBe('URGENT');
    });

    it('returns 404 when the customer does not exist', async () => {
      const res = await http()
        .post('/tickets')
        .send({ customerId: 9999, subject: 'x', description: 'y' })
        .expect(404);
      expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it.each([
      ['missing subject', { description: 'd' }],
      ['empty description', { subject: 's', description: '' }],
      ['subject too long', { subject: 's'.repeat(201), description: 'd' }],
      ['invalid priority', { subject: 's', description: 'd', priority: 'SUPER' }],
      ['string customerId', { customerId: '1', subject: 's', description: 'd' }],
      ['client-supplied status', { subject: 's', description: 'd', status: 'CLOSED' }],
    ])('rejects %s with 400', async (_label, overrides) => {
      const res = await http()
        .post('/tickets')
        .send({ customerId: customer.id, ...overrides })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects explicit nulls for optional fields with 400 (never 500)', async () => {
      const base = { customerId: customer.id, subject: 's', description: 'd' };
      await http()
        .post('/tickets')
        .send({ ...base, priority: null })
        .expect(400);

      const ticket = await createTicket(app, customer.id);
      await changeStatus(app, ticket.id, 'CLOSED', { changedByAgentId: null }).expect(400);
      await changeStatus(app, ticket.id, 'CLOSED', { note: null }).expect(400);
      await http()
        .post('/customers')
        .send({ name: 'n', email: 'n@x.example', company: null })
        .expect(400);
    });

    it('returns 404 for an unknown ticket id', async () => {
      const res = await http().get('/tickets/12345').expect(404);
      expect(res.body.code).toBe('TICKET_NOT_FOUND');
    });
  });

  describe('assignment', () => {
    it('assigns, reassigns and unassigns an OPEN ticket', async () => {
      const other = await createAgent(app);
      const ticket = await createTicket(app, customer.id);

      const first = await assign(app, ticket.id, agent.id).expect(200);
      expect(first.body.assignee).toMatchObject({ id: agent.id });
      expect(first.body.status).toBe('OPEN'); // assigning does not change the status

      const second = await assign(app, ticket.id, other.id).expect(200);
      expect(second.body.assigneeId).toBe(other.id);

      const cleared = await http().delete(`/tickets/${ticket.id}/assignee`).expect(200);
      expect(cleared.body.assigneeId).toBeNull();
      expect(cleared.body.assignee).toBeNull();
    });

    it('is idempotent when assigning the same agent twice', async () => {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);
      const again = await assign(app, ticket.id, agent.id).expect(200);
      expect(again.body.assigneeId).toBe(agent.id);
    });

    it('returns 404 for unknown ticket or agent and 422 for an inactive agent', async () => {
      const ticket = await createTicket(app, customer.id);
      const missingAgent = await assign(app, ticket.id, 9999).expect(404);
      expect(missingAgent.body.code).toBe('AGENT_NOT_FOUND');
      await assign(app, 9999, agent.id).expect(404);

      await http().patch(`/agents/${agent.id}`).send({ active: false }).expect(200);
      const inactive = await assign(app, ticket.id, agent.id).expect(422);
      expect(inactive.body.code).toBe('AGENT_INACTIVE');
    });

    it('validates the request body', async () => {
      const ticket = await createTicket(app, customer.id);
      await http().put(`/tickets/${ticket.id}/assignee`).send({}).expect(400);
      await http().put(`/tickets/${ticket.id}/assignee`).send({ agentId: 'abc' }).expect(400);
    });

    it('refuses to unassign a ticket that is already being worked on', async () => {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);
      await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);

      const res = await http().delete(`/tickets/${ticket.id}/assignee`).expect(409);
      expect(res.body.code).toBe('TICKET_UNASSIGN_NOT_ALLOWED');
      const still = await http().get(`/tickets/${ticket.id}`).expect(200);
      expect(still.body.assigneeId).toBe(agent.id);
    });

    it('refuses to assign a closed ticket', async () => {
      const ticket = await createTicket(app, customer.id);
      await changeStatus(app, ticket.id, 'CLOSED').expect(200);
      const res = await assign(app, ticket.id, agent.id).expect(409);
      expect(res.body.code).toBe('TICKET_CLOSED');
    });
  });

  describe('priority', () => {
    it('updates the priority', async () => {
      const ticket = await createTicket(app, customer.id);
      const res = await http()
        .patch(`/tickets/${ticket.id}/priority`)
        .send({ priority: 'HIGH' })
        .expect(200);
      expect(res.body.priority).toBe('HIGH');
    });

    it('rejects invalid priorities, unknown tickets and closed tickets', async () => {
      const ticket = await createTicket(app, customer.id);
      await http().patch(`/tickets/${ticket.id}/priority`).send({ priority: 'MEGA' }).expect(400);
      await http().patch('/tickets/9999/priority').send({ priority: 'LOW' }).expect(404);

      await changeStatus(app, ticket.id, 'CLOSED').expect(200);
      const res = await http()
        .patch(`/tickets/${ticket.id}/priority`)
        .send({ priority: 'LOW' })
        .expect(409);
      expect(res.body.code).toBe('TICKET_CLOSED');
    });
  });

  describe('status workflow', () => {
    it('walks the happy path and records every change in the history', async () => {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);

      await changeStatus(app, ticket.id, 'IN_PROGRESS', {
        changedByAgentId: agent.id,
        note: 'On it',
      }).expect(200);
      await changeStatus(app, ticket.id, 'WAITING_ON_CUSTOMER').expect(200);
      await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);
      await changeStatus(app, ticket.id, 'RESOLVED').expect(200);
      const closed = await changeStatus(app, ticket.id, 'CLOSED').expect(200);

      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.resolvedAt).not.toBeNull();
      expect(closed.body.closedAt).not.toBeNull();
      const transitions = closed.body.statusHistory.map(
        (h: { fromStatus: string | null; toStatus: string }) => `${h.fromStatus}>${h.toStatus}`,
      );
      expect(transitions).toEqual([
        'null>OPEN',
        'OPEN>IN_PROGRESS',
        'IN_PROGRESS>WAITING_ON_CUSTOMER',
        'WAITING_ON_CUSTOMER>IN_PROGRESS',
        'IN_PROGRESS>RESOLVED',
        'RESOLVED>CLOSED',
      ]);
      expect(closed.body.statusHistory[1]).toMatchObject({
        note: 'On it',
        changedBy: { id: agent.id },
      });
    });

    it('clears resolvedAt when a resolved ticket is reopened', async () => {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);
      await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);
      const resolved = await changeStatus(app, ticket.id, 'RESOLVED').expect(200);
      expect(resolved.body.resolvedAt).not.toBeNull();

      const reopened = await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(200);
      expect(reopened.body.resolvedAt).toBeNull();
    });

    it.each([
      ['OPEN', 'RESOLVED'],
      ['OPEN', 'WAITING_ON_CUSTOMER'],
      ['OPEN', 'OPEN'],
    ])(
      'rejects the invalid transition %s -> %s with 409 and lists allowed targets',
      async (from, to) => {
        const ticket = await createTicket(app, customer.id);
        await assign(app, ticket.id, agent.id).expect(200);
        expect(ticket.status).toBe(from);

        const res = await changeStatus(app, ticket.id, to).expect(409);
        expect(res.body).toMatchObject({
          code: 'INVALID_STATUS_TRANSITION',
          details: { from, to, allowed: ['IN_PROGRESS', 'CLOSED'] },
        });
      },
    );

    it('treats CLOSED as terminal', async () => {
      const ticket = await createTicket(app, customer.id);
      await changeStatus(app, ticket.id, 'CLOSED').expect(200);
      const res = await changeStatus(app, ticket.id, 'OPEN').expect(409);
      expect(res.body.details.allowed).toEqual([]);
    });

    it('requires an assignee before work can start', async () => {
      const ticket = await createTicket(app, customer.id);
      const res = await changeStatus(app, ticket.id, 'IN_PROGRESS').expect(409);
      expect(res.body.code).toBe('ASSIGNEE_REQUIRED');

      const stillOpen = await http().get(`/tickets/${ticket.id}`).expect(200);
      expect(stillOpen.body.status).toBe('OPEN');
      expect(stillOpen.body.statusHistory).toHaveLength(1); // failed change left no trace
    });

    it('allows closing an unassigned OPEN ticket (e.g. spam or duplicate)', async () => {
      const ticket = await createTicket(app, customer.id);
      const res = await changeStatus(app, ticket.id, 'CLOSED', { note: 'Duplicate' }).expect(200);
      expect(res.body.status).toBe('CLOSED');
    });

    it('validates the body and the acting agent', async () => {
      const ticket = await createTicket(app, customer.id);
      await assign(app, ticket.id, agent.id).expect(200);

      await changeStatus(app, ticket.id, 'DONE').expect(400);
      await http().post(`/tickets/${ticket.id}/status`).send({}).expect(400);
      const unknown = await changeStatus(app, ticket.id, 'IN_PROGRESS', {
        changedByAgentId: 9999,
      }).expect(404);
      expect(unknown.body.code).toBe('AGENT_NOT_FOUND');
      await changeStatus(app, 9999, 'CLOSED').expect(404);

      const unchanged = await http().get(`/tickets/${ticket.id}`).expect(200);
      expect(unchanged.body.status).toBe('OPEN');
    });
  });

  describe('comments', () => {
    it('adds customer and agent comments, shown in ticket details in order', async () => {
      const ticket = await createTicket(app, customer.id);

      await http()
        .post(`/tickets/${ticket.id}/comments`)
        .send({ body: 'Any update?', authorType: 'CUSTOMER' })
        .expect(201);
      const agentComment = await http()
        .post(`/tickets/${ticket.id}/comments`)
        .send({ body: '  Looking into it.  ', authorType: 'AGENT', agentId: agent.id })
        .expect(201);
      expect(agentComment.body).toMatchObject({
        body: 'Looking into it.',
        authorType: 'AGENT',
        agent: { id: agent.id },
      });

      const detail = await http().get(`/tickets/${ticket.id}`).expect(200);
      expect(detail.body.comments.map((c: { body: string }) => c.body)).toEqual([
        'Any update?',
        'Looking into it.',
      ]);

      const list = await http().get(`/tickets/${ticket.id}/comments?sortOrder=desc`).expect(200);
      expect(list.body.data[0].body).toBe('Looking into it.');
      expect(list.body.meta.total).toBe(2);
    });

    it('validates comments: author rules, empty body, unknown ticket/agent', async () => {
      const ticket = await createTicket(app, customer.id);
      const url = `/tickets/${ticket.id}/comments`;

      await http().post(url).send({ body: '', authorType: 'CUSTOMER' }).expect(400);
      await http().post(url).send({ body: 'x', authorType: 'ROBOT' }).expect(400);
      const noAgent = await http().post(url).send({ body: 'x', authorType: 'AGENT' }).expect(400);
      expect(noAgent.body.details[0].field).toBe('agentId');
      const customerWithAgent = await http()
        .post(url)
        .send({ body: 'x', authorType: 'CUSTOMER', agentId: agent.id })
        .expect(400);
      expect(customerWithAgent.body.details[0].field).toBe('agentId');

      await http().post(url).send({ body: 'x', authorType: 'AGENT', agentId: 9999 }).expect(404);
      await http()
        .post('/tickets/9999/comments')
        .send({ body: 'x', authorType: 'CUSTOMER' })
        .expect(404);
      await http().get('/tickets/9999/comments').expect(404);

      await http().patch(`/agents/${agent.id}`).send({ active: false }).expect(200);
      const inactive = await http()
        .post(url)
        .send({ body: 'x', authorType: 'AGENT', agentId: agent.id })
        .expect(422);
      expect(inactive.body.code).toBe('AGENT_INACTIVE');
    });

    it('does not accept comments on a closed ticket', async () => {
      const ticket = await createTicket(app, customer.id);
      await changeStatus(app, ticket.id, 'CLOSED').expect(200);
      const res = await http()
        .post(`/tickets/${ticket.id}/comments`)
        .send({ body: 'late', authorType: 'CUSTOMER' })
        .expect(409);
      expect(res.body.code).toBe('TICKET_CLOSED');
    });
  });

  describe('listing, filtering, pagination and sorting', () => {
    let other: { id: number };
    let agent2: { id: number };

    beforeEach(async () => {
      other = await createCustomer(app);
      agent2 = await createAgent(app);

      // customer: LOW open unassigned, HIGH in progress (agent), URGENT resolved (agent2)
      await createTicket(app, customer.id, { subject: 'A', priority: 'LOW' });
      const b = await createTicket(app, customer.id, { subject: 'B', priority: 'HIGH' });
      await assign(app, b.id, agent.id).expect(200);
      await changeStatus(app, b.id, 'IN_PROGRESS').expect(200);
      const c = await createTicket(app, customer.id, { subject: 'C', priority: 'URGENT' });
      await assign(app, c.id, agent2.id).expect(200);
      await changeStatus(app, c.id, 'IN_PROGRESS').expect(200);
      await changeStatus(app, c.id, 'RESOLVED').expect(200);
      // other: HIGH open unassigned
      await createTicket(app, other.id, { subject: 'D', priority: 'HIGH' });
    });

    const subjects = (body: { data: Array<{ subject: string }> }) =>
      body.data.map((t) => t.subject).sort();

    it('filters by status, priority, customer and assignee', async () => {
      expect(subjects((await http().get('/tickets?status=OPEN').expect(200)).body)).toEqual([
        'A',
        'D',
      ]);
      expect(subjects((await http().get('/tickets?priority=HIGH').expect(200)).body)).toEqual([
        'B',
        'D',
      ]);
      expect(
        subjects((await http().get(`/tickets?customerId=${other.id}`).expect(200)).body),
      ).toEqual(['D']);
      expect(
        subjects((await http().get(`/tickets?assigneeId=${agent2.id}`).expect(200)).body),
      ).toEqual(['C']);
      expect(subjects((await http().get('/tickets?unassigned=true').expect(200)).body)).toEqual([
        'A',
        'D',
      ]);
    });

    it('combines filters with AND semantics', async () => {
      const res = await http()
        .get(`/tickets?priority=HIGH&status=OPEN&customerId=${other.id}`)
        .expect(200);
      expect(subjects(res.body)).toEqual(['D']);
      expect(res.body.meta.total).toBe(1);

      const none = await http().get(`/tickets?priority=LOW&assigneeId=${agent.id}`).expect(200);
      expect(none.body.data).toEqual([]);
      expect(none.body.meta).toMatchObject({ total: 0, totalPages: 0 });
    });

    it('includes customer and assignee summaries but not comments in list items', async () => {
      const res = await http().get(`/tickets?assigneeId=${agent.id}`).expect(200);
      expect(res.body.data[0]).toMatchObject({
        subject: 'B',
        customer: { id: customer.id },
        assignee: { id: agent.id },
      });
      expect(res.body.data[0].comments).toBeUndefined();
    });

    it('rejects invalid filters', async () => {
      await http().get('/tickets?status=DONE').expect(400);
      await http().get('/tickets?priority=low').expect(400);
      await http().get('/tickets?customerId=abc').expect(400);
      await http().get(`/tickets?unassigned=true&assigneeId=${agent.id}`).expect(400);
    });

    it('sorts newest first by default, ties broken by id, and honours sortOrder', async () => {
      const desc = await http().get('/tickets').expect(200);
      expect(desc.body.data.map((t: { subject: string }) => t.subject)).toEqual([
        'D',
        'C',
        'B',
        'A',
      ]);
      const asc = await http().get('/tickets?sortOrder=asc').expect(200);
      expect(asc.body.data.map((t: { subject: string }) => t.subject)).toEqual([
        'A',
        'B',
        'C',
        'D',
      ]);
    });

    it('paginates without gaps or duplicates even when sort keys collide', async () => {
      // 25 tickets sharing exactly the same createdAt: only the id tie-breaker keeps pages stable.
      const sameInstant = new Date('2030-01-01T00:00:00.000Z');
      await prisma.ticket.createMany({
        data: Array.from({ length: 25 }, (_, i) => ({
          subject: `bulk-${i}`,
          description: 'bulk',
          customerId: customer.id,
          createdAt: sameInstant,
        })),
      });

      const seen: number[] = [];
      for (let page = 1; page <= 3; page++) {
        const res = await http()
          .get(
            `/tickets?sortBy=createdAt&sortOrder=asc&pageSize=10&page=${page}&status=OPEN&customerId=${customer.id}`,
          )
          .expect(200);
        expect(res.body.meta).toMatchObject({ page, pageSize: 10, total: 26, totalPages: 3 });
        seen.push(...res.body.data.map((t: { id: number }) => t.id));
      }
      expect(seen).toHaveLength(26);
      expect(new Set(seen).size).toBe(26);

      // Sorted by (createdAt asc, id asc): the 25 identical timestamps come last, ids ascending.
      const bulkIds = seen.slice(1);
      expect(bulkIds).toEqual([...bulkIds].sort((x, y) => x - y));
    });
  });
});
