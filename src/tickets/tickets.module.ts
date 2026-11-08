import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { CustomersModule } from '../customers/customers.module';
import { TicketsController } from './tickets.controller';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';

@Module({
  imports: [CustomersModule, AgentsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository],
  exports: [TicketsRepository],
})
export class TicketsModule {}
