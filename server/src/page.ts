// Mobile-first review page. Server sends a shell; the client renders /api/review.
const css = `
:root{--bg:#f6f0e3;--card:#fffaf0;--ink:#2b2622;--muted:#8a8072;--line:#e6dccb;--accent:#c4573a;--ok:#3e7d5a;--warn:#b07a1f;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-text-size-adjust:100%}
header{position:sticky;top:0;z-index:5;background:rgba(246,240,227,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:10px 14px 0}
.top{display:flex;align-items:center;gap:10px}
.top h1{font-size:18px;margin:0;flex:1;letter-spacing:-.01em}
.top h1 img{width:26px;height:26px;vertical-align:-7px;margin-right:6px}
.ci{font-size:12px;color:var(--muted);margin:6px 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ci a{color:inherit}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:4px}
.dot.ok{background:var(--ok)}.dot.run{background:var(--warn)}.dot.bad{background:var(--accent)}
nav{display:flex;gap:4px}
nav button{flex:1;border:0;background:none;padding:10px 4px;font:inherit;font-size:14px;color:var(--muted);border-bottom:2px solid transparent}
nav button.on{color:var(--ink);border-color:var(--ink);font-weight:600}
main{padding:12px;max-width:760px;margin:0 auto}
button.pri,button.sec{font:inherit;border-radius:10px;padding:9px 14px;border:1px solid var(--ink);cursor:pointer}
button.pri{background:var(--ink);color:#fff}
button.pri:disabled{opacity:.35}
button.sec{background:transparent;color:var(--ink)}
button.ghost{font:inherit;font-size:13px;background:none;border:0;color:var(--muted);text-decoration:underline;padding:6px}
.search{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--card)}
.inbox{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.row-i{display:grid;grid-template-columns:36px 1fr auto auto auto;gap:8px;align-items:center;padding:8px 10px;border-top:1px solid var(--line)}.row-i:first-child{border-top:0}
.row-i img{width:36px;height:36px;border-radius:9px}.row-i .t{min-width:0}.row-i .t b{display:block;font-size:14px}.row-i small{display:block;color:var(--muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pf{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.02em;padding:1px 6px;border-radius:99px;margin-left:6px;vertical-align:1px;background:#e3ead9;color:#3e5a2f}
.pf.mac{background:#e2e3ef;color:#3b3f6b}
.row-s{padding:10px;border-top:1px solid var(--line);background:#fbf3df}.row-s:first-child{border-top:0}
.row-s .pair{display:flex;align-items:center;gap:10px}
.row-s .pair img{width:40px;height:40px;border-radius:10px;flex:none;background:#fff}
.row-s .pair .arrow{color:var(--muted);font-size:13px;flex:none}
.row-s .pair .t{min-width:0;flex:1}.row-s .pair b{font-size:14px}.row-s small{display:block;color:var(--muted);font-size:11px}
.row-s .acts{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center}
.macrow{display:flex;gap:14px;align-items:center;background:linear-gradient(160deg,#6d8fb5,#a7b9c9);border-radius:12px;padding:10px 12px;margin:8px 0 4px;overflow-x:auto}
.macrow .lbl{color:#fff;font-size:11px;opacity:.9;min-width:44px}
.macrow img{width:64px;height:64px;display:block;flex:none}
.macrow figure{margin:0;text-align:center;color:#fff;font-size:10px;opacity:.95}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:14px}
.head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.head img{width:40px;height:40px;border-radius:10px}
.head .t{flex:1;min-width:0}
.head b{display:block}
.head small{color:var(--muted);font-size:12px;word-break:break-all}
.tag{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--line);color:var(--ink);white-space:nowrap}
.tag.drafted{background:#f1d9a7}.tag.generating,.tag.requested,.tag.queued{background:#dfe6ef}.tag.failed{background:#f3c7bb}.tag.approved{background:#cfe5d6}.tag.published{background:#cfe5d6}
.vars{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.var{text-align:center}
.var img.big{width:100%;aspect-ratio:1;display:block}
.var .acts{display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap}
.var img.big{border-radius:6px}.var.sel img.big{outline:3px solid var(--ok);outline-offset:3px}
.strip{display:grid;grid-template-columns:auto repeat(3,1fr);gap:10px 6px;align-items:center;justify-items:center;background:#3a4a3f url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Ccircle cx='1' cy='1' r='.6' fill='%23ffffff18'/%3E%3C/svg%3E");border-radius:12px;padding:14px 8px 8px;margin:12px 0 4px}
.strip .lbl{color:#fff;font-size:11px;opacity:.8;justify-self:start}
.ic{width:48px;height:48px;display:block;object-fit:cover}
.ic.circle{border-radius:50%}.ic.squircle{border-radius:34%}.ic.square{border-radius:3px}
.ic.orig{object-fit:contain;border-radius:0}
.note{display:none;margin-top:10px}
.note.open{display:block}
.note textarea{width:100%;min-height:70px;font:inherit;border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff}
.note .row{display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap}
.foot{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
.err{font-size:12px;color:var(--accent);margin-top:6px;word-break:break-word}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px}
.gal .g{text-align:center;font-size:12px}
.gal img{width:100%;aspect-ratio:1}
.gal small{color:var(--muted);display:block}
.empty{color:var(--muted);text-align:center;padding:40px 10px}
details{margin-top:10px;font-size:13px;color:var(--muted)}
details .vars{grid-template-columns:repeat(4,1fr);margin-top:8px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;max-width:90vw}
.toast.on{opacity:1}
@media (min-width:600px){.vars{grid-template-columns:1fr 1fr}}
`;

