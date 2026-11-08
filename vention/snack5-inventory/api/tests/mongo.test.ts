/**
 * Runs the contract against a real MongoDB. Skipped unless MONGO_URL or MONGO_HOST is set, e.g.:
 *   docker compose --profile test run --rm api-test
 * Uses the "inventory_test" database, and wipes it between tests.
 */
import { test } from "node:test";
import { contractTests } from "./contract.ts";

if (process.env.MONGO_URL || process.env.MONGO_HOST) {
  const { MongoRepo } = await import("../src/db/mongo.ts");
  const { mongoUrl } = await import("../src/db/index.ts");
  contractTests("mongo", async () => new MongoRepo(mongoUrl(process.env), "inventory_test"));
} else {
  test("mongo repository", { skip: "set MONGO_URL or MONGO_HOST to run" }, () => {});
}
