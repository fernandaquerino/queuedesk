# QueueDesk – Product & Engineering Backlog

None of the items below exist in the MVP. They are written against the code as it stands today
(`src/tickets`, `src/comments`, `src/agents`, Prisma/SQLite, no authentication yet). Items are
ordered roughly by recommended implementation order. Each lists its dependencies so you can pick
them up independently.

Conventions for every item: add a Prisma migration (`npm run db:migrate -- --name <name>`), update
the seed if the feature needs sample data, add unit tests for rules and integration tests under
`test/`, document new endpoints with Swagger decorators, and update `README.md`.

| #   | Item                                           | Size | Depends on  |
| --- | ---------------------------------------------- | ---- | ----------- |
| 1   | Role-based authorization                       | L    | –           |
| 2   | Internal notes and visibility rules            | M    | (1) helpful |
| 3   | Ticket reopening and customer-reply automation | S    | –           |
| 4   | Advanced search and priority sorting           | M    | –           |
| 5   | SLA policies and breach detection              | L    | –           |
| 6   | Ticket escalation                              | M    | 5           |
| 7   | Workload balancing / auto-assignment           | M    | –           |
| 8   | Notification preferences and outbox            | L    | –           |
| 9   | Audit reporting                                | M    | –           |
| 10  | Tags and categories                            | S    | –           |
| 11  | Data retention and customer anonymisation      | M    | –           |

---

## 1. Role-based authorization

**Problem / user need.** Anyone who can reach the API can do anything, and the acting agent is
trusted from the request body (`changedByAgentId`, comment `agentId`). Support leads need powers
agents don't have (deactivate agents, reassign any ticket); customers must only see their own tickets.

**Goal.** Authenticate callers and enforce `ADMIN`, `AGENT` and `CUSTOMER` roles; derive the actor
from the credential instead of the body.

**Scope.**

- In: local credentials or API keys stored hashed (no external IdP), JWT access tokens, a Nest guard
  - `@Roles()` decorator, `@CurrentUser()` decorator, role column on `Agent`, customer access tokens.
- In: remove `changedByAgentId` / comment `agentId` from request bodies (breaking change, version it).
- Out: SSO/OAuth, password reset e-mails, refresh-token rotation.

**Acceptance criteria.**

- Unauthenticated requests to every route except `/health` and `/docs` return 401.
- Only `ADMIN` can create/deactivate agents; `AGENT` can work on any ticket; `CUSTOMER` can list and read only their own tickets and comment on them (403/404 otherwise).
- Status history and comments record the authenticated agent automatically.
- Passwords/keys are never stored or logged in plain text.
- All existing integration tests are updated to authenticate and still pass.

**Suggested files / modules.** new `src/auth/` (module, `auth.service.ts`, `jwt.guard.ts`,
`roles.guard.ts`, decorators), `prisma/schema.prisma` (`Agent.role`, credential fields),
`src/agents/agents.service.ts`, `src/tickets/dto/change-status.dto.ts`,
`src/comments/dto/create-comment.dto.ts`, `test/helpers/factories.ts` (login helper).

**How to verify.** `npm test`; manually: call `POST /tickets` without a token → 401, with a customer
token for another customer's ticket → 404, `PATCH /agents/:id` with an `AGENT` token → 403.

**Dependencies.** None. Unlocks 2, 6, 9 (actor identity).

---

## 2. Internal notes and visibility rules

**Problem / user need.** Agents need to discuss a ticket (“customer is on the VIP plan, be careful”)
without the customer ever seeing it. Today every comment is customer-visible.

**Goal.** Distinguish public replies from internal notes and enforce who can read each.

**Scope.**

- In: `TicketComment.visibility` enum (`PUBLIC`, `INTERNAL`), only agents can create internal notes,
  customer-facing reads exclude them, ticket detail returns notes only to agents.
- In: internal notes are allowed on `RESOLVED` tickets but not on `CLOSED` ones (same as comments).
- Out: @mentions, attachments, editing/deleting comments.

**Acceptance criteria.**

- `POST /tickets/:id/comments` accepts `visibility` (default `PUBLIC`); `INTERNAL` with `authorType=CUSTOMER` → 400.
- A customer-scoped read of `/tickets/:id` and `/tickets/:id/comments` never contains internal notes (including pagination `meta.total`).
- Agent reads include notes, flagged with `visibility`.
- Existing comments are migrated as `PUBLIC`.

**Suggested files / modules.** `prisma/schema.prisma` + migration, `src/comments/*` (DTO, service,
repository filter), `src/tickets/tickets.repository.ts` (`DETAIL_INCLUDE`), `test/tickets.e2e-spec.ts`.

**How to verify.** Integration test creating a public and an internal comment, then reading as
agent (2 comments) and customer (1 comment, `meta.total === 1`). Check the migration keeps old rows.

