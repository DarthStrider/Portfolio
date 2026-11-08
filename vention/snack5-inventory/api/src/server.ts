/**
 * Entry point: connect to the database (retrying while it boots), create the schema,
 * seed the starting stock if the database is empty, then listen on PORT (8080).
 */
import { createServer } from "node:http";
import { createApp } from "./app.ts";
import { createRepo } from "./db/index.ts";
import { SEED_PARTS } from "./domain/seed.ts";

const port = Number(process.env.PORT ?? 8080);
const repo = await createRepo();

for (let attempt = 1; ; attempt++) {
  try {
    await repo.init();
    await repo.ping();
    break;
  } catch (err) {
    if (attempt >= 30) throw err;
    console.log(`Waiting for ${repo.kind} (attempt ${attempt}): ${(err as Error).message}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (await repo.seedIfEmpty(SEED_PARTS)) console.log(`Seeded ${SEED_PARTS.length} parts`);

const server = createServer(createApp(repo));
server.listen(port, () => console.log(`Inventory API on :${port}, database: ${repo.kind}`));

// Kubernetes sends SIGTERM before stopping a pod: finish in-flight requests, then close the pool.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await repo.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