const js = `
let data=null, tab=localStorage.km_tab||'inbox', openNote={}, filter='';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(m){const t=$('.toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2600)}
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText);return j}
async function load(){try{data=await api('/api/review');render()}catch(e){toast(e.message)}}
const img=f=>'/img/drafts/'+encodeURIComponent(f);
const orig=a=>a.original?'/img/originals/'+encodeURIComponent(a.original):'';
function ci(){
  const c=data.ci||{};const r=(c.runs||[])[0];
  let s='';
  if(r){const cls=r.status!=='completed'?'run':r.conclusion==='success'?'ok':'bad';
    s+='<span><span class="dot '+cls+'"></span><a href="'+esc(r.url)+'" target="_blank">CI '+esc(r.status==='completed'?r.conclusion:r.status)+'</a> · '+esc(r.headSha.slice(0,7))+'</span>'}
  if(c.release)s+='<span>Latest <a href="'+esc(c.release.url)+'" target="_blank">'+esc(c.release.tagName)+'</a></span>';
  const p=(data.publishes||[])[0];
  if(p&&p.status==='failed')s+='<span class="err">Last publish failed: '+esc((p.error||'').slice(0,140))+'</span>';
  if(data.busy)s+='<span><span class="dot run"></span>Generating '+esc(data.busy)+'…</span>';
  return s||'<span>No CI runs yet</span>';
}
const pfs=a=>(a.platforms&&a.platforms.length?a.platforms:[a.platform||'android']).map(p=>'<span class="pf '+p+'">'+(p==='mac'?'Mac':'Android')+'</span>').join('');
const macv=v=>'/img/macv/'+v.id+'.png';
function macRow(list){return '<div class="macrow"><span class="lbl">macOS</span>'+list.map(v=>'<figure><img loading="lazy" src="'+macv(v)+'" alt="macOS icon"><figcaption>#'+v.idx+'</figcaption></figure>').join('')+'</div>'}
const SHAPES=['circle','squircle','square'];
function shapes(label,src){return '<span class="lbl">'+label+'</span>'+SHAPES.map(k=>'<img class="ic '+k+'" src="'+src+'" alt="'+k+'">').join('')}
function frame(src){return src?'<img class="ic orig" src="'+src+'">':''}
function draftCard(a){
  const latest=a.variants.filter(v=>v.round===a.round), older=a.variants.filter(v=>v.round!==a.round);
  const busy=a.status==='generating'||a.status==='queued';
  let h='<div class="card" id="c-'+a.drawable+'"><div class="head">'+(a.original?'<img src="'+orig(a)+'">':'')+
    '<div class="t"><b>'+esc(a.label)+pfs(a)+'</b><small>'+esc(a.components.join(', ')||a.package)+'</small></div><span class="tag '+a.status+'">'+
    (a.status==='queued'&&a.note?'regenerating':a.status)+'</span></div>';
  if(latest.length){
    h+='<div class="vars">'+latest.map(v=>'<div class="var'+(a.approved_variant===v.id?' sel':'')+'"><img class="big" loading="lazy" src="'+img(v.png)+'">'+
      '<div class="acts">'+(busy?'':'<button class="pri" onclick="approve(\\''+a.drawable+'\\','+v.id+')">Approve '+v.idx+'</button>'+
      '<button class="sec" onclick="noteFor(\\''+a.drawable+'\\','+v.id+')">Note</button>')+'</div></div>').join('')+'</div>';
    h+='<div class="strip"><span></span>'+SHAPES.map(k=>'<span class="lbl" style="justify-self:center">'+k+'</span>').join('')+
      (a.original?'<span class="lbl">original</span><span></span>'+frame(orig(a))+'<span></span>':'')+
      latest.map(v=>shapes('#'+v.idx,img(v.png))).join('')+'</div>';
    if((a.platforms||[]).includes('mac'))h+=macRow(latest);
  } else if(busy){h+='<div class="empty">'+(a.status==='generating'?(a.note?'Redrawing alone, 2 variants (about 10 min)…':'Drawing in a batch grid (about 5 min)…'):(a.note?'Queued for a redraw':'Queued. Batches start 45 s after your last Generate tap, up to 9 apps per grid'))+'</div>'}
  if(a.status==='queued')h+='<div class="foot"><button class="ghost" onclick="unqueue(\\''+a.drawable+'\\')">Cancel</button></div>';
  if(a.status==='queued'&&a.note)h+='<div class="err" style="color:var(--muted)">Note: '+esc(a.note)+'</div>';
  if(a.error)h+='<div class="err">'+esc(a.error.slice(0,300))+'</div>';
  const n=openNote[a.drawable];
  h+='<div class="note'+(n!==undefined?' open':'')+'"><textarea id="n-'+a.drawable+'" placeholder="What should change? e.g. bigger phone glyph, less cream, lean more">'+'</textarea>'+
    '<div class="row"><button class="pri" onclick="regen(\\''+a.drawable+'\\')">Regenerate</button><small style="color:var(--muted)">'+
    (n?'about variant '+(a.variants.find(v=>v.id===n)||{}).idx:'about both')+'</small><button class="ghost" onclick="closeNote(\\''+a.drawable+'\\')">cancel</button></div></div>';
  if(!busy)h+='<div class="foot"><button class="ghost" onclick="noteFor(\\''+a.drawable+'\\',0)">Regenerate…</button><button class="ghost" onclick="skip(\\''+a.drawable+'\\')">Skip app</button></div>';
  if(older.length)h+='<details><summary>Earlier rounds ('+older.length+')</summary><div class="vars">'+older.map(v=>'<div class="var"><img class="big" loading="lazy" src="'+img(v.png)+'"><button class="ghost" onclick="approve(\\''+a.drawable+'\\','+v.id+')">use r'+v.round+'#'+v.idx+'</button></div>').join('')+'</div></details>';
  return h+'</div>';
}
function gallery(list,restore){
  if(!list.length)return '<div class="empty">Nothing here yet.</div>';
  return '<div class="gal">'+list.map(a=>{const v=a.variants.find(v=>v.id===a.approved_variant);
    const mac=(a.platforms||[]).includes('mac');
    return '<div class="g">'+(v?(mac?'<img loading="lazy" src="'+macv(v)+'">':'<img loading="lazy" style="border-radius:34%" src="'+img(v.png)+'">'):frame(orig(a)))+'<b>'+esc(a.label)+'</b><small>'+esc(a.status)+'</small><div>'+pfs(a)+'</div>'+
      (restore&&a.status!=='published'?'<button class="ghost" onclick="restore(\\''+a.drawable+'\\')">'+(a.status==='approved'?'unapprove':'restore')+'</button>':'')+'</div>'}).join('')+'</div>';
}
function inbox(list){
  if(!list.length)return '<div class="empty">Inbox is empty. Request icons from the kudmascot app on your phone or Mac.</div>';
  const f=(filter||'').toLowerCase(), shown=list.filter(a=>!f||(a.label+' '+a.package).toLowerCase().includes(f));
  return '<input class="search" placeholder="Filter '+list.length+' requested apps" value="'+esc(filter)+'" oninput="filter=this.value;render();const i=document.querySelector(\\'.search\\');i.focus();i.setSelectionRange(i.value.length,i.value.length)">'+
    '<div class="inbox">'+shown.map(a=>a.suggestion?suggestRow(a):'<div class="row-i">'+(a.original?'<img src="'+orig(a)+'">':'<span></span>')+
    '<div class="t"><b>'+esc(a.label)+pfs(a)+'</b><small>'+esc(a.package)+'</small></div>'+
    '<button class="pri" onclick="queue(\\''+a.drawable+'\\')">Generate</button>'+
    '<button class="ghost" title="Generate with a hint" onclick="queueHint(\\''+a.drawable+'\\')">…</button>'+
    '<button class="ghost" onclick="skip(\\''+a.drawable+'\\')">Skip</button></div>').join('')+'</div>';
}
function suggestRow(a){
  const t=a.suggestion, tsrc=t.png?img(t.png):(t.original?'/img/originals/'+encodeURIComponent(t.original):'');
  const tp=(t.platforms||[]).map(p=>p==='mac'?'Mac':'Android').join(' + ')||'—';
  return '<div class="row-s"><div class="pair">'+(a.original?'<img src="'+orig(a)+'" alt="this app">':'')+'<span class="arrow">≈</span>'+
    (tsrc?'<img src="'+tsrc+'" alt="existing drawing"'+(t.png?' style="border-radius:34%"':'')+'>':'')+
    '<div class="t"><b>'+esc(a.label)+pfs(a)+'</b><small>'+esc(a.package)+'</small><small>Same as <b>'+esc(t.label)+'</b> ('+esc(tp)+', '+esc(t.status)+') · '+esc(t.reason||'')+'</small></div></div>'+
    '<div class="acts"><button class="pri" onclick="merge(\\''+a.drawable+'\\',\\''+t.drawable+'\\')">Use same drawing</button>'+
    '<button class="sec" onclick="separate(\\''+a.drawable+'\\')">Draw separately</button>'+
    '<button class="ghost" onclick="skip(\\''+a.drawable+'\\')">Skip</button></div></div>';
}
async function merge(d,t){try{const r=await api('/api/apps/'+d+'/merge',{target:t});toast(['approved','published'].includes(r.status)?'Using the same drawing. It is already approved, so it applies now':'Using the same drawing');load()}catch(e){toast(e.message)}}
async function separate(d){try{await api('/api/apps/'+d+'/separate',{});toast('Queued to draw separately');load()}catch(e){toast(e.message)}}
function render(){
  const q=data.apps.filter(a=>['drafted','generating','queued','failed'].includes(a.status));
  const inb=data.apps.filter(a=>a.status==='requested').sort((x,y)=>x.label.localeCompare(y.label));
  q.sort((x,y)=>(x.status==='drafted'?0:1)-(y.status==='drafted'?0:1));
  const appr=data.apps.filter(a=>a.status==='approved'||a.status==='published');
  const sk=data.apps.filter(a=>a.status==='skipped');
  const n=data.pending.apps, nc=data.pending.components;
  $('#pub').textContent=data.publishing?'Publishing…':'Publish '+n+' approved'+(nc&&!n?' ('+nc+' mappings)':'');
  $('#pub').disabled=data.publishing||(!n&&!nc);
  $('.ci').innerHTML=ci();
  document.querySelectorAll('nav button').forEach(b=>{b.classList.toggle('on',b.dataset.t===tab);
    b.textContent=b.dataset.l+' '+({inbox:inb.length,review:q.filter(a=>a.status==='drafted').length+'/'+q.length,gallery:appr.length,skipped:sk.length})[b.dataset.t]});
  const keep={};document.querySelectorAll('textarea').forEach(t=>keep[t.id]=t.value);
  $('main').innerHTML=tab==='inbox'?inbox(inb):tab==='review'?(q.length?q.map(draftCard).join(''):'<div class="empty">Nothing generating or waiting for review. Pick apps to generate from the Inbox.</div>')
    :tab==='gallery'?gallery(appr,true):gallery(sk,true);
  for(const k in keep){const t=document.getElementById(k);if(t)t.value=keep[k]}
}
function setTab(t){tab=t;localStorage.km_tab=t;render()}
async function approve(d,v){try{await api('/api/apps/'+d+'/approve',{variant:v});toast('Approved');load()}catch(e){toast(e.message)}}
function noteFor(d,v){openNote[d]=v;render();const t=document.getElementById('n-'+d);t&&t.focus()}
function closeNote(d){delete openNote[d];render()}
async function regen(d){const note=document.getElementById('n-'+d).value;try{await api('/api/apps/'+d+'/regenerate',{note,variant:openNote[d]||undefined});delete openNote[d];toast('Queued for regeneration');load()}catch(e){toast(e.message)}}
async function queue(d,hint){try{await api('/api/apps/'+d+'/queue',{hint});toast('Queued. Tap more within 45 s to batch them together');load()}catch(e){toast(e.message)}}
function queueHint(d){const h=prompt('Hint for the drawing (e.g. "the object is a red gift box")');if(h!==null)queue(d,h)}
async function unqueue(d){try{await api('/api/apps/'+d+'/unqueue',{});load()}catch(e){toast(e.message)}}
async function skip(d){if(!confirm('Skip this app?'))return;try{await api('/api/apps/'+d+'/skip',{});load()}catch(e){toast(e.message)}}
async function restore(d){try{await api('/api/apps/'+d+'/restore',{});load()}catch(e){toast(e.message)}}
async function publish(){if(!confirm('Commit and push the approved icons? This triggers one CI build.'))return;$('#pub').disabled=true;$('#pub').textContent='Publishing…';
  try{const r=await api('/api/publish',{});toast('Pushed '+r.sha.slice(0,7)+' — CI is building');load()}catch(e){toast(e.message);load()}}
load();setInterval(()=>{if(!document.querySelector('.note.open')&&!document.hidden)load()},15000);
`;

