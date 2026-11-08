import { Agent, Ticket } from '@prisma/client';
import { AgentsRepository } from '../agents/agents.repository';
import { TicketsRepository } from '../tickets/tickets.repository';
import { CommentsRepository } from './comments.repository';
import { CommentsService } from './comments.service';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('CommentsService', () => {
  let comments: jest.Mocked<CommentsRepository>;
  let tickets: jest.Mocked<TicketsRepository>;
  let agents: jest.Mocked<AgentsRepository>;
  let service: CommentsService;

  const openTicket = { id: 1, status: 'OPEN' } as Ticket;
  const activeAgent = { id: 7, active: true, createdAt: NOW } as Agent;

  beforeEach(() => {
    comments = {
      create: jest.fn(),
      listForTicket: jest.fn(),
    } as unknown as jest.Mocked<CommentsRepository>;
    tickets = { findById: jest.fn() } as unknown as jest.Mocked<TicketsRepository>;
    agents = { findById: jest.fn() } as unknown as jest.Mocked<AgentsRepository>;
    service = new CommentsService(comments, tickets, agents);
  });

  it('404s when the ticket does not exist', async () => {
    tickets.findById.mockResolvedValue(null);
    await expect(service.create(1, { body: 'x', authorType: 'CUSTOMER' })).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
    await expect(
      service.list(1, { page: 1, pageSize: 50, sortOrder: 'asc' }),
    ).rejects.toMatchObject({
      code: 'TICKET_NOT_FOUND',
    });
  });

  it('refuses comments on closed tickets', async () => {
    tickets.findById.mockResolvedValue({ id: 1, status: 'CLOSED' } as Ticket);
    await expect(service.create(1, { body: 'x', authorType: 'CUSTOMER' })).rejects.toMatchObject({
      code: 'TICKET_CLOSED',
      status: 409,
    });
    expect(comments.create).not.toHaveBeenCalled();
  });

  it('stores customer comments without an agent', async () => {
    tickets.findById.mockResolvedValue(openTicket);
    await service.create(1, { body: 'hello', authorType: 'CUSTOMER' });
    expect(comments.create).toHaveBeenCalledWith({
      ticketId: 1,
      authorType: 'CUSTOMER',
      agentId: null,
      body: 'hello',
    });
  });

  it('rejects an agentId on customer comments', async () => {
    tickets.findById.mockResolvedValue(openTicket);
    await expect(
      service.create(1, { body: 'hello', authorType: 'CUSTOMER', agentId: 7 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires an existing, active agent for agent comments', async () => {
    tickets.findById.mockResolvedValue(openTicket);
    agents.findById.mockResolvedValueOnce(null);
    await expect(
      service.create(1, { body: 'x', authorType: 'AGENT', agentId: 7 }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });

    agents.findById.mockResolvedValueOnce({ ...activeAgent, active: false });
    await expect(
      service.create(1, { body: 'x', authorType: 'AGENT', agentId: 7 }),
    ).rejects.toMatchObject({ code: 'AGENT_INACTIVE', status: 422 });

    agents.findById.mockResolvedValueOnce(activeAgent);
    await service.create(1, { body: 'x', authorType: 'AGENT', agentId: 7 });
    expect(comments.create).toHaveBeenCalledWith(expect.objectContaining({ agentId: 7 }));
  });
});
