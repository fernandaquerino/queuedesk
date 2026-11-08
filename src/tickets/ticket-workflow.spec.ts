import { TicketStatus } from '@prisma/client';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  isClosed,
  OPEN_WORKLOAD_STATUSES,
  requiresAssignee,
} from './ticket-workflow';

const ALL: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'];

describe('ticket workflow', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it.each([
    ['OPEN', 'IN_PROGRESS'],
    ['OPEN', 'CLOSED'],
    ['IN_PROGRESS', 'WAITING_ON_CUSTOMER'],
    ['IN_PROGRESS', 'RESOLVED'],
    ['WAITING_ON_CUSTOMER', 'IN_PROGRESS'],
    ['RESOLVED', 'IN_PROGRESS'],
    ['RESOLVED', 'CLOSED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['OPEN', 'RESOLVED'],
    ['OPEN', 'WAITING_ON_CUSTOMER'],
    ['IN_PROGRESS', 'CLOSED'],
    ['RESOLVED', 'OPEN'],
    ['CLOSED', 'OPEN'],
    ['CLOSED', 'IN_PROGRESS'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ALL) expect(canTransition(status, status)).toBe(false);
  });

  it('makes CLOSED terminal and every other status able to reach CLOSED eventually', () => {
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
    const reachable = (from: TicketStatus, seen = new Set<TicketStatus>()): Set<TicketStatus> => {
      if (seen.has(from)) return seen;
      seen.add(from);
      ALLOWED_TRANSITIONS[from].forEach((next) => reachable(next, seen));
      return seen;
    };
    for (const status of ALL) expect(reachable(status).has('CLOSED')).toBe(true);
  });

  it('only requires an assignee for statuses that mean "someone is working on it"', () => {
    expect(ALL.filter(requiresAssignee)).toEqual([
      'IN_PROGRESS',
      'WAITING_ON_CUSTOMER',
      'RESOLVED',
    ]);
  });

  it('counts OPEN, IN_PROGRESS and WAITING_ON_CUSTOMER as agent workload', () => {
    expect(OPEN_WORKLOAD_STATUSES).toEqual(['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER']);
    expect(isClosed('CLOSED')).toBe(true);
    expect(isClosed('RESOLVED')).toBe(false);
  });
});
