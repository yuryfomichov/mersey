export function getRequiredEnv(env: NodeJS.ProcessEnv, name: string, owner: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}. Add it to the repo root .env file before starting the ${owner} provider.`);
  }

  return value;
}
