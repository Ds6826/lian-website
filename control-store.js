const fs = require('node:fs');
const path = require('node:path');

const defaults = () => ({
  users: [],
  onboarding: {},
  apiKeys: [],
  projects: {},
});

const normalize = (value) => ({
  ...defaults(),
  ...(value && typeof value === 'object' ? value : {}),
});

function createControlStore({
  dataDir,
  vercel = false,
  redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  log = () => {},
} = {}) {
  const dataFile = path.join(dataDir, 'lian-console.json');
  const pendingWrites = new Set();
  let cache = null;
  let hydratedAt = 0;
  let redis = null;

  if (redisUrl && redisToken) {
    try {
      const { Redis } = require('@upstash/redis');
      redis = new Redis({ url: redisUrl, token: redisToken });
    } catch (error) {
      log('control_store_redis_init_failed', { error: error.message });
    }
  }

  const readFile = () => {
    try {
      return normalize(JSON.parse(fs.readFileSync(dataFile, 'utf8')));
    } catch {
      return defaults();
    }
  };

  const read = () => {
    if (!cache) cache = readFile();
    return cache;
  };

  const track = (promise) => {
    pendingWrites.add(promise);
    promise.finally(() => pendingWrites.delete(promise));
  };

  const write = (value) => {
    cache = normalize(value);
    if (redis) {
      const pending = redis
        .set('lians:control-plane:v1', cache)
        .catch((error) => log('control_store_redis_write_failed', { error: error.message }));
      track(pending);
      return;
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(cache, null, 2));
  };

  const hydrate = async ({ force = false } = {}) => {
    if (!redis) {
      if (!cache) cache = readFile();
      return cache;
    }
    if (!force && cache && Date.now() - hydratedAt < 1_000) return cache;
    try {
      const remote = await redis.get('lians:control-plane:v1');
      cache = normalize(remote || cache);
      hydratedAt = Date.now();
    } catch (error) {
      log('control_store_redis_read_failed', { error: error.message });
      if (!cache) cache = vercel ? defaults() : readFile();
    }
    return cache;
  };

  const flush = async () => {
    if (!pendingWrites.size) return;
    await Promise.allSettled([...pendingWrites]);
  };

  return {
    read,
    write,
    hydrate,
    flush,
    status: () => ({
      mode: redis ? 'upstash' : (vercel ? 'ephemeral-fallback' : 'local-file'),
      durable: Boolean(redis) || !vercel,
    }),
  };
}

module.exports = { createControlStore, defaults, normalize };
