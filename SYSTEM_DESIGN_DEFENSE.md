# CollabFlow – System Design Defense

This document explains the architecture decisions, trade-offs, failure scenarios, and technology choices behind CollabFlow's event-driven AI workflow engine.

## 1. Why Express.js Over NestJS

### Decision
I rebuilt the backend from scratch using **Express.js** instead of keeping the original NestJS framework.

### Rationale
- **Simplicity over ceremony**: Express gives direct control over middleware chains, routing, and error handling without the decorator-heavy abstraction layer that NestJS introduces. For a system where the core complexity lives in queue processing and AI orchestration (not in framework plumbing), Express is a better fit.
- **Easier debugging**: When a job fails in a BullMQ worker, I want to trace the error through a flat call stack, not through NestJS's dependency injection container and interceptor pipelines.
- **Smaller bundle**: The backend binary is significantly smaller without `@nestjs/core`, `reflect-metadata`, and the class-transformer/class-validator ecosystem.
- **Team familiarity**: Express is the most widely understood Node.js framework. Any contributor can read the codebase without learning NestJS-specific patterns.

### Trade-offs
- We lose NestJS's built-in Swagger generation (we compensate with structured route documentation).
- No built-in dependency injection (we use simple module-level singletons instead, which is sufficient for this scale).
- No decorators for guards/pipes (we use explicit middleware functions, which are more transparent).

---

## 2. Event-Driven Architecture with BullMQ

### Design
Every write operation (POST, PUT, DELETE) across all API routes goes through a BullMQ queue instead of writing directly to PostgreSQL. The API returns `202 Accepted` with a `jobId`, and a background worker processes the actual database operation.

### Why Queues for Everything
- **Reliability**: If PostgreSQL is temporarily unavailable, jobs sit in Redis and retry automatically. No data is lost.
- **Rate limiting**: We control write throughput via worker concurrency settings (`concurrency: 5` for tasks, `concurrency: 2` for AI).
- **Idempotency**: Combined with Redis-stored idempotency keys (24h TTL), we guarantee exactly-once processing even if the client retries.
- **Observability**: Every operation has a `jobId` that can be tracked through its lifecycle (waiting → active → completed/failed).

### Retry Strategy
```
attempts: 3
backoff: { type: 'exponential', delay: 2000 }
```
- First retry: 2 seconds
- Second retry: 4 seconds
- Third retry: 8 seconds

After all retries exhaust, the job moves to a **dead-letter queue** (`failedQueue`) for manual inspection.

### Idempotency Implementation
1. Client sends `Idempotency-Key` header (or one is generated from request body hash).
2. Before adding a job to the queue, we check Redis for this key.
3. If found, return the cached result immediately (no duplicate processing).
4. The worker double-checks idempotency before writing to DB (defense in depth).
5. After successful write, the result is stored in Redis with 24h TTL.

### Failure Scenarios
| Scenario | Behavior |
|---|---|
| Redis down | Queue operations fail, API returns 500. Workers pause until Redis recovers. |
| PostgreSQL down | Workers retry 3 times with exponential backoff. After failure, job goes to DLQ. |
| Worker crash mid-job | BullMQ's visibility timeout ensures the job becomes available for another worker to pick up. |
| Duplicate request | Idempotency key check returns cached result, preventing duplicate writes. |

### Trade-off: Eventual Consistency
The client doesn't get the final result immediately (202 vs 200). We mitigate this with:
- Socket.io real-time events that push the created/updated entity to all connected clients.
- A job status endpoint (`GET /api/ai/job/:jobId`) for polling.

---

## 3. AI Workflow Engine Design

### Architecture
The AI orchestration flow is:
1. Client sends `POST /api/ai/orchestrate` with a natural language prompt.
2. The route adds a job to `aiQueue`.
3. The AI worker calls Groq's LLM API with a structured system prompt.
4. The LLM response is validated against a strict JSON schema.
5. For each generated task, a creation job is added to `taskQueue`.
6. Tasks appear in the database after worker processing.

### Schema Validation
We enforce a strict output schema:
```json
{
  "tasks": [{
    "title": "string",
    "subtasks": ["string"],
    "priority": "high|medium|low",
    "dueDate": "optional ISO date"
  }]
}
```
Validation checks:
- `tasks` must be an array
- Each task must have a non-empty `title` string
- `subtasks` must be an array of strings
- `priority` must be exactly one of `high`, `medium`, `low`
- `dueDate` if present must be a string

### Retry Logic
If the LLM response fails schema validation:
1. **Attempt 1**: Send the original prompt.
2. **Attempt 2**: Prepend correction instructions ("You must output a JSON object with a 'tasks' array...").
3. **Attempt 3**: Same corrected prompt with fresh request.
4. **Fallback**: If all attempts fail, return a generic task with the original prompt as context. Log the error for debugging.

### Caching
- Successful LLM responses are cached in Redis with key `ai:${md5(prompt)}` and 3600s TTL.
- Identical prompts within the TTL window skip the LLM call entirely, saving API costs and latency.

### Trade-offs
- Using Groq (Llama 3.3 70B) over OpenAI for faster inference and lower cost.
- `response_format: { type: "json_object" }` helps but doesn't guarantee our specific schema, hence the manual validation layer.
- The fallback response is deliberately simple to avoid the system silently producing incorrect data.

---

