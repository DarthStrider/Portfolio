import pg from "pg";

// pg reads PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE from the environment,
// which docker-compose.yml and the Kubernetes manifests set.
export const pool = new pg.Pool({ max: 10 });

export type TaskRow = {
  id: number;
  title: string;
  done: boolean;
  createdAt: Date;
};

const COLUMNS = `id, title, done, created_at AS "createdAt"`;

/** Creates the table if needed. Retries because the database may still be starting up. */
export async function migrate(attempts = 30): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id         SERIAL PRIMARY KEY,
          title      VARCHAR(200) NOT NULL,
          done       BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`Database not ready (attempt ${i}/${attempts}), retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export const tasks = {
  async list(): Promise<TaskRow[]> {
    const { rows } = await pool.query<TaskRow>(`SELECT ${COLUMNS} FROM tasks ORDER BY id`);
    return rows;
  },
  async create(title: string): Promise<TaskRow> {
    const { rows } = await pool.query<TaskRow>(
      `INSERT INTO tasks (title) VALUES ($1) RETURNING ${COLUMNS}`,
      [title],
    );
    return rows[0];
  },
  async update(id: number, changes: { title?: string; done?: boolean }): Promise<TaskRow | undefined> {
    const { rows } = await pool.query<TaskRow>(
      `UPDATE tasks
          SET title = COALESCE($2, title),
              done  = COALESCE($3, done)
        WHERE id = $1
    RETURNING ${COLUMNS}`,
      [id, changes.title ?? null, changes.done ?? null],
    );
    return rows[0];
  },
  async remove(id: number): Promise<boolean> {
    const { rowCount } = await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
    return (rowCount ?? 0) > 0;
  },
};
