# QueueDesk

REST API for managing customer support tickets: customers, support agents, tickets, comments,
assignment, a validated status workflow and a status-change history.

**Stack:** Node.js 22 · NestJS 11 · TypeScript (strict) · Prisma 6 · SQLite · class-validator ·
Swagger/OpenAPI · Jest + Supertest · ESLint + Prettier. No Docker, no external services.

---

## Quick start

Prerequisites: Node.js 22 and npm. Nothing else (SQLite is a file, Prisma downloads its engines on
`npm install`).

```bash
cd queuedesk
npm install                 # also runs `prisma generate`
cp .env.example .env
npm run db                  # applies migrations + seeds sample data (prisma/dev.db)
npm run dev                 # http://localhost:3000  (watch mode)
```

- Swagger UI: <http://localhost:3000/docs> (JSON: `/docs-json`)
- Health: <http://localhost:3000/health>

Production-style run:

```bash
npm run build
npm start                   # runs dist/main.js
```

## Scripts

| Command                     | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`               | Start the API in watch mode (`nest start --watch`)                                  |
| `npm run build`             | Compile to `dist/` (`nest build`)                                                   |
| `npm start`                 | Run the compiled app (`node dist/main.js`)                                          |
| `npm run lint`              | ESLint over `src`, `test`, `prisma` (`lint:fix` to auto-fix)                        |
| `npm run format`            | Prettier write (`format:check` to verify only)                                      |
| `npm run typecheck`         | `tsc --noEmit` over source, tests and seed                                          |
| `npm test` / `npm run test` | Unit **and** integration tests, run in band                                         |
| `npm run test:unit`         | Unit tests only (`src/**/*.spec.ts`, repositories mocked)                           |
| `npm run test:integration`  | Integration tests only (`test/**/*.e2e-spec.ts`, real SQLite file `prisma/test.db`) |
| `npm run test:cov`          | All tests with coverage                                                             |
| `npm run db`                | `db:deploy` + `db:seed` (apply migrations, seed if empty)                           |
| `npm run db:generate`       | `prisma generate`                                                                   |
| `npm run db:migrate`        | `prisma migrate dev` – create/apply a migration during development                  |
| `npm run db:deploy`         | `prisma migrate deploy` – apply committed migrations only                           |
| `npm run db:seed`           | Seed sample data **only if the database is empty**                                  |
| `npm run db:seed:reset`     | **Deletes all data in `dev.db`**, then seeds                                        |
| `npm run db:reset`          | `prisma migrate reset --force` – drop, re-migrate, re-seed (**destroys dev data**)  |
| `npm run db:studio`         | Open Prisma Studio                                                                  |

Configuration (`.env`, validated at startup – the app refuses to boot on invalid values):

| Variable       | Default         | Notes                                                              |
| -------------- | --------------- | ------------------------------------------------------------------ |
| `NODE_ENV`     | `development`   | `development` \| `test` \| `production`                            |
| `PORT`         | `3000`          | 1–65535                                                            |
| `DATABASE_URL` | `file:./dev.db` | SQLite file; relative paths resolve against `prisma/schema.prisma` |

## Testing and database isolation

`npm test` never touches your development data:

- Integration tests force `DATABASE_URL=file:./test.db` (see `test/setup-env.ts`).
- `test/global-setup.ts` deletes `prisma/test.db`, then runs `prisma migrate deploy` against it, so
  the committed migrations are exercised on every run.
- Each integration test file boots the real Nest application (all modules, pipes and filters) and
  drives it over HTTP with Supertest; tables are emptied before each test.
- Integration tests share one SQLite file, hence `--runInBand`.
- Unit tests instantiate services with mocked repositories (no database).

## API overview

All list endpoints return `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`
and accept `page` (default 1), `pageSize` (default 20, max 100), `sortBy` and `sortOrder`
(`asc`/`desc`). Sorting always uses the id as a tie-breaker, so pages are stable.

| Method & path                  | Description                                                                                                          | Success |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------- |
| `GET /health`                  | API + database check                                                                                                 | 200     |
| `POST /customers`              | Create customer (`name`, `email`, `company?`)                                                                        | 201     |
| `GET /customers`               | List (`search`, `sortBy=createdAt\|name\|id`)                                                                        | 200     |
| `GET /customers/:id`           | Get customer                                                                                                         | 200     |
| `POST /agents`                 | Create agent (`name`, `email`)                                                                                       | 201     |
| `GET /agents`                  | List (`active`, `search`, `sortBy=createdAt\|name\|id`)                                                              | 200     |
| `GET /agents/:id`              | Get agent with `openTicketCount`                                                                                     | 200     |
| `PATCH /agents/:id`            | Rename / (de)activate agent                                                                                          | 200     |
| `POST /tickets`                | Create ticket (`customerId`, `subject`, `description`, `priority?`)                                                  | 201     |
| `GET /tickets`                 | List; filters `status`, `priority`, `customerId`, `assigneeId`, `unassigned=true`; `sortBy=createdAt\|updatedAt\|id` | 200     |
| `GET /tickets/:id`             | Ticket with customer, assignee, comments and status history                                                          | 200     |
| `PUT /tickets/:id/assignee`    | Assign / reassign (`agentId`)                                                                                        | 200     |
| `DELETE /tickets/:id/assignee` | Unassign (OPEN tickets only)                                                                                         | 200     |
| `PATCH /tickets/:id/priority`  | Change priority (`LOW\|MEDIUM\|HIGH\|URGENT`)                                                                        | 200     |
| `POST /tickets/:id/status`     | Change status (`status`, `note?`, `changedByAgentId?`)                                                               | 200     |
| `POST /tickets/:id/comments`   | Comment as `CUSTOMER` or `AGENT` (+`agentId`)                                                                        | 201     |
| `GET /tickets/:id/comments`    | Paginated comments (oldest first by default)                                                                         | 200     |

### Business rules

- A ticket starts `OPEN`, `MEDIUM` priority (unless given), unassigned. Creation writes the first
  history row (`null → OPEN`).
- **Status workflow** (`src/tickets/ticket-workflow.ts`):

  | From                  | Allowed targets                           |
  | --------------------- | ----------------------------------------- |
  | `OPEN`                | `IN_PROGRESS`, `CLOSED`                   |
  | `IN_PROGRESS`         | `OPEN`, `WAITING_ON_CUSTOMER`, `RESOLVED` |
  | `WAITING_ON_CUSTOMER` | `IN_PROGRESS`, `RESOLVED`, `CLOSED`       |
  | `RESOLVED`            | `IN_PROGRESS` (reopen), `CLOSED`          |
  | `CLOSED`              | – (final)                                 |

- `IN_PROGRESS`, `WAITING_ON_CUSTOMER` and `RESOLVED` require an assignee; therefore a ticket can
  only be unassigned while it is `OPEN`.
- Closed tickets cannot be assigned, reprioritised or commented on.
- Only active agents can be assigned, comment, or be recorded as the actor of a status change.
- An agent with `OPEN`/`IN_PROGRESS`/`WAITING_ON_CUSTOMER` tickets cannot be deactivated.
- E-mails are trimmed and lower-cased; they are unique for customers and for agents.
- Status changes and assignments are guarded by compare-and-set updates, so two racing requests
  cannot both succeed against stale state (`409 CONCURRENT_MODIFICATION`).

### Errors

Every error has the same shape (see `src/common/filters/all-exceptions.filter.ts`):

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "INVALID_STATUS_TRANSITION",
  "message": "Cannot move ticket 11 from RESOLVED to OPEN",
  "details": { "from": "RESOLVED", "to": "OPEN", "allowed": ["IN_PROGRESS", "CLOSED"] },
  "path": "/tickets/11/status",
  "timestamp": "2026-11-08T03:48:46.465Z"
}
```