## 4. Real-Time Conflict Resolution

### Problem
When multiple users edit the same task simultaneously (e.g., drag-and-drop on a Kanban board), we need to prevent lost updates.

### Solution: Optimistic Concurrency Control (OCC)
Every `Task` row has a `version` integer field (starts at 0). The update flow:

1. Client reads a task with `version: 5`.
2. Client sends update with `clientVersion: 5`.
3. Worker checks: does `task.version` in DB still equal `5`?
   - **Yes**: Apply update, increment version to `6`, emit `task:updated`.
   - **No**: Reject with version conflict error, emit `task:conflict` to the requesting client.

### Frontend Handling
- **Optimistic UI**: The client immediately reflects the change in the local Zustand store.
- **Rollback**: If a `task:conflict` event is received, the store reverts to the server state and shows a toast notification.
- **Broadcast**: Successful updates are broadcast to all other clients in the project room via Socket.io.

### Why Not Operational Transformation (OT) or CRDTs?
- OT/CRDTs are designed for character-level collaborative editing (like Google Docs). Task management operations are coarser-grained (move to column, change priority, update title).
- OCC with version fields is the industry standard for this type of data (used by Jira, Linear, Asana).
- The implementation complexity of OT is 10x higher with minimal benefit for our use case.

### Trade-off: Last-Write-Wins for Some Fields
For non-critical fields (like description), we use last-write-wins semantics to avoid blocking users. Only status and priority changes use strict version checking.

---

## 5. Horizontal Scaling Approach

### Stateless Backend
The Express backend stores no session data in memory. All state lives in:
- **PostgreSQL**: Persistent data (users, tasks, projects).
- **Redis**: Session tokens, queue state, socket adapter pub/sub, idempotency keys.

### Scaling Strategy
```
                 ┌─────────────┐
                 │   Nginx     │
                 │   (Load     │
                 │   Balancer) │
                 └──────┬──────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
     ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
     │ Express │  │ Express │  │ Express │
     │  :3000  │  │  :3001  │  │  :3002  │
     └────┬────┘  └────┬────┘  └────┬────┘
          │             │             │
     ┌────▼─────────────▼─────────────▼────┐
     │              Redis                   │
     │  (Queues + Pub/Sub + Socket.io)      │
     └──────────────────┬──────────────────┘
                        │
     ┌──────────────────▼──────────────────┐
     │           PostgreSQL                 │
     └──────────────────────────────────────┘
```

### Socket.io with Redis Adapter
- Each Express instance creates its own Socket.io server.
- The `@socket.io/redis-adapter` ensures that events emitted by one instance are broadcast to clients connected to other instances.
- A client connected to Instance A receives `task:updated` events from Instance B.

### BullMQ Worker Distribution
- BullMQ workers compete for jobs from the shared Redis queue.
- Running 3 instances means 3x worker throughput, with Redis ensuring each job is processed exactly once.

### Trade-offs
- Redis becomes a single point of failure. In production, use Redis Sentinel or Redis Cluster.
- PostgreSQL connection pooling needs tuning when running many instances (use PgBouncer).

---

## 6. Observability Stack

### Structured Logging (Pino)
- All log entries are JSON-formatted with ISO timestamps.
- Each log includes contextual data (jobId, userId, taskId) for correlation.
- In development, logs are human-readable via pino-pretty.

### Prometheus Metrics
Exposed on `/metrics`:
- `http_request_duration_seconds` - histogram of API response times
- `http_requests_total` - counter of total HTTP requests
- `bullmq_queue_length` - gauge of pending jobs per queue
- `websocket_connections_active` - gauge of connected WebSocket clients

These metrics can be scraped by Prometheus and visualized in Grafana.

### Load Testing
A k6 load test script (`load-test.js`) exercises:
- Health check endpoint
- Prometheus metrics endpoint
- Authentication flow (register + login)
- Task listing (GET)
- Task creation through queue (POST → 202)

---

## 7. Security Considerations

- **JWT tokens** with short expiry (15m access, 7d refresh) stored in DB for revocation.
- **bcrypt** with cost factor 12 for password hashing.
- **Helmet.js** for HTTP security headers.
- **CORS** restricted to configured frontend origin.
- **Input validation** on all endpoints before queue submission.
- **No raw SQL** – all queries go through Prisma's parameterized query builder.

---

## Summary of Technology Choices

| Component | Technology | Why |
|---|---|---|
| API Framework | Express.js | Simplicity, debugging ease, ecosystem |
| Database | PostgreSQL | ACID compliance, JSON support, Prisma compatibility |
| ORM | Prisma | Type-safe queries, schema migrations, developer experience |
| Queue | BullMQ + Redis | Battle-tested, retry/backoff/DLQ support, Node.js native |
| Real-time | Socket.io + Redis Adapter | Horizontal scaling, room-based broadcasting |
| AI | Groq SDK (Llama 3.3 70B) | Fast inference, JSON mode, cost-effective |
| State Management | Zustand | Lightweight, optimistic updates, no boilerplate |
| Logging | Pino | Fastest Node.js logger, structured JSON output |
| Metrics | prom-client | Prometheus ecosystem compatibility |
| Load Testing | k6 | Industry standard, scriptable, detailed reporting |

---

*Backend completely rebuilt from scratch in Express.js. Database schema and UI inspired by open-source project management tools.*
