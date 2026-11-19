document.getElementById('ping').onclick=async()=>{const r=await fetch('/api/ping');document.getElementById('out').textContent=await r.text();};
