# Dev server: like `python3 -m http.server` but tells the browser never to cache, so a reload
# always runs the latest code (ES modules are otherwise cached aggressively).
import http.server, sys
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8321
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
