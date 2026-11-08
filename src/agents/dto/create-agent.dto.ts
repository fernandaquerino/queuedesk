import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail, Trim } from '../../common/decorators/transforms';

export class CreateAgentDto {
  @ApiProperty({ example: 'Priya Raman', maxLength: 120 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'priya.raman@queuedesk.example', description: 'Stored lower-case' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