**Dependencies.** Full value requires item 1; can be built first with a query parameter
(`?audience=customer`) as a stand-in.

---

## 3. Ticket reopening and customer-reply automation

**Problem / user need.** `CLOSED` is terminal, so a customer replying “it broke again” after closure
requires a brand-new ticket, and a reply on a `RESOLVED` ticket does not signal that the issue persists.

**Goal.** Allow a controlled reopen window and automatically reopen resolved tickets when the
customer replies.

**Scope.**

- In: `CLOSED → IN_PROGRESS` reopen allowed within N days of `closedAt` (configurable via env),
  a customer comment on a `RESOLVED` ticket moves it to `IN_PROGRESS` (history note “reopened by customer reply”), `reopenCount` on `Ticket`.
- Out: creating follow-up tickets linked to the old one.

**Acceptance criteria.**

- Reopen inside the window succeeds and clears `closedAt`/`resolvedAt`; outside it returns 409 `REOPEN_WINDOW_EXPIRED`.
- Customer comment on `RESOLVED` triggers the transition atomically with the comment insert (same transaction); agent comments do not.
- `ALLOWED_TRANSITIONS` unit tests are updated; invalid combinations remain rejected.

**Suggested files / modules.** `src/tickets/ticket-workflow.ts`, `src/tickets/tickets.service.ts`,
`src/comments/comments.service.ts` (needs a shared transactional helper in the repositories),
`src/config/env.validation.ts` (`REOPEN_WINDOW_DAYS`).

**How to verify.** Unit tests for the workflow table and window math (inject a clock); e2e test:
resolve → customer comment → status is `IN_PROGRESS` and history has 2 new entries.

**Dependencies.** None.

---

## 4. Advanced search and priority sorting

**Problem / user need.** Agents can filter by exact fields only. They cannot find “refund” across
subjects and descriptions, filter by date range, or sort by urgency (priorities are stored as text).

**Goal.** Full-text-ish ticket search, date-range filters, and a semantically correct priority sort.

**Scope.**

- In: `q` parameter (subject, description, comment bodies, customer name/e-mail), `createdFrom/createdTo`, `updatedFrom/updatedTo`, multi-value filters (`status=OPEN,IN_PROGRESS`), `sortBy=priority` using a numeric rank, `sortBy=lastActivity`.
- In: evaluate SQLite FTS5 (via a hand-written migration + `$queryRaw`) versus `contains`; document the choice.
- Out: external search engines, fuzzy matching.

**Acceptance criteria.**

- `GET /tickets?q=invoice` returns tickets whose subject, description, any comment or customer matches, case-insensitively, with correct `meta.total`.
- `sortBy=priority&sortOrder=desc` returns URGENT, HIGH, MEDIUM, LOW and is stable across pages (id tie-break).
- Date filters are inclusive/exclusive as documented; invalid ranges (`from > to`) return 400.
- Query uses indexes where possible (check with `EXPLAIN QUERY PLAN`, include results in the PR).

**Suggested files / modules.** `src/tickets/dto/list-tickets-query.dto.ts`,
`src/tickets/tickets.service.ts` (where-builder), `src/tickets/tickets.repository.ts`,
`src/common/pagination/paginate.ts` (rank-aware order-by), `prisma/schema.prisma` (+ migration for
`priorityRank` or generated column).

**How to verify.** New e2e cases mirroring the criteria; unit tests for the where-builder; seed
data already contains varied subjects to try manually.

**Dependencies.** None.

---

## 5. SLA policies and breach detection

**Problem / user need.** Urgent tickets sit unanswered with nobody noticing. Support leads need
response/resolution targets per priority and visibility on which tickets are late.

**Goal.** Define SLA policies, compute due dates per ticket, and flag/report breaches.

**Scope.**

- In: `SlaPolicy` (per priority: `firstResponseMinutes`, `resolutionMinutes`), `Ticket.firstResponseDueAt`, `resolutionDueAt`, `firstRespondedAt`, pause while `WAITING_ON_CUSTOMER`, business-hours calendar (Mon–Fri 09–17 in a configurable timezone, no holidays).
- In: `GET /tickets?slaState=breached|at_risk|ok`, `GET /sla/breaches`, a scheduled sweep (`@nestjs/schedule`) that records `SlaBreach` rows once per breach.
- Out: customer-specific SLAs, notifications (see item 8).

**Acceptance criteria.**

- Creating a ticket sets due dates from the policy for its priority; changing priority recalculates remaining time.
- Time in `WAITING_ON_CUSTOMER` does not count; resumed on the next status change.
- The first agent comment sets `firstRespondedAt`; breaches are recorded exactly once even if the sweep runs repeatedly.
- Breach detection logic is a pure function with tests for boundaries (exact deadline, weekend rollover, pause/resume).

