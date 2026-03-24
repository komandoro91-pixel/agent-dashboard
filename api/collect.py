from http.server import BaseHTTPRequestHandler
import json, os, time
from upstash_redis import Redis


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        token = self.headers.get('x-token', '')
        expected = os.environ.get('COLLECT_TOKEN', '')
        if expected and token != expected:
            self.send_response(401)
            self._cors()
            self.end_headers()
            self.wfile.write(b'Unauthorized')
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            event = json.loads(body)
        except Exception:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return

        r = Redis(url=os.environ['UPSTASH_REDIS_REST_URL'],
                  token=os.environ['UPSTASH_REDIS_REST_TOKEN'])
        pipe = r.pipeline()
        pipe.rpush('events', json.dumps(event, ensure_ascii=False))
        pipe.ltrim('events', -5000, -1)
        pipe.execute()

        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'x-token, Content-Type')
        self.send_header('Cache-Control', 'no-cache')

    def log_message(self, *a):
        pass
