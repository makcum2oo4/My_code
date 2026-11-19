#!/usr/bin/env python3
import http.server, json, urllib.request, os, socketserver, time, subprocess, threading

BASE='http://127.0.0.1:4096'
DIR='/workspaces/My_code'
PORT=3000
PUB=os.path.join(os.path.dirname(__file__),'public')
AUTH=os.path.expanduser('~/.local/share/opencode/auth.json')
CFG=os.path.expanduser('~/.config/opencode/opencode.json')
HUD=os.path.join(os.path.dirname(__file__),'hud-config.json')

def loadhud():
    try: return json.load(open(HUD))
    except: return {'maxTokens':900,'fallbackChain':[],'autoCompact':20}
def savehud(d): json.dump(d,open(HUD,'w'),indent=2)

def oc(path, method='GET', body=None):
    url=BASE+path
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(url,data=data,method=method)
    if data: req.add_header('Content-Type','application/json')
    try:
        r=urllib.request.urlopen(req)
        raw=r.read()
        try: return r.status,json.loads(raw)
        except: return r.status,raw.decode()
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: return e.code,json.loads(raw)
        except: return e.code,raw.decode()
    except Exception as e:
        return 502,{'error':str(e)}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a,directory=PUB,**k)
    def _json(self,code,obj):
        b=json.dumps(obj).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def _body(self):
        n=int(self.headers.get('Content-Length','0'))
        return json.loads(self.rfile.read(n)) if n else {}
    def do_GET(self):
        p=self.path.split('?')[0]
        if p=='/api/ping': self._json(200,{'ok':True,'ts':time.time()});return
        if p=='/api/sessions':
            code,data=oc('/session?directory='+DIR)
            self._json(code,data);return
        if p.startswith('/api/sessions/') and p.endswith('/messages'):
            sid=p.split('/')[3]
            code,data=oc('/session/'+sid+'/message')
            self._json(code,data);return
        if p=='/api/models':
            code,data=oc('/config/providers')
            self._json(code,{'providers':data,'hud':loadhud()});return
        if p=='/api/system':
            import shutil
            st=os.statvfs('/')
            free=st.f_bavail*st.f_frsize
            total=st.f_blocks*st.f_frsize
            load=os.getloadavg()[0] if hasattr(os,'getloadavg') else 0
            self._json(200,{'ram':{},'cpu':load,'disk_free_gb':round(free/1e9,2),'disk_total_gb':round(total/1e9,2)});return
        if p=='/api/preview':
            try:
                r=urllib.request.urlopen('http://127.0.0.1:8080',timeout=2); self._json(200,{'status':'UP'})
            except: self._json(200,{'status':'DOWN'});return
        if p=='/api/events':
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-cache');self.end_headers()
            try:
                r=urllib.request.urlopen(BASE+'/event')
                for line in r:
                    self.wfile.write(line);self.wfile.flush()
            except: pass
            return
        if p.startswith('/api/'):
            # generic proxy
            target=BASE+p[len('/api/oc'):] if p.startswith('/api/oc') else BASE+p[len('/api'):]
            code,data=oc(target.replace(BASE,''))
            self._json(code,data);return
        super().do_GET()
    def do_POST(self):
        p=self.path.split('?')[0]; body=self._body()
        if p=='/api/sessions':
            code,data=oc('/session',method='POST',body={'directory':DIR,'title':body.get('title','New session')})
            self._json(code,data);return
        if p.startswith('/api/sessions/') and p.endswith('/messages'):
            sid=p.split('/')[3]
            # abort? no
            code,data=oc('/session/'+sid+'/prompt_async',method='POST',body=body)
            self._json(code,data if not isinstance(data,str) else {'ok':True});return
        if p.startswith('/api/sessions/') and p.endswith('/abort'):
            sid=p.split('/')[3]; code,data=oc('/session/'+sid+'/abort',method='POST'); self._json(code,data);return
        if p.startswith('/api/sessions/') and p.endswith('/compact'):
            sid=p.split('/')[3]; code,data=oc('/session/'+sid+'/summarize',method='POST',body=body); self._json(code,data);return
        if p.startswith('/api/sessions/') and p.endswith('/revert'):
            sid=p.split('/')[3]; code,data=oc('/session/'+sid+'/revert',method='POST',body=body); self._json(code,data);return
        if p=='/api/keys':
            key=body.get('key','').strip()
            prefix='groq' if key.startswith('gsk_') else 'xai' if key.startswith('xai-') else 'openrouter' if key.startswith('sk-or-') else 'google' if key.startswith('AIza') else None
            if not prefix: self._json(400,{'error':'unknown prefix'});return
            # write
            d={}
            if os.path.exists(AUTH):
                try: d=json.load(open(AUTH))
                except: d={}
            d[prefix]=key
            os.makedirs(os.path.dirname(AUTH),exist_ok=True)
            json.dump(d,open(AUTH,'w'),indent=2); os.chmod(AUTH,0o600)
            # unlock providers
            c={}
            if os.path.exists(CFG):
                try: c=json.load(open(CFG))
                except: c={}
            c.pop('enabled_providers',None)
            c['disabled_providers']=['github-copilot']
            json.dump(c,open(CFG,'w'),indent=2)
            mask=key[:4]+'...'+key[-4:]
            self._json(200,{'provider':prefix,'mask':mask});return
        if p=='/api/preview':
            act=body.get('action')
            if act=='start':
                subprocess.Popen('cd /workspaces/My_code && (python3 -m http.server 8080 &) >/tmp/8080.log 2>&1',shell=True)
            elif act=='stop':
                subprocess.run('pkill -f "http.server 8080"',shell=True)
            elif act=='restart':
                subprocess.run('pkill -f "http.server 8080"',shell=True); time.sleep(0.5)
                subprocess.Popen('cd /workspaces/My_code && (python3 -m http.server 8080 &) >/tmp/8080.log 2>&1',shell=True)
            self._json(200,{'ok':True});return
        if p=='/api/restart-4096':
            subprocess.run('pkill -f "opencode web"',shell=True); time.sleep(1)
            subprocess.Popen('bash /workspaces/My_code/.devcontainer/start-opencode.sh',shell=True)
            self._json(200,{'ok':True});return
        self._json(404,{'error':'not found'})
    def do_DELETE(self):
        p=self.path.split('?')[0]
        if p.startswith('/api/sessions/'):
            sid=p.split('/')[3]; code,data=oc('/session/'+sid,method='DELETE'); self._json(code,data);return
        if p.startswith('/api/keys/'):
            prov=p.split('/')[3]
            d={}
            if os.path.exists(AUTH):
                try: d=json.load(open(AUTH))
                except: d={}
            d.pop(prov,None)
            json.dump(d,open(AUTH,'w'),indent=2)
            self._json(200,{'ok':True});return
        self._json(404,{'error':'not found'})
    def log_message(self,*a):pass

with socketserver.TCPServer(('0.0.0.0',PORT),H) as httpd:
    httpd.allow_reuse_address=True
    print('HUD on 0.0.0.0:'+str(PORT),flush=True)
    httpd.serve_forever()
EOF
echo done