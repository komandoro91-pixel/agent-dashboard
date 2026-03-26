const { Redis } = require('@upstash/redis');

function computeState(events, startTs) {
  const now = Date.now() / 1000;
  const sessions = {};
  const pending = {};
  const completed = {};

  for (const ev of events) {
    if ((ev.ts || 0) < startTs) continue;
    if (ev.event === 'server_start') continue;

    const sid = ev.session_id || 'unknown';
    if (!sessions[sid]) {
      sessions[sid] = {
        session_id: sid,
        session_type: ev.session_type || 'unknown',
        cwd: ev.cwd || '',
        status: 'active',
        started_at: ev.ts || 0,
        last_event_ts: ev.ts || 0,
        tool_count: 0,
        recent_tool: '',
        active_agents: [],
      };
    }

    const sess = sessions[sid];
    const ts = ev.ts || 0;
    if (ts > sess.last_event_ts) sess.last_event_ts = ts;

    const phase = ev.phase || '';
    const tool = ev.tool || '';

    if (phase === 'session_start') {
      sess.status = 'active';
      sess.started_at = ts;
      pending[sid] = [];
    } else if (phase === 'session_end') {
      sess.status = 'ended';
      pending[sid] = [];
    } else if (phase === 'start') {
      if (sess.status === 'ended') sess.status = 'active'; // реактивация после mid-session Stop
      if (tool !== 'Agent') {
        sess.tool_count += 1;
        sess.recent_tool = tool;
      }
      if (ev.is_agent) {
        const key = `${sid}_${ts}`;
        if (!pending[sid]) pending[sid] = [];
        pending[sid].push({
          key,
          session_id: sid,
          agent_type: ev.agent_type || 'general-purpose',
          description: ev.detail || '',
          started_at: ts,
        });
      }
    } else if (phase === 'end') {
      if (ev.is_agent && pending[sid]) {
        const agentType = ev.agent_type || 'general-purpose';
        const idx = pending[sid].findIndex(ag => ag.agent_type === agentType);
        if (idx >= 0) {
          const doneAg = pending[sid].splice(idx, 1)[0];
          doneAg.completed_at = ts;
          if (!completed[sid]) completed[sid] = [];
          completed[sid].push(doneAg);
        }
      }
    }
  }

  const AGENT_TTL_SEC = 600;
  for (const [sid, sess] of Object.entries(sessions)) {
    sess.active_agents = (pending[sid] || []).filter(ag => now - ag.started_at < AGENT_TTL_SEC);
    sess.completed_agents = (completed[sid] || []).slice(-20);
  }

  // Deduplicate: merge sessions from same cwd+type that started within 60s of each other
  // (VS Code creates 2 processes per tab with different session_ids)
  const groupMap = {};
  for (const sess of Object.values(sessions)) {
    const key = `${sess.cwd}|||${sess.session_type}`;
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(sess);
  }
  for (const group of Object.values(groupMap)) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.last_event_ts - a.last_event_ts);
    const primary = group[0];
    for (const dup of group.slice(1)) {
      if (Math.abs(primary.started_at - dup.started_at) < 300) {
        primary.tool_count += dup.tool_count;
        primary.started_at = Math.min(primary.started_at, dup.started_at);
        primary.active_agents.push(...dup.active_agents);
        primary.completed_agents.push(...dup.completed_agents);
        dup.status = 'ended';
      }
    }
  }

  const visible = Object.values(sessions).filter(
    s => s.status !== 'ended' && now - s.last_event_ts < 300
  );
  const total_active = visible.filter(
    s => s.status === 'active' || s.active_agents.length > 0
  ).length;

  const active_penguins = visible.flatMap(s => s.active_agents);
  return { sessions: visible, active_penguins, total_active, server_ts: now };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  const r = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const startTsRaw = await r.get('deploy_ts');
  let startTs;
  if (startTsRaw) {
    startTs = parseFloat(startTsRaw);
  } else {
    startTs = Date.now() / 1000;
    await r.setnx('deploy_ts', String(startTs));
  }

  const raw = (await r.lrange('events', -2000, -1)) || [];
  const events = [];
  for (const item of raw) {
    try {
      events.push(typeof item === 'string' ? JSON.parse(item) : item);
    } catch {}
  }

  return res.status(200).json(computeState(events, startTs));
};

module.exports.computeState = computeState;
