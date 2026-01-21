import http.server 
import socketserver 
import sys 
PORT = int(sys.argv[1]) 
class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer): 
    daemon_threads = True 
    allow_reuse_address = True 
class NoCacheHandler(http.server.SimpleHTTPRequestHandler): 
    def end_headers(self): 
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0') 
        self.send_header('Pragma', 'no-cache') 
        self.send_header('Expires', '0') 
        super().end_headers() 
if __name__ == '__main__': 
    socketserver.TCPServer.allow_reuse_address = True 
    with ThreadedHTTPServer(("", PORT), NoCacheHandler) as httpd: 
        print(f"Serving on port {PORT} with Multi-threaded Optimization") 
        httpd.serve_forever() 
