import "dotenv/config";
import { createApp } from "./app.js";
import { getServerConfig } from "./config.js";
import { createDatabaseClient } from "./db/client.js";
import { checkDatabaseHealth } from "./db/health.js";
import { MessagePostRateLimiter } from "./services/messagePostRateLimit.js";

const config = getServerConfig();
const database = createDatabaseClient(config);
const app = createApp({
  db: database.db,
  checkDatabaseHealth: () => checkDatabaseHealth(database.pool),
  messagePostRateLimiter: new MessagePostRateLimiter(),
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `TLHN API listening on http://${config.host}:${config.port} (${config.nodeEnv}); polling=${config.pollingIntervalMs}ms countdown=${config.countdownDeadlineIso}`,
  );
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`Received ${signal}; shutting down TLHN API`);

  server.close(async (error) => {
    if (error) {
      console.error("Failed to close HTTP server cleanly", error);
      process.exitCode = 1;
    }

    try {
      await database.close();
    } catch (closeError) {
      console.error("Failed to close PostgreSQL pool cleanly", closeError);
      process.exitCode = 1;
    } finally {
      process.exit();
    }
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
