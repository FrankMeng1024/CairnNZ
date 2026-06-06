"""
Simple dev server for Cairn Feature Map.
Serves static files + POST /save-data to write changes back to data.js
"""
import http.server
import json
import os
import re
import sys

PORT = int(os.environ.get("PORT", 7788))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JS  = os.path.join(BASE_DIR, 'js', 'data.js')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Never cache JS or CSS so edits are reflected on next page load
        if self.path and (self.path.endswith('data.js') or self.path.endswith('.js') or '.js?' in self.path or self.path.endswith('.css') or '.css?' in self.path):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_POST(self):
        if self.path != '/save-data':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            state = json.loads(body)
        except json.JSONDecodeError as e:
            self._json(400, {'ok': False, 'error': str(e)})
            return
        try:
            _write_data_js(state)
            self._json(200, {'ok': True})
        except Exception as e:
            self._json(500, {'ok': False, 'error': str(e)})

    def _json(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(payload))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, fmt, *args):
        # suppress noisy GET logs, keep errors
        if args and str(args[1]) not in ('200', '304'):
            super().log_message(fmt, *args)


def _write_data_js(state):
    """Overwrite DEFAULT_DATA in data.js with the new state."""
    with open(DATA_JS, 'r', encoding='utf-8', newline='') as f:
        content = f.read()

    pretty = json.dumps(state, ensure_ascii=False, indent=2)
    m = re.search(r'const DEFAULT_DATA\s*=\s*\{.*?\n\};', content, re.DOTALL)
    if not m:
        raise ValueError('Could not find DEFAULT_DATA block to replace')
    replacement = 'const DEFAULT_DATA = ' + pretty + ';'
    new_content = content[:m.start()] + replacement + content[m.end():]
    with open(DATA_JS, 'w', encoding='utf-8', newline='') as f:
        f.write(new_content)


if __name__ == '__main__':
    os.chdir(BASE_DIR)
    print(f'Cairn Feature Map server on http://localhost:{PORT}')
    httpd = http.server.HTTPServer(('', PORT), Handler)
    httpd.serve_forever()
