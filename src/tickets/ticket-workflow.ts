import { TicketStatus } from '@prisma/client';

/**
 * Ticket lifecycle (business rules live here as plain data so they are easy to test and extend).
 *
 *   OPEN                -> IN_PROGRESS, CLOSED
 *   IN_PROGRESS         -> OPEN, WAITING_ON_CUSTOMER, RESOLVED
 *   WAITING_ON_CUSTOMER -> IN_PROGRESS, RESOLVED, CLOSED
 *   RESOLVED            -> IN_PROGRESS (reopen), CLOSED
 *   CLOSED              -> (terminal)
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'WAITING_ON_CUSTOMER', 'RESOLVED'],
  WAITING_ON_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

/** Statuses in which somebody must own the ticket (invariant: never unassigned in these). */
export const STATUSES_REQUIRING_ASSIGNEE: readonly TicketStatus[] = [
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
  'RESOLVED',
];

/** Tickets in these statuses count towards an agent's workload. */
export const OPEN_WORKLOAD_STATUSES: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
];

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function requiresAssignee(status: TicketStatus): boolean {
  return STATUSES_REQUIRING_ASSIGNEE.includes(status);
}

export function isClosed(status: TicketStatus): boolean {
  return status === 'CLOSED';
}
