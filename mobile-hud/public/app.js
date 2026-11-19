const feed=document.getElementById('feed');
async function loadSessions(){const r=await fetch('/api/sessions');const d=await r.json();console.log('sessions',d.length);}
document.getElementById('send').onclick=async()=>{const t=document.getElementById('inp').value.trim();if(!t)return;const m=document.createElement('div');m.className='msg';m.textContent=t;feed.appendChild(m);document.getElementById('inp').value='';};
document.getElementById('plus').onclick=()=>{const s=document.getElementById('sheet');s.classList.remove('hidden');document.getElementById('sheetcontent').innerHTML='<p>Прикрепить / @файл / /команды</p>';};
document.getElementById('sheetbg').onclick=()=>document.getElementById('sheet').classList.add('hidden');
loadSessions();
// SSE
try{const es=new EventSource('/api/events');es.onmessage=e=>{console.log('evt',e.data);};}catch(e){}
// visibility sync
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadSessions();});
