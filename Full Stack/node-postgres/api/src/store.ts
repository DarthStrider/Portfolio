/** A task as the API returns it. */
export type TaskRow = {
  id: number;
  title: string;
  done: boolean;
  createdAt: Date;
};

export type TaskChanges = { title?: string; done?: boolean };

/**
 * Everything the routes need from storage. PostgreSQL implements it in db.ts; the tests also run
 * the routes and the same contract against an in-memory version, so the HTTP layer can be tested
 * without a database.
 */
export interface TaskStore {
  list(): Promise<TaskRow[]>;
  create(title: string): Promise<TaskRow>;
  /** Undefined when no task has that id. */
  update(id: number, changes: TaskChanges): Promise<TaskRow | undefined>;
  /** False when no task has that id. */
  remove(id: number): Promise<boolean>;
  /** Throws if the database can't be reached (used by the readiness probe). */
  ping(): Promise<void>;
}
