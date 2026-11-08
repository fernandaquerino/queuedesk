import { Agent } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exceptions';
import { AgentsRepository } from './agents.repository';
import { AgentsService } from './agents.service';

const NOW = new Date('2026-01-01T00:00:00Z');
const agent = (overrides: Partial<Agent> = {}): Agent => ({
  id: 1,
  name: 'A',
  email: 'a@x.example',
  active: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('AgentsService', () => {
  let repo: jest.Mocked<AgentsRepository>;
  let service: AgentsService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      update: jest.fn(),
      countTicketsByStatuses: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<AgentsRepository>;
    service = new AgentsService(repo);
  });

  it('rejects a duplicate e-mail', async () => {
    repo.findByEmail.mockResolvedValue(agent());
    await expect(service.create({ name: 'B', email: 'a@x.example' })).rejects.toMatchObject({
      code: 'AGENT_EMAIL_TAKEN',
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('404s for unknown agents', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.getById(1)).rejects.toBeInstanceOf(AppException);
    await expect(service.update(1, { active: false })).rejects.toMatchObject({
      code: 'AGENT_NOT_FOUND',
    });
  });

  it('blocks deactivation while the agent has open tickets', async () => {
    repo.findById.mockResolvedValue(agent());
    repo.countTicketsByStatuses.mockResolvedValue(3);
    await expect(service.update(1, { active: false })).rejects.toMatchObject({
      code: 'AGENT_HAS_OPEN_TICKETS',
      details: { openTicketCount: 3 },
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('deactivates an agent without open tickets', async () => {
    repo.findById.mockResolvedValue(agent());
    repo.countTicketsByStatuses.mockResolvedValue(0);
    repo.update.mockResolvedValue(agent({ active: false }));
    await service.update(1, { active: false });
    expect(repo.update).toHaveBeenCalledWith(1, { name: undefined, active: false });
  });

  it('does not check workload when renaming or reactivating', async () => {
    repo.findById.mockResolvedValue(agent({ active: false }));
    repo.update.mockResolvedValue(agent());
    await service.update(1, { active: true, name: 'New' });
    expect(repo.countTicketsByStatuses).not.toHaveBeenCalled();
  });

  it('reports the open-ticket count in agent details', async () => {
    repo.findById.mockResolvedValue(agent());
    repo.countTicketsByStatuses.mockResolvedValue(2);
    await expect(service.getById(1)).resolves.toMatchObject({ id: 1, openTicketCount: 2 });
    expect(repo.countTicketsByStatuses).toHaveBeenCalledWith(1, [
      'OPEN',
      'IN_PROGRESS',
      'WAITING_ON_CUSTOMER',
    ]);
  });

  it('filters lists by the active flag and searches name or e-mail', async () => {
    repo.list.mockResolvedValue([[], 0]);
    await service.list({
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
      active: false,
      search: 'pri',
    });
    expect(repo.list).toHaveBeenCalledWith(
      { active: false, OR: [{ name: { contains: 'pri' } }, { email: { contains: 'pri' } }] },
      [{ name: 'asc' }, { id: 'asc' }],
      0,
      20,
    );
  });
});
