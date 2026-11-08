import { Injectable } from '@nestjs/common';
import { CommentAuthorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const AGENT_SUMMARY = { select: { id: true, name: true, email: true } } as const;
const COMMENT_INCLUDE = { agent: AGENT_SUMMARY } satisfies Prisma.TicketCommentInclude;

export type CommentWithAgent = Prisma.TicketCommentGetPayload<{ include: typeof COMMENT_INCLUDE }>;

@Injectable()
export class CommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    ticketId: number;
    authorType: CommentAuthorType;
    agentId: number | null;
    body: string;
  }): Promise<CommentWithAgent> {
    return this.prisma.ticketComment.create({ data, include: COMMENT_INCLUDE });
  }

  async listForTicket(
    ticketId: number,
    orderBy: Prisma.TicketCommentOrderByWithRelationInput[],
    skip: number,
    take: number,
  ): Promise<[CommentWithAgent[], number]> {
    return this.prisma.$transaction([
      this.prisma.ticketComment.findMany({
        where: { ticketId },
        orderBy,
        skip,
        take,
        include: COMMENT_INCLUDE,
      }),
      this.prisma.ticketComment.count({ where: { ticketId } }),
    ]);
  }
}