| Status | Meaning                                                                             |
| ------ | ----------------------------------------------------------------------------------- |
| 400    | Invalid input (`VALIDATION_FAILED` with per-field `details`), malformed JSON/ids    |
| 404    | Unknown resource (`TICKET_NOT_FOUND`, `CUSTOMER_NOT_FOUND`, `AGENT_NOT_FOUND`)      |
| 409    | Conflicts with current state (invalid transition, closed ticket, duplicate e-mail…) |
| 422    | Refers to an ineligible resource (`AGENT_INACTIVE`)                                 |
| 500    | Unexpected; logged server-side, details never leaked to the client                  |

## Project layout

```
prisma/
  schema.prisma          data model
  migrations/            committed SQL migrations
  seed.ts                realistic sample data
src/
  main.ts, app.module.ts, app.setup.ts    bootstrap, wiring, shared HTTP setup, Swagger
  config/                environment validation (class-validator)
  prisma/                PrismaService / PrismaModule
  common/                exceptions, exception filter, pipes, pagination, DTO helpers
  health/                GET /health
  customers/ agents/ tickets/ comments/
      *.controller.ts    HTTP only: routing, DTOs, status codes, Swagger metadata
      *.service.ts       business rules
      *.repository.ts    all Prisma access for the aggregate
      dto/               request validation
test/                    integration tests, helpers, global setup
```

Dependency direction: controller → service → repository → Prisma. Services never import Prisma
directly; controllers never touch repositories.

## Known limitations

- No authentication or authorisation: the acting agent is supplied in the request body
  (`changedByAgentId`, comment `agentId`). See `BACKLOG.md` (role-based authorization).
- Tickets cannot be sorted by priority (priorities are stored as text; a numeric rank is needed).
- Search is a simple `contains` match on customers and agents; there is no ticket search yet.
- Swagger documents request bodies/queries in detail; response bodies are described in prose only.
- SQLite serialises writes. `PrismaService` opens the database with `connection_limit=1`
  (added automatically) so concurrent write transactions queue instead of failing with Prisma error
  P1008 – without it, racing requests returned 500s (see `test/concurrency.e2e-spec.ts`). Fine for a
  local portfolio project, not a scaling story.
- Optional body fields use `@IsOptionalNotNull()` (`src/common/decorators/optional.ts`): omitting a
  field is fine, sending an explicit `null` is a 400, never a 500.
- Prisma enums on SQLite are validated by the client, not by the database.

Planned work lives in [`BACKLOG.md`](./BACKLOG.md); the results of the last verification run are in
[`VERIFICATION.md`](./VERIFICATION.md).