**Suggested files / modules.** new `src/sla/` (module, service, `sla-calculator.ts`, scheduler),
`prisma/schema.prisma`, `src/tickets/tickets.service.ts` (hook into create / priority / status),
`src/comments/comments.service.ts` (first response), `src/config/env.validation.ts`
(`SLA_TIMEZONE`, business hours).

**How to verify.** Unit tests of `sla-calculator.ts` with an injected clock; e2e: create URGENT
ticket with a 1-minute policy, advance the clock (inject a `Clock` provider), run the sweep service
directly, assert one breach row and `slaState=breached` in the list.

**Dependencies.** None; precedes item 6.

---

## 6. Ticket escalation

**Problem / user need.** When a ticket is about to breach, or a customer is unhappy, a lead must be
pulled in. Today the only tool is manually changing priority.

**Goal.** Manual and automatic escalation levels with an audit trail.

**Scope.**

- In: `Ticket.escalationLevel` (0–3), `TicketEscalation` rows (who/why/when, from→to level),
  `POST /tickets/:id/escalate` (reason required), automatic escalation by rule when an SLA breach is recorded (+1 level, priority bumped one step up to `URGENT`), optional reassignment to an on-call agent (`Agent.isOnCall`).
- Out: paging/notification delivery, multi-team routing.

**Acceptance criteria.**

- Escalating a closed ticket → 409; exceeding level 3 → 409 `MAX_ESCALATION_REACHED`.
- Each escalation appends a history/audit entry visible on the ticket detail.
- Auto-escalation is idempotent per breach (running twice does not double escalate).
- Priority never decreases through escalation.

**Suggested files / modules.** new `src/escalations/` or inside `src/tickets/`, `prisma/schema.prisma`,
`src/sla/` (event hook), `src/agents/*` (on-call flag).

**How to verify.** e2e: escalate twice, check level/priority/audit rows; unit test auto-escalation
idempotency with a repeated breach event.

**Dependencies.** Item 5 (breach events). Item 1 recommended for who may escalate.

---

## 7. Workload balancing / auto-assignment

**Problem / user need.** Leads assign tickets by hand and some agents end up with far more open work
than others. `GET /agents/:id` already exposes `openTicketCount`, but nothing uses it.

**Goal.** Suggest or perform assignment to the least-loaded eligible agent.

**Scope.**

- In: `Agent.maxOpenTickets` capacity, `Agent.skills` (simple tags), `POST /tickets/:id/auto-assign` choosing the active agent with the lowest weighted load below capacity (weights per priority), deterministic tie-break (lowest id), `GET /agents/workload` overview.
- Out: shift schedules, ML-based routing, background assignment on creation (optional follow-up).

**Acceptance criteria.**

- Never assigns to inactive agents or agents at capacity; returns 409 `NO_AGENT_AVAILABLE` if none qualify.
- Load calculation is one grouped query, not N+1 (verify with Prisma query logging).
- Two simultaneous auto-assign calls cannot push an agent over capacity (guarded update or transaction).
- Selection algorithm is a pure function with unit tests (ties, capacity, weights).

**Suggested files / modules.** new `src/assignment/` (`assignment.service.ts`,
`pick-agent.ts`), `src/agents/agents.repository.ts` (grouped workload query), `prisma/schema.prisma`.

**How to verify.** Seed three agents with different loads; call auto-assign repeatedly and assert
the distribution; run a concurrency test with `Promise.all`.

**Dependencies.** None.

---

## 8. Notification preferences and outbox

**Problem / user need.** Customers and agents should hear about replies and status changes, but
choose how (e-mail/in-app/none) and for which events. Real e-mail is out of scope for this project.

**Goal.** Preference model plus a transactional outbox that records the notifications that _would_
be sent, and a pluggable delivery interface with a log-only adapter.

**Scope.**

- In: `NotificationPreference` (recipient type/id, channel, event type, enabled), defaults,
  `GET/PUT /customers/:id/notification-preferences` (and for agents), `NotificationOutbox` rows written in the same transaction as the triggering change (comment added, status changed, assigned), `NotificationDispatcher` that marks rows `SENT` through a `NotificationChannel` interface (`LogChannel` only), retry counter.
- Out: real SMTP/SMS/push providers, templates in multiple languages.

**Acceptance criteria.**

- Adding a public comment creates outbox rows only for recipients who have the event enabled.
- Disabling all channels creates zero rows; defaults apply when no preference exists.
- Outbox row creation is atomic with the business change (a rolled-back status change leaves no row).
- The dispatcher is idempotent: re-running does not resend `SENT` rows; failures increment `attempts` and stop after a max.

**Suggested files / modules.** new `src/notifications/` (module, preferences controller/service,
outbox repository, dispatcher, `channels/log.channel.ts`), hooks in `src/tickets/tickets.service.ts`
and `src/comments/comments.service.ts`.

