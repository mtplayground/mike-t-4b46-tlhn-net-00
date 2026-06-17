import { createApp } from "./app.js";
import { getServerConfig } from "./config.js";

const config = getServerConfig();
const app = createApp();

app.listen(config.port, config.host, () => {
  console.log(
    `TLHN API listening on http://${config.host}:${config.port} (${config.nodeEnv})`,
  );
});
