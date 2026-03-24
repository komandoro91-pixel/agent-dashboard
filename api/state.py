from http.server import BaseHTTPRequestHandler
import json, os, time
from upstash_redis import Redis


def compute_state(events, start_ts):
    sessions = {}
    pending = {}
    completed = {}

    for ev in events:
        if ev.get('ts', 0) < start_ts:
            continue
        if ev.get('event') == 'server_start':
            continue

        sid = ev.get('session_id', 'unknown')
        if sid not in sessions:
            sessions[sid] = {
                'session_id': sid,
                'session_type': ev.get('session_type', 'unknown'),
                'cwd': ev.get('cwd', ''),
                'status': 'active',
                'started_at': ev.get('ts', 0),
                'last_event_ts': ev.get('ts', 0),
                'tool_count': 0,
                'recent_tool': '',
                'active_agents': [],
            }

        sess = sessions[sid]
        ts = ev.get('ts', 0)
        if ts > sess['last_event_ts']:
            sess['last_event_ts'] = ts

        phase = ev.get('phase', '')
        tool = ev.get('tool', '')

        if phase == 'session_start':
            sess['status'] = 'active'
            sess['started_at'] = ts
            pending[sid] = []
        elif phase == 'session_end':
            sess['status'] = 'idle'
            pending[sid] = []
        elif phase == 'start':
            if tool != 'Agent':
                sess['tool_count'] += 1
                sess['recent_tool'] = tool
            if ev.get('is_agent'):
                key = f"{sid}_{ts}"
                if sid not in pending:
                    pending[sid] = []
                pending[sid].append({
                    'key': key,
                    'session_id': sid,
                    'agent_type': ev.get('agent_type', 'general-purpose'),
                    'description': ev.get('detail', ''),
                    'started_at': ts,
                })
        elif phase == 'end':
            if ev.get('is_agent') and sid in pending:
                agent_type = ev.get('agent_type', '')
                for i, ag in enumerate(pending[sid]):
                    if ag['agent_type'] == agent_type:
                        done_ag = pending[sid].pop(i)
                        done_ag['completed_at'] = ts
                        if sid not in completed:
                            completed[sid] = []
                        completed[sid].append(done_ag)
                        break

    for sid, sess in sessions.items():
        sess['active_agents'] = list(pending.get(sid, []))
        sess['completed_agents'] = list(completed.get(sid, []))[-20:]

    now = time.time()
    visible = [s for s in sessions.values() if now - s['last_event_ts'] < 300]
    total_active = sum(
        1 for s in visible
        if s['status'] == 'active' or s['active_agents']
    )

    return {
        'sessions': visible,
        'total_active': total_active,
        'server_ts': now,
    }


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        r = Redis(url=os.environ['UPSTASH_REDIS_REST_URL'],
                  token=os.environ['UPSTASH_REDIS_REST_TOKEN'])

        start_ts_raw = r.get('deploy_ts')
        if start_ts_raw:
            start_ts = float(start_ts_raw)
        else:
            start_ts = time.time()
            r.setnx('deploy_ts', str(start_ts))

        raw = r.lrange('events', -2000, -1) or []
        events = []
        for item in raw:
            try:
                events.append(json.loads(item))
            except Exception:
                pass

        data = compute_state(events, start_ts)
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass
