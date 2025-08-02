# CollabFlow

### Event-Driven AI Workflow Engine with Real-Time Collaboration

CollabFlow is a project management platform built around an event-driven architecture. Every write operation flows through BullMQ queues with idempotency, retry logic, and dead-letter queues. The AI orchestration layer uses Groq to break natural language prompts into structured, actionable tasks — with schema validation and automatic retries.

![Express.js](https://img.shields.io/badge/express-%5E4.21.0-000000.svg)
![TypeScript](https://img.shields.io/badge/typescript-%5E5.7.0-blue.svg)
![Next.js](https://img.shields.io/badge/nextjs-%5E16.0.0-black.svg)
![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue.svg)
![Redis](https://img.shields.io/badge/redis-7-red.svg)
![BullMQ](https://img.shields.io/badge/bullmq-%5E5.61.0-orange.svg)
![Socket.io](https://img.shields.io/badge/socket.io-%5E4.8.0-010101.svg)

## Architecture

```mermaid
graph LR
    Client["Next.js Frontend"] --> API["Express API :3000"]
    API --> Queue["Redis / BullMQ"]
    API --> Auth["JWT Auth"]
    Queue --> Workers["Background Workers"]
    Workers --> DB["PostgreSQL"]
    Workers --> Notify["Socket.io Events"]
    Notify --> PubSub["Redis Pub/Sub"]
    PubSub --> Client
    API --> AI["Groq AI (Llama 3.3)"]
    AI --> Queue
```

### How It Works

1. **Client** sends a request (create task, update project, etc.)
2. **API** validates input, checks idempotency, and adds a job to BullMQ — returns `202 Accepted`
3. **Worker** picks up the job, writes to PostgreSQL, and emits a Socket.io event
4. **All connected clients** receive the real-time update via Redis Pub/Sub

No API route directly writes to the database. Every mutation goes through the queue.

## Key Features

- **Event-Driven Architecture** — BullMQ queues with exponential backoff retries and dead-letter queue
- **Idempotency** — Every write operation uses Redis-stored idempotency keys (24h TTL) to prevent duplicates
- **AI Workflow Engine** — Natural language → structured tasks via Groq with schema validation and 2-retry logic
- **Real-Time Sync** — Socket.io with Redis adapter for horizontal scaling across multiple instances
- **Conflict Resolution** — Optimistic concurrency control with version fields and client rollback
- **Observability** — Prometheus metrics (`/metrics`), structured Pino logging, k6 load test script
- **Stateless Backend** — Horizontally scalable with shared Redis and PostgreSQL

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 16+
- Redis 7+

### Docker Setup (Recommended)

```bash
# Clone and start everything
git clone <your-repo-url> CollabFlow
cd CollabFlow
cp .env.example .env
docker compose up --build
```

This starts PostgreSQL, Redis, the backend (port 3000), and the frontend (port 3001).

### Manual Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your PostgreSQL and Redis connection details

# Run database migrations
cd backend
npx prisma migrate dev --name init
npx prisma generate

# Start backend (port 3000)
npm run dev

# In another terminal, start frontend (port 3001)
cd frontend
npm run dev
```

### Verify It Works

```bash
# Health check
curl http://localhost:3000/health
# → { "status": "ok", "timestamp": "...", "uptime": ... }

# Register a user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test123","firstName":"Test","lastName":"User"}'

# Create a task (returns 202 with jobId — processed by worker)
curl -X POST http://localhost:3000/api/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"title":"My first task","projectId":"<project-id>"}'
# → { "message": "Task creation queued", "jobId": "1", "idempotencyKey": "unique-key-123" }

# Prometheus metrics
curl http://localhost:3000/metrics
```

## Project Structure

```
CollabFlow/
├── backend/
│   ├── src/
│   │   ├── routes/         # Express route handlers (auth, tasks, projects, ai, etc.)
│   │   ├── services/       # Business logic (prisma, queue, ai, idempotency)
│   │   ├── workers/        # BullMQ workers (taskWorker, aiWorker, notificationWorker)
│   │   ├── sockets/        # Socket.io setup with Redis adapter
│   │   ├── middleware/      # JWT auth middleware
│   │   ├── utils/          # Logger (pino), Prometheus metrics
│   │   └── index.ts        # Express server entry point
│   ├── prisma/
│   │   └── schema.prisma   # Database schema
│   └── package.json
├── frontend/               # Next.js frontend
│   ├── src/
│   │   ├── components/     # React components (kanban, tasks, etc.)
│   │   ├── stores/         # Zustand stores (tasks, socket)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── contexts/       # React contexts
│   │   └── pages/          # Next.js pages
│   └── package.json
├── docker-compose.yml      # Full stack Docker Compose
├── load-test.js            # k6 load test script
├── SYSTEM_DESIGN_DEFENSE.md # Architecture decisions and trade-offs
└── README.md
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and get tokens |
| POST | `/api/auth/refresh` | Refresh access token |

### Tasks (All writes return 202 — queued)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (filter by projectId, status, priority) |
| GET | `/api/tasks/:id` | Get task details with comments |
| POST | `/api/tasks` | Queue task creation |
| PUT | `/api/tasks/:id` | Queue task update (with version for conflict detection) |
| DELETE | `/api/tasks/:id` | Queue task deletion |

### Projects (All writes return 202 — queued)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List user's projects |
| GET | `/api/projects/:id` | Get project details |
| POST | `/api/projects` | Queue project creation |
| PUT | `/api/projects/:id` | Queue project update |
| DELETE | `/api/projects/:id` | Queue project deletion |

### Comments (Writes return 202 — queued)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks/:id/comments` | List task comments |
| POST | `/api/tasks/:id/comments` | Queue comment creation |

### AI Orchestration
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/orchestrate` | Submit prompt → generates tasks via AI |
| GET | `/api/ai/job/:jobId` | Check AI job status |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

## Event-Driven Design

### Queue Architecture
```
POST /api/tasks ──→ taskQueue ──→ taskWorker ──→ PostgreSQL
                                      │
                                      ├──→ Socket.io (task:created)
                                      └──→ notificationQueue

POST /api/ai/orchestrate ──→ aiQueue ──→ aiWorker ──→ Groq API
                                              │
                                              └──→ taskQueue (for each AI-generated task)

Failed jobs (after 3 retries) ──→ failedQueue (dead-letter)
```

### Socket.io Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `task:created` | Server → Client | New task created by worker |
| `task:updated` | Server → Client | Task updated by worker |
| `task:deleted` | Server → Client | Task deleted by worker |
| `task:conflict` | Server → Client | Version conflict on update |
| `task:optimistic-update` | Client → Other Clients | Optimistic UI broadcast |
| `comment:created` | Server → Client | New comment on a task |
| `notification:new` | Server → Client | New notification for user |
| `join:project` | Client → Server | Join project room |
| `leave:project` | Client → Server | Leave project room |

## Load Testing

```bash
# Install k6: https://k6.io/docs/get-started/installation/
k6 run load-test.js

# With custom base URL
k6 run -e BASE_URL=http://your-server:3000 load-test.js
```

The load test ramps from 0 → 100 → 300 → 0 virtual users over 2 minutes, testing health checks, authentication, task listing, and queued task creation.

## Docker Compose Services

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| postgres | postgres:16 | 5432 | Primary database |
| redis | redis:7-alpine | 6379 | BullMQ queues + Socket.io Pub/Sub |
| backend | ./backend | 3000 | Express API + workers |
| frontend | ./frontend | 3001 | Next.js UI |

## Environment Variables

See `.env.example` for all available configuration options. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://collabflow:collabflow@localhost:5432/collabflow` |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret | Change in production |
| `GROQ_API_KEY` | Groq API key for AI orchestration | Required for AI features |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:3001` |

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*Backend completely rebuilt from scratch in Express.js; database schema and UI inspired by open-source project management tools.*
