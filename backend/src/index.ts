import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import pinoHttp from "pino-http";
import logger from "./utils/logger";
import {
  register,
  httpRequestDuration,
  httpRequestsTotal,
  bullmqQueueLength,
} from "./utils/metrics";
import { swaggerSpec } from "./utils/swagger";
import swaggerUi from "swagger-ui-express";
import { getQueueLengths } from "./services/queue";
import { initSocketIO } from "./sockets";
import { authMiddleware } from "./middleware/auth";

// Routes
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import projectRoutes from "./routes/projects";
import taskRoutes from "./routes/tasks";
import commentRoutes from "./routes/comments";
import aiRoutes from "./routes/ai";

// Workers - import to start them
import "./workers/taskWorker";
import "./workers/aiWorker";
import "./workers/notificationWorker";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3001",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Structured HTTP logging
app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => {
        // Don't log health checks and metrics
        const url = (req as any).url || "";
        return url === "/health" || url === "/metrics";
      },
    },
  })
);

// Request duration tracking for Prometheus
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };
    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });
  next();
});

// --- Server Landing / Waking Up Route ---
const startedAt = new Date();
app.get("/", (_req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

  res.json({
    name: "CollabFlow API",
    version: "1.0.0",
    description: "Event-Driven AI Workflow Engine with Real-Time Collaboration",
    status: "running",
    startedAt: startedAt.toISOString(),
    uptime: uptimeStr,
    documentation: "/api-docs",
    health: "/health",
    metrics: "/metrics",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      projects: "/api/projects",
      tasks: "/api/tasks",
      ai: "/api/ai/orchestrate",
    },
    message: "Server is awake and ready to accept requests.",
  });
});

// --- Health Check ---
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// --- Swagger API Documentation ---
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'CollabFlow API Documentation',
}));

// --- Prometheus Metrics ---
app.get("/metrics", async (_req, res) => {
  try {
    // Update queue length gauges before returning metrics
    const queueLengths = await getQueueLengths();
    for (const { name, length } of queueLengths) {
      bullmqQueueLength.set({ queue_name: name }, length);
    }

    res.set("Content-Type", register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (err) {
    logger.error({ err }, "Failed to collect metrics");
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

// --- Public Routes (no auth) ---
app.use("/api/auth", authRoutes);

// --- Protected Routes ---
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/projects", authMiddleware, projectRoutes);
app.use("/api/tasks", authMiddleware, taskRoutes);
app.use("/api/tasks/:taskId/comments", authMiddleware, commentRoutes);
app.use("/api/ai", authMiddleware, aiRoutes);

// --- 404 handler ---
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// --- Global error handler ---
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// --- Start server ---
const httpServer = createServer(app);

// Initialize Socket.io
initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, `CollabFlow backend running on port ${PORT}`);
  logger.info(`📚 Swagger docs: http://localhost:${PORT}/api-docs`);
  logger.info(`💓 Health check: http://localhost:${PORT}/health`);
  logger.info("Workers started: taskWorker, aiWorker, notificationWorker");
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  httpServer.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
