const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const ts = await r.get('last_release_ts');
  const note = await r.get('last_release_note');

  return res.status(200).json({ ts: ts ? parseFloat(ts) : null, note: note || null });
};
