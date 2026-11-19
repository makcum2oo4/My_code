const http=require('http'),fs=require('fs'),path=require('path');
const BASE='http://127.0.0.1:4096';
const DIR='/workspaces/My_code';
const PORT=3000;
const PUB=path.join(__dirname,'public');
const CFG=path.join(__dirname,'hud-config.json');

function j(r){return r.json?r.json():Promise.resolve({});}
async function fetchJ(url,opts){const r=await fetch(url,opts);const t=await r.text();try{return {status:r.status,body:JSON.parse(t)};}catch{return {status:r.status,body:t};}}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://x');
  // ping
  if(url.pathname==='/api/ping'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,ts:Date.now()}));return;}
  // proxy pass-through to opencode (inject directory)
  if(url.pathname.startsWith('/api/oc/')){
    const p=url.pathname.replace('/api/oc','');
    const target=BASE+p+url.search;
    const opts={method:req.method,headers:{'Content-Type':req.headers['content-type']||'application/json'}};
    if(req.method!=='GET'&&req.method!=='DELETE'){let b='';for await(const c of req)b+=c;opts.body=b;}
    try{
      const r=await fetch(target,opts);
      const buf=Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json','Access-Control-Allow-Origin':'*'});
      res.end(buf);
    }catch(e){res.writeHead(502);res.end(JSON.stringify({error:e.message}));}
    return;
  }
  // static
  let fp=path.join(PUB,url.pathname==='/'?'/index.html':url.pathname);
  if(!fp.startsWith(PUB)){res.writeHead(403);res.end();return;}
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);res.end();return;}
    const ext=path.extname(fp);
    const ct={'html':'text/html','css':'text/css','js':'application/javascript','json':'application/json'}[ext.slice(1)]||'text/plain';
    res.writeHead(200,{'Content-Type':ct});res.end(d);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('HUD on 0.0.0.0:'+PORT));
