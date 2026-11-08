import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentsModule } from './agents/agents.module';
import { CommentsModule } from './comments/comments.module';
import { validateEnv } from './config/env.validation';
import { CustomersModule } from './customers/customers.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    HealthModule,
    CustomersModule,
    AgentsModule,
    TicketsModule,
    CommentsModule,
  ],
})
export class AppModule {}
