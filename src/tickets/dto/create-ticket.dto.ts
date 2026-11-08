import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketPriority } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IdField } from '../../common/decorators/id-field.decorator';
import { IsOptionalNotNull } from '../../common/decorators/optional';
import { Trim } from '../../common/decorators/transforms';

export class CreateTicketDto {
  @IdField({ description: 'The customer raising the ticket' })
  customerId!: number;

  @ApiProperty({ example: 'Cannot export invoices to CSV', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string;

  @ApiProperty({
    example: 'The export button spins forever on the Invoices page.',
    maxLength: 10000,
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description!: string;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptionalNotNull()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}
