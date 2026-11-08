import { Agent, Customer, Ticket } from '@prisma/client';
import { AgentsRepository } from '../agents/agents.repository';
import { AppException } from '../common/exceptions/app.exceptions';
import { CustomersRepository } from '../customers/customers.repository';
import { TicketDetail, TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

const NOW = new Date('2026-01-01T00:00:00Z');

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 1,
  subject: 's',
  description: 'd',
  status: 'OPEN',
  priority: 'MEDIUM',
  customerId: 1,
  assigneeId: null,
  resolvedAt: null,
  closedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});
const agent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 7,
  name: 'A',
  email: 'a@x.example',
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

async function errorOf(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    return error as AppException;
  }
  throw new Error('Expected the promise to reject');
}

describe('TicketsService', () => {
  let tickets: jest.Mocked<TicketsRepository>;
  let customers: jest.Mocked<CustomersRepository>;
  let agents: jest.Mocked<AgentsRepository>;
  let service: TicketsService;

  beforeEach(() => {
    tickets = {
      createWithInitialHistory: jest.fn(),
      findById: jest.fn(),
      findDetailById: jest.fn(),
      list: jest.fn(),
      updateIf: jest.fn(),
      applyStatusTransition: jest.fn(),
    } as unknown as jest.Mocked<TicketsRepository>;
    customers = { findById: jest.fn() } as unknown as jest.Mocked<CustomersRepository>;
    agents = { findById: jest.fn() } as unknown as jest.Mocked<AgentsRepository>;
    service = new TicketsService(tickets, customers, agents);
    tickets.findDetailById.mockImplementation(async (id) => ({ id }) as unknown as TicketDetail);
  });

  describe('create', () => {
    it('rejects an unknown customer without writing anything', async () => {
      customers.findById.mockResolvedValue(null);
      const error = await errorOf(
        service.create({ customerId: 5, subject: 's', description: 'd' }),
      );
      expect(error.code).toBe('CUSTOMER_NOT_FOUND');
      expect(error.getStatus()).toBe(404);
      expect(tickets.createWithInitialHistory).not.toHaveBeenCalled();
    });

    it('creates the ticket for an existing customer', async () => {
      customers.findById.mockResolvedValue({ id: 5 } as Customer);
      tickets.createWithInitialHistory.mockResolvedValue(ticket({ id: 42 }));
      await service.create({ customerId: 5, subject: 's', description: 'd', priority: 'HIGH' });
      expect(tickets.createWithInitialHistory).toHaveBeenCalledWith({
        customerId: 5,
        subject: 's',
        description: 'd',
        priority: 'HIGH',
      });
      expect(tickets.findDetailById).toHaveBeenCalledWith(42);
    });
  });

  describe('assign', () => {
    it('404s for an unknown ticket', async () => {
      tickets.findById.mockResolvedValue(null);
      expect((await errorOf(service.assign(1, { agentId: 7 }))).code).toBe('TICKET_NOT_FOUND');
    });

    it('409s for a closed ticket', async () => {
      tickets.findById.mockResolvedValue(ticket({ status: 'CLOSED' }));
      const error = await errorOf(service.assign(1, { agentId: 7 }));
      expect(error.code).toBe('TICKET_CLOSED');
      expect(error.getStatus()).toBe(409);
    });

    it('404s for an unknown agent and 422s for an inactive one', async () => {
      tickets.findById.mockResolvedValue(ticket());
      agents.findById.mockResolvedValueOnce(null);
      expect((await errorOf(service.assign(1, { agentId: 7 }))).code).toBe('AGENT_NOT_FOUND');

      agents.findById.mockResolvedValueOnce(agent({ active: false }));
      const inactive = await errorOf(service.assign(1, { agentId: 7 }));
      expect(inactive.code).toBe('AGENT_INACTIVE');
      expect(inactive.getStatus()).toBe(422);
      expect(tickets.updateIf).not.toHaveBeenCalled();
    });

    it('does not write when the agent is already the assignee', async () => {
      tickets.findById.mockResolvedValue(ticket({ assigneeId: 7 }));
      agents.findById.mockResolvedValue(agent());
      await service.assign(1, { agentId: 7 });
      expect(tickets.updateIf).not.toHaveBeenCalled();
    });

    it('reports a concurrent modification when the guarded update loses the race', async () => {
      tickets.findById.mockResolvedValue(ticket());
      agents.findById.mockResolvedValue(agent());
      tickets.updateIf.mockResolvedValue(false);
      expect((await errorOf(service.assign(1, { agentId: 7 }))).code).toBe(
        'CONCURRENT_MODIFICATION',
      );
    });
  });

  describe('unassign', () => {
    it('is a no-op for an unassigned ticket', async () => {
      tickets.findById.mockResolvedValue(ticket());
      await service.unassign(1);
      expect(tickets.updateIf).not.toHaveBeenCalled();
    });

    it.each(['IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'] as const)(
      'refuses when the ticket is %s',
      async (status) => {
        tickets.findById.mockResolvedValue(ticket({ status, assigneeId: 7 }));
        expect((await errorOf(service.unassign(1))).code).toBe('TICKET_UNASSIGN_NOT_ALLOWED');
      },
    );

    it('clears the assignee of an OPEN ticket with a status guard', async () => {
      tickets.findById.mockResolvedValue(ticket({ assigneeId: 7 }));
      tickets.updateIf.mockResolvedValue(true);
      await service.unassign(1);
      expect(tickets.updateIf).toHaveBeenCalledWith(1, { status: 'OPEN' }, { assigneeId: null });
    });
  });

  describe('updatePriority', () => {
    it('refuses closed tickets', async () => {
      tickets.findById.mockResolvedValue(ticket({ status: 'CLOSED' }));
      expect((await errorOf(service.updatePriority(1, { priority: 'LOW' }))).code).toBe(
        'TICKET_CLOSED',
      );
    });

    it('skips the write when the priority is unchanged', async () => {
      tickets.findById.mockResolvedValue(ticket({ priority: 'HIGH' }));
      await service.updatePriority(1, { priority: 'HIGH' });
      expect(tickets.updateIf).not.toHaveBeenCalled();
    });

    it('updates a changed priority', async () => {
      tickets.findById.mockResolvedValue(ticket());
      tickets.updateIf.mockResolvedValue(true);
      await service.updatePriority(1, { priority: 'URGENT' });
      expect(tickets.updateIf).toHaveBeenCalledWith(
        1,
        { status: { not: 'CLOSED' } },
        { priority: 'URGENT' },
      );
    });
  });

  describe('changeStatus', () => {
    it('rejects an invalid transition and exposes the allowed targets', async () => {
      tickets.findById.mockResolvedValue(ticket({ status: 'OPEN', assigneeId: 7 }));
      const error = await errorOf(service.changeStatus(1, { status: 'RESOLVED' }));
      expect(error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(error.getStatus()).toBe(409);
      expect(error.details).toEqual({
        from: 'OPEN',
        to: 'RESOLVED',
        allowed: ['IN_PROGRESS', 'CLOSED'],
      });
      expect(tickets.applyStatusTransition).not.toHaveBeenCalled();
    });

    it('explains a no-op transition', async () => {
      tickets.findById.mockResolvedValue(ticket({ status: 'OPEN' }));
      const error = await errorOf(service.changeStatus(1, { status: 'OPEN' }));
      expect(error.message).toContain('already OPEN');
    });

    it('requires an assignee for IN_PROGRESS', async () => {
      tickets.findById.mockResolvedValue(ticket());
      expect((await errorOf(service.changeStatus(1, { status: 'IN_PROGRESS' }))).code).toBe(
        'ASSIGNEE_REQUIRED',
      );
    });

    it('validates the acting agent', async () => {
      tickets.findById.mockResolvedValue(ticket({ assigneeId: 7 }));
      agents.findById.mockResolvedValueOnce(null);
      const missing = await errorOf(
        service.changeStatus(1, { status: 'IN_PROGRESS', changedByAgentId: 9 }),
      );
      expect(missing.code).toBe('AGENT_NOT_FOUND');
      agents.findById.mockResolvedValueOnce(agent({ active: false }));
      const inactive = await errorOf(
        service.changeStatus(1, { status: 'IN_PROGRESS', changedByAgentId: 9 }),
      );
      expect(inactive.code).toBe('AGENT_INACTIVE');
    });

    it('applies a valid transition with the state it was validated against', async () => {
      tickets.findById.mockResolvedValue(ticket({ assigneeId: 7 }));
      tickets.applyStatusTransition.mockResolvedValue(true);
      await service.changeStatus(1, { status: 'IN_PROGRESS', note: 'go' });
      expect(tickets.applyStatusTransition).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          expected: { status: 'OPEN', assigneeId: 7 },
          to: 'IN_PROGRESS',
          note: 'go',
        }),
      );
    });

    it('reports a concurrent modification when the guarded write loses the race', async () => {
      tickets.findById.mockResolvedValue(ticket({ assigneeId: 7 }));
      tickets.applyStatusTransition.mockResolvedValue(false);
      const error = await errorOf(service.changeStatus(1, { status: 'IN_PROGRESS' }));
      expect(error.code).toBe('CONCURRENT_MODIFICATION');
      expect(error.getStatus()).toBe(409);
    });
  });

  describe('list', () => {
    it('rejects unassigned=true combined with assigneeId', async () => {
      const error = await errorOf(
        service.list({
          page: 1,
          pageSize: 20,
          sortOrder: 'desc',
          sortBy: 'createdAt',
          unassigned: true,
          assigneeId: 3,
        }),
      );
      expect(error.getStatus()).toBe(400);
    });

    it('translates filters into a where clause and a deterministic order', async () => {
      tickets.list.mockResolvedValue([[], 0]);
      await service.list({
        page: 3,
        pageSize: 10,
        sortOrder: 'asc',
        sortBy: 'updatedAt',
        status: 'OPEN',
        priority: 'HIGH',
        customerId: 2,
        unassigned: true,
      });
      expect(tickets.list).toHaveBeenCalledWith(
        { status: 'OPEN', priority: 'HIGH', customerId: 2, assigneeId: null },
        [{ updatedAt: 'asc' }, { id: 'asc' }],
        20,
        10,
      );
    });
  });
});