**How to verify.** e2e: set preferences, add comment, read `GET /notifications/outbox` (a debug
endpoint) and assert rows; unit tests with a failing fake channel for retry behaviour.

**Dependencies.** None; much better after item 2 (never notify customers about internal notes).

---

## 9. Audit reporting

**Problem / user need.** Managers cannot answer “how long do tickets take to resolve?”, “which agent
resolves the most?” or “what changed on ticket X and who did it?” without querying the DB.

**Goal.** Read-only reporting endpoints built on the existing status history.

**Scope.**

- In: `GET /reports/tickets-by-status`, `GET /reports/resolution-times?from&to&groupBy=agent|priority`
  (median and p90, computed from `TicketStatusHistory`), `GET /reports/agent-activity`, CSV export (`Accept: text/csv`), generalised `AuditEvent` log for assignment and priority changes (currently not recorded in history).
- Out: dashboards, scheduled report e-mails.

**Acceptance criteria.**

- Reports respect the date range and exclude tickets outside it; results are deterministic for the seed data.
- Assignment and priority changes appear in a per-ticket audit trail (`GET /tickets/:id/audit`) with actor and timestamp.
- Percentile math is covered by unit tests (even/odd counts, single value, empty set).
- Queries use grouped SQL (`groupBy`/`$queryRaw`), not loading all tickets in memory.

**Suggested files / modules.** new `src/reports/` (controller, service, repository, `percentile.ts`),
`prisma/schema.prisma` (`AuditEvent`), `src/tickets/tickets.service.ts` (emit audit events).

**How to verify.** Seed then compare endpoint output with a manual SQL query; e2e tests with fixed timestamps (insert history rows directly via Prisma).

**Dependencies.** None; actor accuracy improves with item 1.

---

## 10. Tags and categories

**Problem / user need.** Tickets about “billing”, “bug” or “feature request” cannot be grouped or
filtered, and reporting by topic is impossible.

**Goal.** Free-form tags and a managed category per ticket.

**Scope.**

- In: `Tag` (unique, lower-case slug) with an explicit join table, `Category` (admin-managed list), `PUT /tickets/:id/tags`, `GET /tickets?tag=billing&category=...`, tag counts endpoint.
- Out: tag colours, hierarchies.

**Acceptance criteria.**

- Setting tags is idempotent and replaces the set; duplicates and over-long tags are rejected (400); max 10 tags per ticket.
- Filtering by multiple tags uses AND semantics; pagination totals stay correct (no join row duplication).
- Closed tickets cannot be re-tagged (consistent with priority/assignment rules).

**Suggested files / modules.** `prisma/schema.prisma` (`Tag`, `TicketTag`, `Category`),
new `src/tags/`, `src/tickets/dto/list-tickets-query.dto.ts`, `src/tickets/tickets.repository.ts`.

**How to verify.** e2e: tag three tickets differently, filter with one and two tags, assert counts
and `meta.total`.

**Dependencies.** None.

---

## 11. Data retention and customer anonymisation

**Problem / user need.** Customers may ask for their data to be deleted, but tickets and history
must remain for reporting. There is currently no delete or export at all.

**Goal.** Anonymise a customer in place and export their data; purge old closed tickets by policy.

**Scope.**

- In: `POST /customers/:id/anonymize` (replace name/e-mail/company with placeholders, keep ids, keep tickets), `GET /customers/:id/export` (JSON of customer, tickets, comments), `Customer.anonymizedAt`, a retention job that deletes tickets closed for more than N days (cascade already removes comments/history).
- Out: legal workflow, backups.

**Acceptance criteria.**

- After anonymisation the original e-mail can be reused by a new customer and no old value remains in any table (verified by a test that scans the DB).
- Anonymising twice is idempotent; open tickets block anonymisation (409) until closed.
- The export endpoint contains everything the customer authored and nothing from other customers.
- Retention job is a service method with an injectable clock, tested with boundary dates.

**Suggested files / modules.** `src/customers/*`, new `src/retention/`, `prisma/schema.prisma`.

**How to verify.** e2e tests listed above; run the retention method manually against the seed.

**Dependencies.** None.

---

## Technical debt and refactoring ideas (not feature work)

- Add response DTO classes so Swagger documents response schemas, not just requests.
- Extract the repeated `list()` + `$transaction([findMany, count])` pattern into a small shared helper.
- Replace the “actor in request body” convention with a request-scoped context (prepare for item 1).
- Introduce a `Clock` provider instead of `new Date()` in services (needed by items 3, 5, 11).
- Wrap multi-repository operations (comment + ticket change) in a transaction helper so services stay free of Prisma types.
- Add k6/autocannon smoke performance scripts and check indexes with `EXPLAIN QUERY PLAN`.
