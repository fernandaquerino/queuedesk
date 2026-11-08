import { Injectable } from '@nestjs/common';
import { Prisma, Ticket, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PERSON_SUMMARY = { select: { id: true, name: true, email: true } } as const;

const LIST_INCLUDE = {
  customer: PERSON_SUMMARY,
  assignee: PERSON_SUMMARY,
} satisfies Prisma.TicketInclude;

const DETAIL_INCLUDE = {
  customer: PERSON_SUMMARY,
  assignee: PERSON_SUMMARY,
  comments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { agent: PERSON_SUMMARY },
  },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { changedBy: PERSON_SUMMARY },
  },
} satisfies Prisma.TicketInclude;

export type TicketListItem = Prisma.TicketGetPayload<{ include: typeof LIST_INCLUDE }>;
export type TicketDetail = Prisma.TicketGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export interface StatusTransition {
  /** The state the caller based its decision on; the write is rejected if it changed meanwhile. */
  expected: { status: TicketStatus; assigneeId: number | null };
  to: TicketStatus;
  note?: string;
  changedByAgentId?: number;
  now: Date;
}

@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the ticket and its first history entry (null -> OPEN) atomically. */
  createWithInitialHistory(data: {
    customerId: number;
    subject: string;
    description: string;
    priority?: Prisma.TicketCreateInput['priority'];
  }): Promise<Ticket> {
    return this.prisma.ticket.create({
      data: {
        ...data,
        statusHistory: { create: { fromStatus: null, toStatus: 'OPEN', note: 'Ticket created' } },
      },
    });
  }

  findById(id: number): Promise<Ticket | null> {
    return this.prisma.ticket.findUnique({ where: { id } });
  }

  findDetailById(id: number): Promise<TicketDetail | null> {
    return this.prisma.ticket.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  async list(
    where: Prisma.TicketWhereInput,
    orderBy: Prisma.TicketOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[TicketListItem[], number]> {
    return this.prisma.$transaction([
      this.prisma.ticket.findMany({ where, orderBy, skip, take, include: LIST_INCLUDE }),
      this.prisma.ticket.count({ where }),
    ]);
  }

  /**
   * Conditional update ("compare and set"): applies `data` only if the row still matches `guard`.
   * Returns false when another request changed the ticket first.
   */
  async updateIf(
    id: number,
    guard: Prisma.TicketWhereInput,
    data: Prisma.TicketUncheckedUpdateManyInput,
  ): Promise<boolean> {
    const { count } = await this.prisma.ticket.updateMany({ where: { id, ...guard }, data });
    return count === 1;
  }

  /** Moves the ticket to a new status and appends the history row in one transaction. */
  async applyStatusTransition(id: number, t: StatusTransition): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id, status: t.expected.status, assigneeId: t.expected.assigneeId },
        data: {
          status: t.to,
          ...(t.to === 'RESOLVED' ? { resolvedAt: t.now } : {}),
          // Re-opening a resolved ticket clears the resolution timestamp.
          ...(t.expected.status === 'RESOLVED' && t.to === 'IN_PROGRESS'
            ? { resolvedAt: null }
            : {}),
          ...(t.to === 'CLOSED' ? { closedAt: t.now } : {}),
        },
      });
      if (count !== 1) return false;
      await tx.ticketStatusHistory.create({
        data: {
          ticketId: id,
          fromStatus: t.expected.status,
          toStatus: t.to,
          note: t.note ?? null,
          changedByAgentId: t.changedByAgentId ?? null,
          createdAt: t.now,
        },
      });
      return true;
    });
  }
}
