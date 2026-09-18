import { createApp } from "./app.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const app = createApp();
app.listen(config.port, () => {
  log.dev(`MCP Test Server listening on :${config.port}`);
  log.dev(`MCP endpoint: ${config.mcpServerUrl}`);
  log.dev(`Issuer: ${config.issuerUrl}`);
  log.dev(`Dev dashboard: http://localhost:${config.port}/__dev`);
});
