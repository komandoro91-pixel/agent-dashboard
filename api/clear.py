from http.server import BaseHTTPRequestHandler
import json, os, time
from upstash_redis import Redis


class handler(BaseHTTPRequestHandler):

    def do_POST(self):
        r = Redis(url=os.environ['UPSTASH_REDIS_REST_URL'],
                  token=os.environ['UPSTASH_REDIS_REST_TOKEN'])
        r.delete('events')
        r.set('deploy_ts', str(time.time()))

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        self.do_POST()

    def log_message(self, *a):
        pass
