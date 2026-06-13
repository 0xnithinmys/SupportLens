import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  lazyConnect: true,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err: Error) => console.error('[Redis] Error:', err.message));

export default redis;
