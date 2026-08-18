import { CredentialCipher } from "./credentialCipher.js";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { ManagedGoogleService } from "./googleService.js";
import { ManagedStore } from "./managedStore.js";
import { ReliableSyncService } from "./reliableSyncService.js";

const config = loadConfig();
const database = new Database(config.databaseUrl);
await database.migrate();
const store = new ManagedStore(database, new CredentialCipher(config.encryptionKeys), config.sessionTtlDays);
const google = new ManagedGoogleService(config, store);
const reliable = new ReliableSyncService(config, database, store, google);

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await reliable.runDue();
  } catch (error) {
    console.error("Self-hosted reliability worker tick failed", error instanceof Error ? error.name : "unknown");
  } finally {
    running = false;
  }
}

void tick();
const timer = setInterval(() => { void tick(); }, 60_000);

async function shutdown(signal: string): Promise<void> {
  console.info(`Shutting down self-hosted reliability worker (${signal})`);
  clearInterval(timer);
  await database.close();
}

process.once("SIGINT", () => { void shutdown("SIGINT").then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown("SIGTERM").then(() => process.exit(0)); });
