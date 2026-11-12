import { storeContract } from "./contract.js";
import { memoryStore } from "./memoryStore.js";

storeContract("memory", async () => memoryStore());
