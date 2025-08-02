# CollabFlow - Docker Deployment Guide

## Quick Start

```bash
# Create docker-compose.yml (see below)
docker compose up -d

# Access at http://localhost:3000 (backend) / http://localhost:3001 (frontend)
```

## What is CollabFlow?

CollabFlow is an event-driven AI workflow engine with real-time collaboration. Every write operation flows through BullMQ queues with idempotency, retry logic, and dead-letter queues. The AI orchestration layer uses Groq to break natural language prompts into structured tasks.

**Key Features:**
- ⚡ Event-driven architecture with BullMQ queues
- 🤖 AI workflow engine with schema validation and retry logic
- 🔄 Real-time sync via Socket.io with Redis adapter
- 🛡️ Idempotent write operations with 24h Redis-stored keys
- 📊 Prometheus metrics and structured Pino logging
- 🚀 Horizontally scalable stateless backend

## Docker Compose Setup (Recommended)

Create a `docker-compose.yml` file:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: collabflow
      POSTGRES_PASSWORD: collabflow_password_change_this
      POSTGRES_DB: collabflow
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U collabflow"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - collabflow-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass "redis_password_change_this"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - collabflow-network
    restart: unless-stopped

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://collabflow:collabflow_password_change_this@postgres:5432/collabflow
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: redis_password_change_this
      PORT: 3000
      JWT_SECRET: your-secure-jwt-secret-minimum-32-characters
      JWT_REFRESH_SECRET: your-secure-refresh-secret-minimum-32-characters
      JWT_EXPIRES_IN: 15m
      JWT_REFRESH_EXPIRES_IN: 7d
      CORS_ORIGIN: http://localhost:3001
      GROQ_API_KEY: your-groq-api-key
      LOG_LEVEL: info
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - collabflow-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))\""]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    environment:
      NEXT_PUBLIC_API_BASE_URL: http://localhost:3000/api
    ports:
      - "3001:3001"
    depends_on:
      - backend
    networks:
      - collabflow-network
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  collabflow-network:
    driver: bridge
```

### Start the Stack

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f backend

# Stop services
docker compose down

# Stop and remove all data
docker compose down -v
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@postgres:5432/collabflow` |
| `REDIS_HOST` | Redis hostname | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Your secure random string |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | Your secure random string |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `PORT` | `3000` | Backend port |
| `CORS_ORIGIN` | `http://localhost:3001` | CORS allowed origin |
| `GROQ_API_KEY` | _(empty)_ | Groq API key for AI orchestration |
| `REDIS_PASSWORD` | _(empty)_ | Redis password |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `JWT_EXPIRES_IN` | `15m` | JWT token expiration |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token expiration |

## Generating Secure Secrets

```bash
# Generate JWT secrets (32+ characters recommended)
openssl rand -base64 32

# Generate a random password
openssl rand -hex 16
```

## Health Check

The backend includes a health check endpoint:

```bash
curl http://localhost:3000/health
# → { "status": "ok", "timestamp": "...", "uptime": ... }

# Prometheus metrics
curl http://localhost:3000/metrics
```

## Backup and Restore

### Backup

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U collabflow collabflow > backup.sql
```

### Restore

```bash
# Restore PostgreSQL
docker compose exec -T postgres psql -U collabflow collabflow < backup.sql
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs backend

# Check health status
docker compose ps
```

### Database connection issues

```bash
# Verify PostgreSQL is healthy
docker compose ps postgres

# Test connection
docker compose exec postgres psql -U collabflow -d collabflow -c "SELECT 1;"
```

### Port conflicts

If port 3000 is already in use, change the port mapping:

```yaml
ports:
  - "8080:3000"  # Use port 8080 instead
```

## License

MIT License — see [LICENSE](../LICENSE) for details.

---

*Built by Aryan Aggarwal*
