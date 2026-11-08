/**
 * Runs the contract against a real PostgreSQL. Skipped unless PGHOST is set, e.g.:
 *   docker compose --profile test run --rm api-test
 * Uses its own database name (PGDATABASE), and wipes it between tests.
 */
import { test } from "node:test";
import { contractTests } from "./contract.ts";

if (process.env.PGHOST) {
  const { PostgresRepo } = await import("../src/db/postgres.ts");
  contractTests("postgres", async () => new PostgresRepo());
} else {
  test("postgres repository", { skip: "set PGHOST (and PGUSER, PGPASSWORD, PGDATABASE) to run" }, () => {});
}
