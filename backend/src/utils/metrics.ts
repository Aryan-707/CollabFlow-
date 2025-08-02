import client from "prom-client";

// Create a registry
const register = new client.Registry();

// Default metrics (GC, event loop, etc.)
client.collectDefaultMetrics({ register });

// HTTP request duration histogram
export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// HTTP requests total counter
export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// BullMQ queue length gauge
export const bullmqQueueLength = new client.Gauge({
  name: "bullmq_queue_length",
  help: "Current length of BullMQ queues",
  labelNames: ["queue_name"],
  registers: [register],
});

// Active WebSocket connections
export const wsConnectionsGauge = new client.Gauge({
  name: "websocket_connections_active",
  help: "Number of active WebSocket connections",
  registers: [register],
});

export { register };
