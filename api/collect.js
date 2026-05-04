const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'x-token, Content-Type');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers['x-token'] || '';
  const expected = process.env.COLLECT_TOKEN || '';
  if (!expected || token !== expected) return res.status(401).send('Unauthorized');

  const event = req.body;
  if (!event || typeof event !== 'object') return res.status(400).end();

  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const pipe = r.pipeline();
  pipe.rpush('events', JSON.stringify(event));
  pipe.ltrim('events', -5000, -1);
  await pipe.exec();

  return res.status(200).json({ ok: true });
};
