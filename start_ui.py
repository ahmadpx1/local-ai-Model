"""

    python start_ui.py

    http://localhost:8080
"""

import http.server
import socketserver
import webbrowser
import os

PORT = 8080


os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.js':  'application/javascript',
    '.css': 'text/css',
    '.html':'text/html',
})




webbrowser.open(f"http://localhost:{PORT}")

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    httpd.serve_forever()