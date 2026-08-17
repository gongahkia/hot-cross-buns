import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";

const config = loadConfig();
const database = new Database(config.databaseUrl);
await database.migrate();
const app = await buildApp(config, database);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down managed backend");
  await app.close();
  await database.close();
}

process.once("SIGINT", () => { void shutdown("SIGINT").then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown("SIGTERM").then(() => process.exit(0)); });

await app.listen({ host: "0.0.0.0", port: config.port });
