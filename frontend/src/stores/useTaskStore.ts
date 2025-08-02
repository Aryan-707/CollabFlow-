import { create } from "zustand";

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: string | null;
  version: number;
  projectId: string;
  createdBy?: string | null;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  subtasks?: Task[];
  _count?: { comments: number };
}

interface PendingUpdate {
  taskId: string;
  previousState: Task;
  changes: Partial<Task>;
}

interface TaskStore {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
  pendingUpdates: Map<string, PendingUpdate>;

  // Actions
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  removeTask: (taskId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Optimistic update methods
  optimisticUpdate: (taskId: string, changes: Partial<Task>) => void;
  rollback: (taskId: string) => void;
  confirmUpdate: (taskId: string, serverTask: Task) => void;

  // Conflict handling
  handleConflict: (taskId: string, serverData: Task) => void;
}

const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  isLoading: false,
  error: null,
  pendingUpdates: new Map(),

  setTasks: (tasks) => set({ tasks, isLoading: false }),

  addTask: (task) =>
    set((state) => ({
      tasks: [task, ...state.tasks],
    })),

  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })),

  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  // Apply change immediately in the UI before the server confirms
  optimisticUpdate: (taskId, changes) => {
    const { tasks, pendingUpdates } = get();
    const currentTask = tasks.find((t) => t.id === taskId);

    if (!currentTask) return;

    // Save previous state for potential rollback
    const newPending = new Map(pendingUpdates);
    newPending.set(taskId, {
      taskId,
      previousState: { ...currentTask },
      changes,
    });

    set({
      tasks: tasks.map((t) =>
        t.id === taskId ? { ...t, ...changes } : t
      ),
      pendingUpdates: newPending,
    });
  },

  // Revert to the state before the optimistic update
  rollback: (taskId) => {
    const { tasks, pendingUpdates } = get();
    const pending = pendingUpdates.get(taskId);

    if (!pending) return;

    const newPending = new Map(pendingUpdates);
    newPending.delete(taskId);

    set({
      tasks: tasks.map((t) =>
        t.id === taskId ? pending.previousState : t
      ),
      pendingUpdates: newPending,
    });
  },

  // Replace the optimistic data with the confirmed server data
  confirmUpdate: (taskId, serverTask) => {
    const { pendingUpdates } = get();
    const newPending = new Map(pendingUpdates);
    newPending.delete(taskId);

    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? serverTask : t
      ),
      pendingUpdates: newPending,
    }));
  },

  // Handle version conflict from server
  handleConflict: (taskId, serverData) => {
    const { pendingUpdates } = get();
    const newPending = new Map(pendingUpdates);
    newPending.delete(taskId);

    // Replace with server's version of the task
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? serverData : t
      ),
      pendingUpdates: newPending,
      error: `Conflict detected on task "${serverData.title}" — reverted to server state.`,
    }));
  },
}));

export default useTaskStore;