export function reviewPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f6f0e3"><title>kudmascot review</title><style>${css}</style></head><body>
<header><div class="top"><h1>kudmascot</h1><button id="pub" class="pri" onclick="publish()" disabled>Publish</button></div>
<div class="ci">…</div>
<nav><button data-t="inbox" data-l="Inbox" onclick="setTab('inbox')">Inbox</button><button data-t="review" data-l="Review" onclick="setTab('review')">Review</button><button data-t="gallery" data-l="Approved" onclick="setTab('gallery')">Approved</button><button data-t="skipped" data-l="Skipped" onclick="setTab('skipped')">Skipped</button></nav></header>
<main><div class="empty">Loading…</div></main><div class="toast"></div><script>${js}</script></body></html>`;
}

export function loginPage(err = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kudmascot</title><style>${css}
form{max-width:340px;margin:18vh auto;padding:20px}input{width:100%;font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;margin:10px 0}</style></head>
<body><form method="post" class="card"><b>kudmascot</b><p style="color:var(--muted);font-size:13px">Paste the token from <code>~/.config/kudmascot/env</code> on hammas-dev.</p>
<input name="token" type="password" autocomplete="current-password" placeholder="token">${err ? `<div class="err">${err}</div>` : ""}<button class="pri" style="width:100%">Sign in</button></form></body></html>`;
}
