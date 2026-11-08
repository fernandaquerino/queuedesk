import { ApiPropertyOptional } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_INT } from '../../common/constants/limits';
import { ToBoolean } from '../../common/decorators/transforms';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const TICKET_SORT_FIELDS = ['createdAt', 'updatedAt', 'id'] as const;
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

export class ListTicketsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TICKET_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TICKET_SORT_FIELDS)
  sortBy: TicketSortField = 'createdAt';

  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ enum: TicketPriority })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @ApiPropertyOptional({ description: 'Only tickets raised by this customer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  customerId?: number;

  @ApiPropertyOptional({ description: 'Only tickets assigned to this agent' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  assigneeId?: number;

  @ApiPropertyOptional({
    description: 'true: only unassigned tickets. Cannot be combined with assigneeId.',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  unassigned?: boolean;
}
