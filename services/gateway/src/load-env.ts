import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../../../.env', import.meta.url));
if (process.env.NODE_ENV !== 'production' && process.env.EAOS_LOAD_ENV !== 'false' && existsSync(path)) {
  if (typeof process.loadEnvFile !== 'function') throw new Error('Node 20.12 or newer is required to load .env files');
  process.loadEnvFile(path);
}
