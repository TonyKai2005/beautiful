import { buildApp } from "./app.ts";
import { config } from "./config.ts";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "stopping Mission Control API");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Mission Control API ready on http://127.0.0.1:${config.port}`);
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
