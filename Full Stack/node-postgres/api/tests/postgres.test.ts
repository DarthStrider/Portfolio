import { after } from "node:test";
import { createPool, migrate, pgStore } from "../src/db.js";
import { storeContract } from "./contract.js";

// These tests empty the tasks table before each one, so they only run against a database whose
// name ends in "_test" (CI starts one; see the README for running it locally). Anything else is
// skipped, which keeps `npm test` from ever wiping your real tasks.
const database = process.env.PGDATABASE ?? "";
const skip = database.endsWith("_test") ? false : `set PGDATABASE to a database ending in _test (now "${database}")`;

const pool = skip ? undefined : createPool();
let migrated = false;

storeContract(
  "postgres",
  async () => {
    if (!migrated) {
      await migrate(pool!, 5);
      migrated = true;
    }
    await pool!.query("TRUNCATE tasks RESTART IDENTITY");
    return pgStore(pool!);
  },
  { skip },
);

after(async () => {
  await pool?.end();
});
