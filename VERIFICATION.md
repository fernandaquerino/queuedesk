# QueueDesk – Verification Report

Everything below was executed in this repository's build environment on 2026-11-08. Nothing is
claimed that was not run. Legend: ✅ passed · ❌ failed (see notes) · ⏭️ skipped · ❓ unverified.

**Environment:** Linux (4 CPUs), Node.js v22.23.4, npm 10.9.9, NestJS 11.2.x, Prisma 6.19.3,
TypeScript 5.9.x, Jest 29.7, SQLite (file database through Prisma).

## 1. Clean-room run (README setup from scratch)

The project was copied _without_ `node_modules`, `dist`, any `*.db` file and `.env`, and the commands
from the README were run in order in that copy (final run, after all fixes in section 5):

| Step                                               | Result | Notes                                                           |
| -------------------------------------------------- | ------ | --------------------------------------------------------------- |
| `npm install` (runs `prisma generate` postinstall) | ✅     | Prisma Client 6.19.3 generated                                  |
| `cp .env.example .env`                             | ✅     |                                                                 |
| `npm run db` (migrate deploy + seed)               | ✅     | 1 migration applied; 6 customers / 4 agents / 10 tickets seeded |
| `npm run db` again                                 | ✅     | Seed skipped: "Database already contains data"                  |
| `npm run lint`                                     | ✅     | 0 errors, 0 warnings                                            |
| `npm run format:check`                             | ✅     |                                                                 |
| `npm run typecheck`                                | ✅     | strict mode                                                     |
| `npm run test:unit`                                | ✅     | 10 suites, **89 tests** passed                                  |
| `npm run test:integration`                         | ✅     | 6 suites, **68 tests** passed                                   |
| `npm test`                                         | ✅     | 16 suites, **157 tests** passed                                 |
| `npm run build`                                    | ✅     | `dist/main.js` produced                                         |

Coverage (`npm run test:cov`, unit + integration): **98.9 % statements, 91.5 % branches, 100 % functions**
(DTOs, modules and `main.ts` excluded). Uncovered: the "database unreachable" branch of `/health`, two
defensive branches of the exception filter, two defensive branches of the ticket service.

`prisma migrate diff --from-migrations … --to-schema-datamodel …` reports **no drift** between the
committed migration and `schema.prisma`.

## 2. What the automated tests cover

| Area                    | Where                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input validation        | `test/*.e2e-spec.ts` (400s with field details, unknown properties, enums, ids, explicit `null`s, pagination), `config/env.validation.spec.ts`, `common/pipes/pipes.spec.ts`               |
| Successful CRUD / flows | customers, agents, tickets (create → assign → status walk → comments → detail with history)                                                                                               |
| Invalid transitions     | `ticket-workflow.spec.ts` (table-driven), `tickets.service.spec.ts`, `tickets.e2e-spec.ts`                                                                                                |
| Not found               | every resource and sub-resource, malformed/zero/overflowing ids                                                                                                                           |
| Domain invariants       | assignee required, unassign only when OPEN, closed tickets immutable, inactive agents, agent deactivation blocked by open tickets, failed status change leaves no history row             |
| Persistence             | `persistence.e2e-spec.ts`: data survives an application restart; FK, unique and cascade constraints enforced by SQLite itself                                                             |
| Concurrency             | `concurrency.e2e-spec.ts`: racing status changes (exactly one wins, rest 409, no 5xx); unassign vs. start-work; `prisma.service.spec.ts` asserts the single-connection pool configuration |
| Error handling          | uniform error shape, unknown route, malformed JSON, Prisma-error mapping, no leakage of 500 details                                                                                       |
| Pagination / sorting    | totals, `totalPages`, tie-breaking with 26 rows sharing identical sort keys, combined filters                                                                                             |
| Test-DB isolation       | `test/global-setup.ts` recreates `prisma/test.db`; `prisma/dev.db` kept its seeded rows through repeated full test runs                                                                   |

## 3. Manual smoke test against the running API

Built (`npm run build`) and started with `npm start` against the seeded `dev.db`; requests sent with `curl`:

