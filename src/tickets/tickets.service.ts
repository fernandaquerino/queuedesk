import { Injectable } from '@nestjs/common';
import { Prisma, Ticket } from '@prisma/client';
import {
  ConflictException,
  InvalidRequestException,
  ResourceNotFoundException,
  UnprocessableException,
} from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { AgentsRepository } from '../agents/agents.repository';
import { CustomersRepository } from '../customers/customers.repository';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdatePriorityDto } from './dto/update-priority.dto';
import { ALLOWED_TRANSITIONS, canTransition, isClosed, requiresAssignee } from './ticket-workflow';
import { TicketDetail, TicketListItem, TicketsRepository } from './tickets.repository';

@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly customers: CustomersRepository,
    private readonly agents: AgentsRepository,
  ) {}

  async create(dto: CreateTicketDto): Promise<TicketDetail> {
    const customer = await this.customers.findById(dto.customerId);
    if (!customer) throw new ResourceNotFoundException('Customer', dto.customerId);

    const ticket = await this.tickets.createWithInitialHistory({
      customerId: customer.id,
      subject: dto.subject,
      description: dto.description,
      priority: dto.priority,
    });
    return this.getById(ticket.id);
  }

  async getById(id: number): Promise<TicketDetail> {
    const ticket = await this.tickets.findDetailById(id);
    if (!ticket) throw new ResourceNotFoundException('Ticket', id);
    return ticket;
  }

  async list(query: ListTicketsQueryDto): Promise<Paginated<TicketListItem>> {
    if (query.unassigned === true && query.assigneeId !== undefined) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'unassigned', messages: ['unassigned cannot be combined with assigneeId'] },
      ]);
    }
    const where: Prisma.TicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
      ...(query.assigneeId !== undefined ? { assigneeId: query.assigneeId } : {}),
      ...(query.unassigned === true ? { assigneeId: null } : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.tickets.list(
      where,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    return buildPage(items, total, query);
  }

  async assign(id: number, dto: AssignTicketDto): Promise<TicketDetail> {
    const ticket = await this.getOrThrow(id);
    this.assertNotClosed(ticket, 'assigned');

    const agent = await this.agents.findById(dto.agentId);
    if (!agent) throw new ResourceNotFoundException('Agent', dto.agentId);
    if (!agent.active) {
      throw new UnprocessableException('AGENT_INACTIVE', `Agent ${agent.id} is not active`);
    }

    if (ticket.assigneeId !== agent.id) {
      const updated = await this.tickets.updateIf(
        id,
        { status: { not: 'CLOSED' } },
        { assigneeId: agent.id },
      );
      if (!updated) throw concurrentModification(id);
    }
    return this.getById(id);
  }

  async unassign(id: number): Promise<TicketDetail> {
    const ticket = await this.getOrThrow(id);
    if (ticket.assigneeId === null) return this.getById(id);

    // Invariant: IN_PROGRESS / WAITING_ON_CUSTOMER / RESOLVED tickets always have an owner.
    if (ticket.status !== 'OPEN') {
      throw new ConflictException(
        'TICKET_UNASSIGN_NOT_ALLOWED',
        `Only OPEN tickets can be unassigned (ticket ${id} is ${ticket.status}); reassign it instead`,
        { status: ticket.status },
      );
    }
    const updated = await this.tickets.updateIf(id, { status: 'OPEN' }, { assigneeId: null });
    if (!updated) throw concurrentModification(id);
    return this.getById(id);
  }

  async updatePriority(id: number, dto: UpdatePriorityDto): Promise<TicketDetail> {
    const ticket = await this.getOrThrow(id);
    this.assertNotClosed(ticket, 'reprioritised');

    if (ticket.priority !== dto.priority) {
      const updated = await this.tickets.updateIf(
        id,
        { status: { not: 'CLOSED' } },
        { priority: dto.priority },
      );
      if (!updated) throw concurrentModification(id);
    }
    return this.getById(id);
  }

  async changeStatus(id: number, dto: ChangeStatusDto): Promise<TicketDetail> {
    const ticket = await this.getOrThrow(id);

    if (!canTransition(ticket.status, dto.status)) {
      throw new ConflictException(
        'INVALID_STATUS_TRANSITION',
        ticket.status === dto.status
          ? `Ticket ${id} is already ${ticket.status}`
          : `Cannot move ticket ${id} from ${ticket.status} to ${dto.status}`,
        { from: ticket.status, to: dto.status, allowed: ALLOWED_TRANSITIONS[ticket.status] },
      );
    }
    if (requiresAssignee(dto.status) && ticket.assigneeId === null) {
      throw new ConflictException(
        'ASSIGNEE_REQUIRED',
        `Ticket ${id} must be assigned to an agent before it can be ${dto.status}`,
        { to: dto.status },
      );
    }
    if (dto.changedByAgentId !== undefined) {
      const agent = await this.agents.findById(dto.changedByAgentId);
      if (!agent) throw new ResourceNotFoundException('Agent', dto.changedByAgentId);
      if (!agent.active) {
        throw new UnprocessableException('AGENT_INACTIVE', `Agent ${agent.id} is not active`);
      }
    }

    const applied = await this.tickets.applyStatusTransition(id, {
      expected: { status: ticket.status, assigneeId: ticket.assigneeId },
      to: dto.status,
      note: dto.note,
      changedByAgentId: dto.changedByAgentId,
      now: new Date(),
    });
    if (!applied) throw concurrentModification(id);
    return this.getById(id);
  }

  private async getOrThrow(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findById(id);
    if (!ticket) throw new ResourceNotFoundException('Ticket', id);
    return ticket;
  }

  private assertNotClosed(ticket: Ticket, action: string): void {
    if (isClosed(ticket.status)) {
      throw new ConflictException(
        'TICKET_CLOSED',
        `Ticket ${ticket.id} is closed and cannot be ${action}`,
      );
    }
  }
}

function concurrentModification(id: number): ConflictException {
  return new ConflictException(
    'CONCURRENT_MODIFICATION',
    `Ticket ${id} was modified by another request; reload it and retry`,
  );
}
