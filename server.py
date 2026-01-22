import http.server
import socketserver
import sys
import os
PORT = int(sys.argv[1])
class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True
class COOPCOEPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()
if __name__ == '__main__':
    if len(sys.argv) > 2:
        os.chdir(sys.argv[2])
    socketserver.TCPServer.allow_reuse_address = True
    with ThreadedHTTPServer(("", PORT), COOPCOEPHandler) as httpd:
        print(f"Serving on port {PORT} with Multi-threaded Optimization")
        httpd.serve_forever()
