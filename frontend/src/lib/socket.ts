import { io, Socket } from "socket.io-client";

class SocketService {
  private socket: Socket | null = null;
  private connected = false;

  connect(token: string) {
    if (this.socket?.connected) {
      console.log("[SocketService] Socket already connected");
      return;
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000/api";
    const socketUrl = apiUrl.replace("/api", "");

    console.log("[SocketService] Connecting to:", socketUrl);

    this.socket = io(socketUrl, {
      auth: {
        token,
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: 10,
    });

    this.socket.on("connect", () => {
      console.log("[SocketService] Socket connected:", this.socket?.id);
      this.connected = true;
    });

    this.socket.on("disconnect", (reason) => {
      console.log("[SocketService] Socket disconnected:", reason);
      this.connected = false;
    });

    this.socket.on("connect_error", (error) => {
      console.warn("[SocketService] Connection error — backend may be offline. Will retry automatically.");
      this.connected = false;
    });

    // User presence events
    this.socket.on("user:online", (data) => {
      window.dispatchEvent(new CustomEvent("user:online", { detail: data }));
    });

    this.socket.on("user:offline", (data) => {
      window.dispatchEvent(new CustomEvent("user:offline", { detail: data }));
    });

    // Task lifecycle events from BullMQ workers
    this.socket.on("task:created", (task) => {
      window.dispatchEvent(new CustomEvent("task:created", { detail: task }));
    });

    this.socket.on("task:updated", (task) => {
      window.dispatchEvent(new CustomEvent("task:updated", { detail: task }));
    });

    this.socket.on("task:deleted", (data) => {
      window.dispatchEvent(new CustomEvent("task:deleted", { detail: data }));
    });

    this.socket.on("task:conflict", (data) => {
      window.dispatchEvent(new CustomEvent("task:conflict", { detail: data }));
    });

    // Optimistic updates from other clients
    this.socket.on("task:optimistic-update", (data) => {
      window.dispatchEvent(new CustomEvent("task:optimistic-update", { detail: data }));
    });

    // Comment events
    this.socket.on("comment:created", (data) => {
      window.dispatchEvent(new CustomEvent("comment:created", { detail: data }));
    });

    // Notification events
    this.socket.on("notification:new", (notification) => {
      window.dispatchEvent(new CustomEvent("notification:new", { detail: notification }));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isConnected(): boolean {
    return this.connected && this.socket?.connected === true;
  }

  // Join a project room for real-time updates
  joinProject(projectId: string) {
    if (this.socket) {
      this.socket.emit("join:project", projectId);
    }
  }

  // Leave a project room
  leaveProject(projectId: string) {
    if (this.socket) {
      this.socket.emit("leave:project", projectId);
    }
  }

  // Emit optimistic task update for other connected clients
  emitTaskUpdate(taskId: string, changes: Record<string, any>, version: number) {
    if (this.socket) {
      this.socket.emit("task:update", { taskId, changes, version });
    }
  }

  // Subscribe to events
  on(event: string, callback: (...args: any[]) => void) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  // Unsubscribe from events
  off(event: string, callback?: (...args: any[]) => void) {
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  // Emit events
  emit(event: string, ...args: any[]) {
    if (this.socket) {
      this.socket.emit(event, ...args);
    }
  }
}

// Export singleton instance
export const socketService = new SocketService();

// Hook helper for React
export const initializeSocket = (token: string) => {
  socketService.connect(token);
};

export const disconnectSocket = () => {
  socketService.disconnect();
};

export const getSocket = () => socketService.getSocket();
