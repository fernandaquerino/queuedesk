import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdatePriorityDto } from './dto/update-priority.dto';
import { TicketsService } from './tickets.service';

@ApiTags('Tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a ticket for a customer (starts as OPEN)' })
  @ApiCreatedResponse({ description: 'The created ticket with its initial status history' })
  @ApiNotFoundResponse({ description: 'CUSTOMER_NOT_FOUND' })
  create(@Body() dto: CreateTicketDto) {
    return this.tickets.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List tickets',
    description:
      'Filter by status, priority, customerId, assigneeId or unassigned=true. ' +
      'Sorted by createdAt (default), updatedAt or id with id as a stable tie-breaker.',
  })
  @ApiOkResponse({ description: 'A page of tickets: { data, meta }' })
  list(@Query() query: ListTicketsQueryDto) {
    return this.tickets.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a ticket with comments and status history' })
  @ApiOkResponse({ description: 'The ticket, its comments and its status history' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.tickets.getById(id);
  }

  @Put(':id/assignee')
  @ApiOperation({ summary: 'Assign (or reassign) a ticket to an active agent' })
  @ApiOkResponse({ description: 'The updated ticket' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND or AGENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'Ticket is closed (TICKET_CLOSED)' })
  @ApiUnprocessableEntityResponse({ description: 'Agent is inactive (AGENT_INACTIVE)' })
  assign(@Param('id', IdParamPipe) id: number, @Body() dto: AssignTicketDto) {
    return this.tickets.assign(id, dto);
  }

  @Delete(':id/assignee')
  @ApiOperation({ summary: 'Unassign a ticket (only while it is OPEN)' })
  @ApiOkResponse({ description: 'The updated ticket' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND' })
  @ApiConflictResponse({ description: 'Ticket is not OPEN (TICKET_UNASSIGN_NOT_ALLOWED)' })
  unassign(@Param('id', IdParamPipe) id: number) {
    return this.tickets.unassign(id);
  }

  @Patch(':id/priority')
  @ApiOperation({ summary: 'Update the priority of a ticket' })
  @ApiOkResponse({ description: 'The updated ticket' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND' })
  @ApiConflictResponse({ description: 'Ticket is closed (TICKET_CLOSED)' })
  updatePriority(@Param('id', IdParamPipe) id: number, @Body() dto: UpdatePriorityDto) {
    return this.tickets.updatePriority(id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change the status of a ticket',
    description:
      'Allowed transitions: OPEN→IN_PROGRESS|CLOSED, IN_PROGRESS→OPEN|WAITING_ON_CUSTOMER|RESOLVED, ' +
      'WAITING_ON_CUSTOMER→IN_PROGRESS|RESOLVED|CLOSED, RESOLVED→IN_PROGRESS|CLOSED. CLOSED is final. ' +
      'IN_PROGRESS, WAITING_ON_CUSTOMER and RESOLVED require an assignee.',
  })
  @ApiOkResponse({ description: 'The updated ticket including the new history entry' })
  @ApiNotFoundResponse({ description: 'TICKET_NOT_FOUND or AGENT_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'INVALID_STATUS_TRANSITION, ASSIGNEE_REQUIRED or CONCURRENT_MODIFICATION',
  })
  changeStatus(@Param('id', IdParamPipe) id: number, @Body() dto: ChangeStatusDto) {
    return this.tickets.changeStatus(id, dto);
  }
}
