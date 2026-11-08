import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentAuthorType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_INT } from '../../common/constants/limits';
import { Trim } from '../../common/decorators/transforms';

export class CreateCommentDto {
  @ApiProperty({ example: 'Could you share a screenshot of the error?', maxLength: 5000 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;

  @ApiProperty({ enum: CommentAuthorType })
  @IsEnum(CommentAuthorType)
  authorType!: CommentAuthorType;

  @ApiPropertyOptional({ description: 'Required when authorType is AGENT; forbidden for CUSTOMER' })
  // Validated only for AGENT comments (and then it is mandatory). For CUSTOMER comments the
  // service rejects a supplied agentId. Do not add @IsOptional(): it would disable ValidateIf.
  @ValidateIf((o: CreateCommentDto) => o.authorType === CommentAuthorType.AGENT)
  @IsInt()
  @Min(1)
  @Max(MAX_INT)
  agentId?: number;
}
