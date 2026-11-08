import { IdField } from '../../common/decorators/id-field.decorator';

export class AssignTicketDto {
  @IdField({ description: 'The (active) agent who will own the ticket' })
  agentId!: number;
}
