# Stand-in for the app upstream on :3000. Adds its own Cache-Control so the test proves nginx replaces it.
import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'private')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 3000), functools.partial(H, directory='/www')).serve_forever()
