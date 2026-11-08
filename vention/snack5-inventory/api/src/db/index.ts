import type { DbKind, InventoryRepo } from "../domain/types.ts";
import { MemoryRepo } from "./memory.ts";

/**
 * Picks the database from the DB environment variable: "postgres", "mongo" or "memory".
 * The drivers are imported only when chosen, so the API runs with neither installed in memory mode.
 */
export async function createRepo(env: NodeJS.ProcessEnv = process.env): Promise<InventoryRepo> {
  const kind = (env.DB ?? "memory") as DbKind;
  switch (kind) {
    case "postgres": {
      const { PostgresRepo } = await import("./postgres.ts");
      return new PostgresRepo(); // reads PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT
    }
    case "mongo": {
      const { MongoRepo } = await import("./mongo.ts");
      return new MongoRepo(mongoUrl(env), env.MONGO_DB ?? "inventory");
    }
    case "memory":
      return new MemoryRepo();
    default:
      throw new Error(`DB must be postgres, mongo or memory, not "${kind}"`);
  }
}

export function mongoUrl(env: NodeJS.ProcessEnv): string {
  if (env.MONGO_URL) return env.MONGO_URL;
  const host = env.MONGO_HOST ?? "localhost";
  const auth = env.MONGO_USER ? `${encodeURIComponent(env.MONGO_USER)}:${encodeURIComponent(env.MONGO_PASSWORD ?? "")}@` : "";
  return `mongodb://${auth}${host}:27017/?authSource=admin`;
}
