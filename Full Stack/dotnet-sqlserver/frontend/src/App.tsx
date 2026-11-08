import { type FormEvent, useEffect, useState } from "react";
import { api, type Task } from "./api";
import { STACK_LABEL } from "./config";

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [servedBy, setServedBy] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refresh() {
    setTasks(await api.list());
    // Which API pod answered: handy for seeing Kubernetes load-balance across replicas.
    setServedBy((await api.info()).hostname);
  }

  useEffect(() => {
    run(refresh).finally(() => setLoading(false));
  }, []);

  function add(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    run(async () => {
      await api.create(trimmed);
      setTitle("");
      await refresh();
    });
  }

  const remaining = tasks.filter((t) => !t.done).length;

  return (
    <main>
      <header>
        <h1>Task Tracker</h1>
        <p className="stack">{STACK_LABEL}</p>
      </header>

      <form onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          maxLength={200}
          aria-label="New task"
        />
        <button type="submit" disabled={!title.trim()}>Add</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="muted">No tasks yet. Add one above.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <li key={t.id} className={t.done ? "done" : ""}>
              <label>
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={() => run(async () => { await api.update(t.id, { done: !t.done }); await refresh(); })}
                />
                <span>{t.title}</span>
              </label>
              <button
                className="delete"
                aria-label={`Delete ${t.title}`}
                onClick={() => run(async () => { await api.remove(t.id); await refresh(); })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="muted">
        {tasks.length > 0 && <span>{remaining} of {tasks.length} left</span>}
        {servedBy && <span>API pod: <code>{servedBy}</code></span>}
      </footer>
    </main>
  );
}
