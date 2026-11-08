import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ToBoolean, Trim } from '../../common/decorators/transforms';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';

export const AGENT_SORT_FIELDS = ['createdAt', 'name', 'id'] as const;
export type AgentSortField = (typeof AGENT_SORT_FIELDS)[number];

export class ListAgentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AGENT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(AGENT_SORT_FIELDS)
  sortBy: AgentSortField = 'createdAt';

  @ApiPropertyOptional({ description: 'Only active (true) or only inactive (false) agents' })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Case-insensitive match on name or email' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  search?: string;
}
