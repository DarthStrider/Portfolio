import { createApp } from "./app.js";
import { createPool, migrate, pgStore } from "./db.js";

const port = Number(process.env.PORT ?? 8080);

const pool = createPool();
await migrate(pool);
const server = createApp(pgStore(pool)).listen(port, () => console.log(`API listening on :${port}`));

// Kubernetes sends SIGTERM before stopping a pod: finish in-flight requests, then exit.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
