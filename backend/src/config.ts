export interface ServerConfig {
  host: string;
  port: number;
  nodeEnv: string;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 8080;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST || "0.0.0.0",
    port: parsePort(env.PORT),
    nodeEnv: env.NODE_ENV || "development",
  };
}
