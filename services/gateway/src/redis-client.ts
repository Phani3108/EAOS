/**
 * Redis client singleton for horizontal scaling.
 * Provides graceful fallback: returns null when Redis is unreachable so the
 * gateway stays operational in single-instance dev mode without Redis.
 */

import { createRequire } from 'module';

// Lazy import — ioredis may not be installed in all environments.
type IORedis = import('ioredis').Redis;

let _redis: IORedis | null = null;
let _attempted = false;

/** Redis is opt-in: without REDIS_URL the gateway runs single-instance and never dials out. */
export function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || undefined;
}

/**
 * Connect an ioredis client to REDIS_URL. The error listener is attached before connecting
 * (ioredis emits 'error' on every retry; an unlistened emitter crashes the log with
 * "Unhandled error event"), and a failed first connect is torn down so it stops retrying.
 */
export async function connectRedis(url: string): Promise<IORedis> {
  const { default: Redis } = await import('ioredis') as any;
  const client: IORedis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', (err: Error) => {
    if ((err as any).code !== 'ECONNREFUSED') {
      console.warn('[redis] connection error:', err.message);
    }
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    client.disconnect();
    throw err;
  }
}

export async function getRedis(): Promise<IORedis | null> {
  if (_attempted) return _redis;
  _attempted = true;

  const url = redisUrl();
  if (!url) return null;

  try {
    _redis = await connectRedis(url);
    console.info('[redis] connected');
    return _redis;
  } catch {
    console.warn('[redis] REDIS_URL is set but unreachable — running in single-instance mode');
    return null;
  }
}

export function getRedisSync(): IORedis | null {
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await (_redis as any).quit();
    _redis = null;
    _attempted = false;
  }
}
