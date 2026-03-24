from http.server import BaseHTTPRequestHandler
import json, os, urllib.parse
from upstash_redis import Redis


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        since = float(params.get('since', ['0'])[0])
        limit = int(params.get('limit', ['150'])[0])

        r = Redis(url=os.environ['UPSTASH_REDIS_REST_URL'],
                  token=os.environ['UPSTASH_REDIS_REST_TOKEN'])

        fetch = min(limit * 4, 2000)
        raw = r.lrange('events', -fetch, -1) or []
        events = []
        for item in raw:
            try:
                ev = json.loads(item)
                if ev.get('ts', 0) > since:
                    events.append(ev)
            except Exception:
                pass

        events.reverse()  # newest first
        if len(events) > limit:
            events = events[:limit]

        body = json.dumps(events, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass
