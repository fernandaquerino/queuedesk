import { INestApplication } from '@nestjs/common';
import request from 'supertest';

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createCustomer(
  app: INestApplication,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/customers')
    .send({ name: 'Test Customer', email: `customer-${unique()}@example.com`, ...overrides })
    .expect(201);
  return res.body as { id: number; name: string; email: string };
}

export async function createAgent(app: INestApplication, overrides: Record<string, unknown> = {}) {
  const res = await request(app.getHttpServer())
    .post('/agents')
    .send({ name: 'Test Agent', email: `agent-${unique()}@example.com`, ...overrides })
    .expect(201);
  return res.body as { id: number; name: string; email: string; active: boolean };
}

export async function createTicket(
  app: INestApplication,
  customerId: number,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app.getHttpServer())
    .post('/tickets')
    .send({
      customerId,
      subject: 'Printer on fire',
      description: 'The printer is emitting smoke.',
      ...overrides,
    })
    .expect(201);
  return res.body as {
    id: number;
    status: string;
    priority: string;
    assigneeId: number | null;
    [key: string]: any;
  };
}

export function changeStatus(
  app: INestApplication,
  ticketId: number,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return request(app.getHttpServer())
    .post(`/tickets/${ticketId}/status`)
    .send({ status, ...extra });
}

export function assign(app: INestApplication, ticketId: number, agentId: number) {
  return request(app.getHttpServer()).put(`/tickets/${ticketId}/assignee`).send({ agentId });
}
