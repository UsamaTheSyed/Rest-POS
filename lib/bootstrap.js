// Opt-in setup for disposable hosted demos. Never overwrite existing accounts.
export function bootstrapDemo(store, env = process.env) {
  if (env.DEMO_BOOTSTRAP !== '1' || !store.needsSetup()) return false;
  const keys = ['INITIAL_RESTAURANT', 'INITIAL_NAME', 'INITIAL_EMAIL', 'INITIAL_PASSWORD'];
  const missing = keys.filter(key => typeof env[key] !== 'string' || !env[key].trim());
  if (missing.length) throw new Error(`Demo setup requires environment variables: ${missing.join(', ')}`);
  store.setup({
    restaurant: env.INITIAL_RESTAURANT,
    name: env.INITIAL_NAME,
    email: env.INITIAL_EMAIL,
    password: env.INITIAL_PASSWORD
  });
  return true;
}
