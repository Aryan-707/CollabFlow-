import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import useTaskStore from "../stores/useTaskStore";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace("/api", "") || "http://localhost:3000";

let socketInstance: Socket | null = null;

/**
 * Returns a shared Socket.io instance. Creates one if it doesn't exist yet.
 * Uses the JWT token from localStorage for authentication.
 */
function getSocket(token: string): Socket {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  socketInstance = io(SOCKET_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  return socketInstance;
}

/**
 * Hook that sets up Socket.io connection and binds all real-time events
 * to the Zustand task store. Handles task CRUD events, conflicts,
 * and notifications.
 */
export function useSocketIO(token: string | null, projectId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const { addTask, updateTask, removeTask, confirmUpdate, handleConflict } =
    useTaskStore();

  useEffect(() => {
    if (!token) return;

    const socket = getSocket(token);
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket.io] Connected:", socket.id);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket.io] Disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket.io] Connection error:", err.message);
    });

    // Task events from the server (processed by workers)
    socket.on("task:created", (task) => {
      addTask(task);
    });

    socket.on("task:updated", (task) => {
      confirmUpdate(task.id, task);
    });

    socket.on("task:deleted", ({ taskId }) => {
      removeTask(taskId);
    });

    // Conflict notification
    socket.on("task:conflict", ({ taskId, currentData }) => {
      handleConflict(taskId, currentData);
    });

    // Optimistic updates from other clients
    socket.on("task:optimistic-update", (data) => {
      if (data.fromUser !== getCurrentUserId()) {
        updateTask(data.taskId, data.changes);
      }
    });

    // Comment events
    socket.on("comment:created", ({ taskId, comment }) => {
      console.log(`[Socket.io] New comment on task ${taskId}:`, comment.id);
    });

    // Notification events
    socket.on("notification:new", (notification) => {
      console.log("[Socket.io] New notification:", notification.title);
    });

    return () => {
      socket.off("task:created");
      socket.off("task:updated");
      socket.off("task:deleted");
      socket.off("task:conflict");
      socket.off("task:optimistic-update");
      socket.off("comment:created");
      socket.off("notification:new");
    };
  }, [token, addTask, updateTask, removeTask, confirmUpdate, handleConflict]);

  // Join/leave project rooms when projectId changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !projectId) return;

    socket.emit("join:project", projectId);

    return () => {
      socket.emit("leave:project", projectId);
    };
  }, [projectId]);

  // Send optimistic update to other clients via socket
  const emitTaskUpdate = useCallback(
    (taskId: string, changes: Record<string, any>, version: number) => {
      const socket = socketRef.current;
      if (socket) {
        socket.emit("task:update", { taskId, changes, version });
      }
    },
    []
  );

  return { socket: socketRef.current, emitTaskUpdate };
}

/**
 * Utility to get the current user ID from localStorage.
 * Used to filter out our own optimistic updates from the socket stream.
 */
function getCurrentUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const userData = localStorage.getItem("user");
    if (userData) {
      return JSON.parse(userData).id;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export default useSocketIO;
