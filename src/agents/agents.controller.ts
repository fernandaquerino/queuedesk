import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IdParamPipe } from '../common/pipes/id-param.pipe';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { ListAgentsQueryDto } from './dto/list-agents-query.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@ApiTags('Agents')
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a support agent' })
  @ApiCreatedResponse({ description: 'The created agent' })
  @ApiConflictResponse({ description: 'E-mail already registered (AGENT_EMAIL_TAKEN)' })
  create(@Body() dto: CreateAgentDto) {
    return this.agents.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List support agents (paginated, filterable by active flag)' })
  @ApiOkResponse({ description: 'A page of agents: { data, meta }' })
  list(@Query() query: ListAgentsQueryDto) {
    return this.agents.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an agent with their current open-ticket count' })
  @ApiOkResponse({ description: 'The agent, including openTicketCount' })
  @ApiNotFoundResponse({ description: 'AGENT_NOT_FOUND' })
  getById(@Param('id', IdParamPipe) id: number) {
    return this.agents.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or (de)activate an agent' })
  @ApiOkResponse({ description: 'The updated agent' })
  @ApiNotFoundResponse({ description: 'AGENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'Agent still has open tickets (AGENT_HAS_OPEN_TICKETS)' })
  update(@Param('id', IdParamPipe) id: number, @Body() dto: UpdateAgentDto) {
    return this.agents.update(id, dto);
  }
}
