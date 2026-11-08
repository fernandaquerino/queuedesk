import { Injectable } from '@nestjs/common';
import {
  ConflictException,
  InvalidRequestException,
  ResourceNotFoundException,
  UnprocessableException,
} from '../common/exceptions/app.exceptions';
import { buildOrderBy, buildPage, Paginated, toSkipTake } from '../common/pagination/paginate';
import { AgentsRepository } from '../agents/agents.repository';
import { TicketsRepository } from '../tickets/tickets.repository';
import { CommentsRepository, CommentWithAgent } from './comments.repository';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';

@Injectable()
export class CommentsService {
  constructor(
    private readonly comments: CommentsRepository,
    private readonly tickets: TicketsRepository,
    private readonly agents: AgentsRepository,
  ) {}

  async create(ticketId: number, dto: CreateCommentDto): Promise<CommentWithAgent> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) throw new ResourceNotFoundException('Ticket', ticketId);
    if (ticket.status === 'CLOSED') {
      throw new ConflictException(
        'TICKET_CLOSED',
        `Ticket ${ticketId} is closed and does not accept new comments`,
      );
    }

    let agentId: number | null = null;
    if (dto.authorType === 'AGENT') {
      // class-validator guarantees agentId is a valid integer for AGENT comments.
      const agent = await this.agents.findById(dto.agentId as number);
      if (!agent) throw new ResourceNotFoundException('Agent', dto.agentId as number);
      if (!agent.active) {
        throw new UnprocessableException('AGENT_INACTIVE', `Agent ${agent.id} is not active`);
      }
      agentId = agent.id;
    } else if (dto.agentId !== undefined) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'agentId', messages: ['agentId must not be provided for CUSTOMER comments'] },
      ]);
    }

    return this.comments.create({
      ticketId,
      authorType: dto.authorType,
      agentId,
      body: dto.body,
    });
  }

  async list(ticketId: number, query: ListCommentsQueryDto): Promise<Paginated<CommentWithAgent>> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) throw new ResourceNotFoundException('Ticket', ticketId);

    const { skip, take } = toSkipTake(query);
    const [items, total] = await this.comments.listForTicket(
      ticketId,
      buildOrderBy('createdAt', query.sortOrder),
      skip,
      take,
    );
    return buildPage(items, total, query);
  }
}