| Request                                                  | Observed                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /health`                                            | ✅ 200 `{"status":"ok","database":"up",…}`                                                      |
| `GET /tickets?priority=HIGH&status=OPEN&pageSize=5`      | ✅ 200, 1 seeded ticket, correct `meta`                                                         |
| `POST /customers` (new)                                  | ✅ 201                                                                                          |
| `POST /customers` (same e-mail, different case)          | ✅ 409 `CUSTOMER_EMAIL_TAKEN`                                                                   |
| `POST /tickets`                                          | ✅ 201, status `OPEN`, one history row                                                          |
| `POST /tickets/11/status` `IN_PROGRESS` without assignee | ✅ 409 `ASSIGNEE_REQUIRED`                                                                      |
| `PUT /tickets/11/assignee`, then status `IN_PROGRESS`    | ✅ 200, 200                                                                                     |
| `RESOLVED`, then `OPEN`                                  | ✅ 409 `INVALID_STATUS_TRANSITION` with `allowed`                                               |
| `POST /tickets/11/comments` (agent)                      | ✅ 201 with agent summary                                                                       |
| `GET /tickets/11`                                        | ✅ status `RESOLVED`, 1 comment, 3 history entries                                              |
| `GET /tickets/999`                                       | ✅ 404 `TICKET_NOT_FOUND`                                                                       |
| `GET /docs`, `GET /docs-json`                            | ✅ 200; 11 documented paths                                                                     |
| `npm run dev` (watch mode)                               | ✅ "Found 0 errors. Watching…", `/health` 200                                                   |
| Start with `DATABASE_URL=postgresql://x`                 | ✅ refuses to boot with a readable validation error                                             |
| 20 concurrent `OPEN → IN_PROGRESS` on one ticket (final) | ✅ 1×200 + 19×409 in ~30 ms (3 repetitions); before the fix 1×200, 1×409, **18×500** after 20 s |

The smoke tests wrote rows into `dev.db`; it was restored with `npm run db:seed:reset`.

## 4. Other scripts

| Script                  | Result | Notes                                                                                                                                                                                                                  |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:generate`   | ✅     |                                                                                                                                                                                                                        |
| `npm run lint:fix`      | ✅     | No changes needed                                                                                                                                                                                                      |
| `npm run db:seed:reset` | ✅     | Includes argument pass-through (`prisma db seed -- --reset`); ids restart at 1                                                                                                                                         |
| `npm run db:migrate`    | ⚠️     | The equivalent `prisma migrate dev --name init` created the committed migration; the npm alias itself was not re-run                                                                                                   |
| `npm run db:reset`      | ⏭️     | **Skipped on purpose.** Prisma's built-in safeguard blocks `migrate reset` when it detects an AI agent and demands the user's explicit consent. It is destructive, so it was not forced. Run it yourself to verify it. |
| `npm run db:studio`     | ⏭️     | Interactive GUI, not run                                                                                                                                                                                               |

## 5. Failures and defects found while building (all fixed)

1. **Bug caught by an integration test:** `POST /tickets/:id/comments` with `authorType=AGENT` and no
   `agentId` returned **500**. `@IsOptional()` inside the id decorator disables the conditional
   `@ValidateIf`. Fixed in `create-comment.dto.ts`; covered by `validates comments: author rules…`.
2. **Bug found by manual probing (not by the first test suite):** an explicit JSON `null` for optional
   body fields returned **500** (`PATCH /agents/:id {"name":null}`, `{"active":null}`,
   `POST /tickets` with `"priority":null`, `POST /tickets/:id/status` with `"changedByAgentId":null`),
   because `@IsOptional()` skips all validators for `null` and Prisma then rejects it. Added
   `@IsOptionalNotNull()` and applied it to every optional body field; regression tests added
   (`rejects an invalid or null … on update`, `rejects explicit nulls for optional fields`).
3. **Concurrency defect found by manual probing:** with the default Prisma pool, simultaneous write
   transactions on SQLite fought over the file lock and failed with P1008 "Socket timeout": 18 of 20
   racing status changes returned **500** after ~20 s (the data itself stayed consistent: one
   transition, two history rows). Fix: `PrismaService` forces `connection_limit=1`, so writers queue.
   After the fix: 1×200 + 19×409 in ~30 ms against the real server.
   _Test caveat (honest):_ inside Jest the unfixed code reproduces the failure only intermittently
   (about 1 run in 5 for `concurrency.e2e-spec.ts`), so that test is a probabilistic guard. The
   deterministic guard is `prisma.service.spec.ts`, which asserts the client is created with
   `connection_limit=1`.
4. `jest.config.js`: `testTimeout` is not a valid per-project option; moved to the top level.
5. Unit tests failed with `Reflect.getMetadata is not a function` for decorated classes; the unit
   project now loads `reflect-metadata` via `setupFiles`.
6. `npm run format:check` failed in an earlier clean-room run because documentation edited after the
   last format run was not Prettier-formatted; formatted and re-checked.
7. The first `prisma migrate dev` printed a seed error because `prisma/seed.ts` did not exist yet; the
   migration itself had been applied. Not an issue after the seed was added.
8. Coverage was first reported as 56 % because spec files were counted as source; fixed in
   `jest.config.js`.
9. After repeated `db:seed:reset` runs ids kept growing (SQLite autoincrement counters survive
   `deleteMany`); the seed now clears `sqlite_sequence` so ids restart at 1.

## 6. Not verified / known gaps

- ❓ `/health` returning 503 when the database is down (code path exists, never executed).
- ❓ Swagger UI rendering in a browser (only HTTP 200 and the JSON document were checked).
- ❓ Behaviour on Windows/macOS, other Node versions, or with a read-only filesystem.
- ❓ Sustained load / performance; `npm audit` was not run.
- Priority sorting, ticket text search and response-schema documentation are not implemented
  (see README "Known limitations" and `BACKLOG.md`).
