import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IdParamPipe } from '../common/pipes/id-param.pipe';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';

@ApiTags('Ticket comments')
@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Add a comment to a ticket (as the customer or as an agent)' })
  @ApiCreatedResponse({ description: 'The created comment' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND or AGENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'Ticket is closed (TICKET_CLOSED)' })
  @ApiUnprocessableEntityResponse({ description: 'Agent is inactive (AGENT_INACTIVE)' })
  create(@Param('ticketId', IdParamPipe) ticketId: number, @Body() dto: CreateCommentDto) {
    return this.comments.create(ticketId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the comments of a ticket (oldest first by default)' })
  @ApiOkResponse({ description: 'A page of comments: { data, meta }' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND' })
  list(@Param('ticketId', IdParamPipe) ticketId: number, @Query() query: ListCommentsQueryDto) {
    return this.comments.list(ticketId, query);
  }
}
