const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  await r.del('events');
  await r.set('deploy_ts', String(Date.now() / 1000));

  return res.status(200).json({ ok: true });
};
