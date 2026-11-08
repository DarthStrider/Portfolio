import { MemoryRepo } from "../src/db/memory.ts";
import { contractTests } from "./contract.ts";

contractTests("memory", async () => new MemoryRepo());
