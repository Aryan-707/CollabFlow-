import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import { redisConnection } from "../services/queue";
import IORedis from "ioredis";
import logger from "../utils/logger";
import { wsConnectionsGauge } from "../utils/metrics";
import jwt from "jsonwebtoken";

let io: SocketIOServer | null = null;

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "http://localhost:3001",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Set up Redis adapter for horizontal scaling
  try {
    const pubClient = new IORedis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
    });
    const subClient = pubClient.duplicate();

    io.adapter(createAdapter(pubClient, subClient) as any);
    logger.info("Socket.io Redis adapter configured");
  } catch (err) {
    logger.warn(
      { err },
      "Failed to set up Redis adapter for Socket.io, falling back to in-memory"
    );
  }

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "collabflow-secret-key"
      ) as any;
      (socket as any).userId = decoded.sub || decoded.userId;
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket as any).userId;
    logger.info({ socketId: socket.id, userId }, "Client connected");
    wsConnectionsGauge.inc();

    // Join user's personal room for notifications
    socket.join(`user:${userId}`);

    // Join a project room
    socket.on("join:project", (projectId: string) => {
      socket.join(`project:${projectId}`);
      logger.info({ socketId: socket.id, projectId }, "Joined project room");
    });

    // Leave a project room
    socket.on("leave:project", (projectId: string) => {
      socket.leave(`project:${projectId}`);
      logger.info({ socketId: socket.id, projectId }, "Left project room");
    });

    // Handle task updates from client (for optimistic UI)
    socket.on("task:update", (data: { taskId: string; changes: any; version: number }) => {
      // Broadcast to other clients in the same project room
      // The actual DB write goes through the queue via REST API
      socket.rooms.forEach((room) => {
        if (room.startsWith("project:")) {
          socket.to(room).emit("task:optimistic-update", {
            ...data,
            fromUser: userId,
          });
        }
      });
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, reason }, "Client disconnected");
      wsConnectionsGauge.dec();
    });
  });

  logger.info("Socket.io initialized");
  return io;
}
