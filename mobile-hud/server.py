#!/usr/bin/env python3
import http.server, json, urllib.request, os, socketserver
BASE='http://127.0.0.1:4096'
DIR='/workspaces/My_code'
PORT=3000
PUB=os.path.join(os.path.dirname(__file__),'public')

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k):
        super().__init__(*a,directory=PUB,**k)
    def do_GET(self):
        if self.path=='/api/ping':
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            self.wfile.write(json.dumps({'ok':True,'ts':__import__('time').time()}).encode());return
        if self.path.startswith('/api/oc/'):
            target=BASE+self.path[len('/api/oc'):]
            try:
                r=urllib.request.urlopen(target)
                data=r.read()
                self.send_response(r.status);self.send_header('Content-Type',r.headers.get('Content-Type','application/json'));self.end_headers();self.wfile.write(data)
            except Exception as e:
                self.send_response(502);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'error':str(e)}).encode())
            return
        super().do_GET()
    def do_POST(self):
        if self.path.startswith('/api/oc/'):
            target=BASE+self.path[len('/api/oc'):]
            n=int(self.headers.get('Content-Length','0'))
            body=self.rfile.read(n) if n else b''
            req=urllib.request.Request(target,data=body,headers={'Content-Type':self.headers.get('Content-Type','application/json')},method='POST')
            try:
                r=urllib.request.urlopen(req)
                data=r.read()
                self.send_response(r.status);self.send_header('Content-Type',r.headers.get('Content-Type','application/json'));self.end_headers();self.wfile.write(data)
            except Exception as e:
                self.send_response(502);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'error':str(e)}).encode())
            return
        self.send_response(404);self.end_headers()
    def log_message(self,*a):pass

with socketserver.TCPServer(('0.0.0.0',PORT),H) as httpd:
    print('HUD on 0.0.0.0:'+str(PORT),flush=True)
    httpd.serve_forever()
