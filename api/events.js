const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  const since = parseFloat(req.query.since || '0');
  const limit = parseInt(req.query.limit || '150', 10);

  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const fetch = Math.min(limit * 4, 2000);
  const raw = (await r.lrange('events', -fetch, -1)) || [];

  let events = [];
  for (const item of raw) {
    try {
      const ev = typeof item === 'string' ? JSON.parse(item) : item;
      if ((ev.ts || 0) > since) events.push(ev);
    } catch {}
  }

  events.reverse(); // newest first
  if (events.length > limit) events = events.slice(0, limit);

  return res.status(200).json(events);
};
