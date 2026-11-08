import { Customer } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

const NOW = new Date('2026-01-01T00:00:00Z');
const customer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 1,
  name: 'C',
  email: 'c@x.example',
  company: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('CustomersService', () => {
  let repo: jest.Mocked<CustomersRepository>;
  let service: CustomersService;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<CustomersRepository>;
    service = new CustomersService(repo);
  });

  it('creates a customer and stores a missing company as null', async () => {
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockResolvedValue(customer());
    await service.create({ name: 'C', email: 'c@x.example' });
    expect(repo.create).toHaveBeenCalledWith({ name: 'C', email: 'c@x.example', company: null });
  });

  it('rejects duplicate e-mails with a 409', async () => {
    repo.findByEmail.mockResolvedValue(customer());
    await expect(service.create({ name: 'C', email: 'c@x.example' })).rejects.toMatchObject({
      code: 'CUSTOMER_EMAIL_TAKEN',
      status: 409,
    });
  });

  it('throws 404 for an unknown customer', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.getById(3)).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_FOUND',
      status: 404,
    });
  });

  it('builds page metadata from the repository total', async () => {
    repo.list.mockResolvedValue([[customer()], 41]);
    const page = await service.list({
      page: 2,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(page.meta).toEqual({ page: 2, pageSize: 20, total: 41, totalPages: 3 });
    expect(repo.list).toHaveBeenCalledWith({}, [{ createdAt: 'desc' }, { id: 'desc' }], 20, 20);
  });
});
