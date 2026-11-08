import { Injectable } from '@nestjs/common';
import { Agent, Prisma } from '@prisma/client';
import { ConflictException, ResourceNotFoundException } from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { OPEN_WORKLOAD_STATUSES } from '../tickets/ticket-workflow';
import { AgentsRepository } from './agents.repository';
import { CreateAgentDto } from './dto/create-agent.dto';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

export type AgentWithWorkload = Agent & { openTicketCount: number };

@Injectable()
export class AgentsService {
  constructor(private readonly agents: AgentsRepository) {}

  async create(dto: CreateAgentDto): Promise<Agent> {
    if (await this.agents.findByEmail(dto.email)) {
      throw new ConflictException(
        'AGENT_EMAIL_TAKEN',
        `An agent with e-mail ${dto.email} already exists`,
      );
    }
    return this.agents.create({ name: dto.name, email: dto.email });
  }

  async getById(id: number): Promise<AgentWithWorkload> {
    const agent = await this.getOrThrow(id);
    const openTicketCount = await this.agents.countTicketsByStatuses(id, OPEN_WORKLOAD_STATUSES);
    return { ...agent, openTicketCount };
  }

  async update(id: number, dto: UpdateAgentDto): Promise<Agent> {
    const agent = await this.getOrThrow(id);

    if (dto.active === false && agent.active) {
      const open = await this.agents.countTicketsByStatuses(id, OPEN_WORKLOAD_STATUSES);
      if (open > 0) {
        throw new ConflictException(
          'AGENT_HAS_OPEN_TICKETS',
          `Agent ${id} still has ${open} open ticket(s); reassign or resolve them before deactivating`,
          { openTicketCount: open },
        );
      }
    }
    return this.agents.update(id, { name: dto.name, active: dto.active });
  }

  async list(query: ListAgentsQueryDto): Promise<Paginated<Agent>> {
    const where: Prisma.AgentWhereInput = {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search } }, { email: { contains: query.search } }] }
        : {}),
    };
    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.agents.list(
      where,
      buildOrderBy(query.sortBy, query.sortOrder),
      skip,
      take,
    );
    return buildPage(items, total, query);
  }

  private async getOrThrow(id: number): Promise<Agent> {
    const agent = await this.agents.findById(id);
    if (!agent) throw new ResourceNotFoundException('Agent', id);
    return agent;
  }
}
