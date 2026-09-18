import { createApp } from "./app.js";
import { config, getStaticBearerToken, getStaticClientId } from "./config.js";
import { seedStaticClient } from "./state.js";
import { log } from "./logger.js";

seedStaticClient();
if (getStaticClientId()) log.dev("static OAuth client active (skip DCR available)");
if (getStaticBearerToken()) log.dev("static bearer token active");

const app = createApp();
app.listen(config.port, () => {
  log.dev(`MCP Test Server listening on :${config.port}`);
  log.dev(`MCP endpoint: ${config.mcpServerUrl}`);
  log.dev(`Issuer: ${config.issuerUrl}`);
  log.dev(`Dev dashboard: http://localhost:${config.port}/__dev`);
});
