import { Injectable } from '@nestjs/common';
import { Agent, Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AgentCreateInput): Promise<Agent> {
    return this.prisma.agent.create({ data });
  }

  findById(id: number): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<Agent | null> {
    return this.prisma.agent.findUnique({ where: { email } });
  }

  update(id: number, data: Prisma.AgentUpdateInput): Promise<Agent> {
    return this.prisma.agent.update({ where: { id }, data });
  }

  countTicketsByStatuses(agentId: number, statuses: TicketStatus[]): Promise<number> {
    return this.prisma.ticket.count({ where: { assigneeId: agentId, status: { in: statuses } } });
  }

  async list(
    where: Prisma.AgentWhereInput,
    orderBy: Prisma.AgentOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[Agent[], number]> {
    return this.prisma.$transaction([
      this.prisma.agent.findMany({ where, orderBy, skip, take }),
      this.prisma.agent.count({ where }),
    ]);
  }
}
