export type NodeEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  nodeEnv: NodeEnvironment;
  apiPort: number;
}

/** Validate startup inputs without leaking environment values in errors. */
export function parseRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (
    nodeEnv !== 'development' &&
    nodeEnv !== 'test' &&
    nodeEnv !== 'production'
  ) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const portInput = env.API_PORT ?? '3001';
  const apiPort = Number(portInput);
  if (
    !/^\d+$/.test(portInput) ||
    !Number.isSafeInteger(apiPort) ||
    apiPort < 1 ||
    apiPort > 65535
  ) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }

  return { nodeEnv, apiPort };
}
