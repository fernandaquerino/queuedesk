import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class UpdateAgentDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description: 'Deactivating is rejected while the agent still has open tickets',
  })
  @IsOptionalNotNull()
  @IsBoolean()
  active?: boolean;
}
