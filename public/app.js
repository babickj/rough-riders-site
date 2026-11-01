// Rough Riders team site. Plain JavaScript, no build step.
// Data lives in Supabase (see supabase/schema.sql). Settings come from config.js.
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const CFG=window.RR_CONFIG||{};
const configured=CFG.supabaseUrl&&!/PASTE_/.test(CFG.supabaseUrl);
const sb=configured?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey):null;

let S=null, TEAM=null, teams=[], session=null, role=null, siteAdmin=false, canEdit=false, isAdmin=false, aiEnabled=false;
const me={id:null,email:"",name:""};
let curLineup=null, pendingEnter=null, pendingData=null;

const BAT=[["ab","AB"],["r","R"],["h","H"],["d","2B"],["t","3B"],["hr","HR"],["rbi","RBI"],["bb","BB"],["so","K"],["hbp","HBP"],["sb","SB"]];
const PIT=[["ip","IP"],["pc","Pitches"],["h","H"],["r","R"],["er","ER"],["bb","BB"],["so","K"]];
const FLD=[["po","PO"],["a","A"],["e","E"]];
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const uuid=()=>crypto.randomUUID();
const inn=()=>S.team.innings||6;
const ipToOuts=v=>{if(v===""||v==null)return 0;const [a,b]=String(v).split(".");return (+a||0)*3+Math.min(2,+(b||0))};
const outsToIp=o=>Math.floor(o/3)+"."+(o%3);
const fmt3=x=>isFinite(x)?(x>=1?x.toFixed(3):x.toFixed(3).replace(/^0/,"")):"—";
const fmt2=x=>isFinite(x)?x.toFixed(2):"—";
const sortedPlayers=()=>[...S.players].filter(p=>p.active!==false).sort((a,b)=>a.num-b.num);
const dParts=d=>{const [y,m,dd]=d.split("-");return {m:MON[+m-1],d:+dd,y}};
const dow=d=>new Date(d+"T12:00").toLocaleDateString(undefined,{weekday:"short"});
function setStatus(el,t,k){if(!el)return;el.textContent=t;el.className="status"+(k?" "+k:"");}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}

// ---------- data ----------
function teamIdFromUrl(){
  const host=location.hostname, map=CFG.hostTeams||{};
  if(map[host])return map[host];
  return new URLSearchParams(location.search).get("team");
}
const teamLink=id=>`${location.pathname}?team=${encodeURIComponent(id)}#schedule`;
function logoUrl(t){
  if(t.logo_path)return sb.storage.from("logos").getPublicUrl(t.logo_path).data.publicUrl;
  return `/logos/${t.id}.jpg`;
}
async function loadTeamData(){
  const [p,g,l]=await Promise.all([
    sb.from("players").select("*").eq("team_id",TEAM.id),
    sb.from("games").select("*").eq("team_id",TEAM.id),
    sb.from("game_lines").select("game_id,bat,pit,fld").eq("team_id",TEAM.id)]);
  const err=p.error||g.error||l.error; if(err)throw err;
  S={team:{name:TEAM.name,season:TEAM.season,league:TEAM.league,innings:TEAM.innings||6,pitchMax:TEAM.pitch_max||85},
     players:p.data, games:g.data, lines:{}};
  for(const r of l.data)S.lines[r.game_id]={bat:r.bat||{},pit:r.pit||{},fld:r.fld||{}};
}
const gameRow=g=>({id:g.id,team_id:TEAM.id,date:g.date,time:g.time||"",opp:g.opp,home:!!g.home,loc:g.loc||"",status:g.status||"scheduled",us:g.us,them:g.them,lineup:g.lineup||null});
async function q(p){const {data,error}=await p;if(error)throw error;return data;}
function errText(e){
  const m=(e&&(e.message||e.error))||String(e);
  if(e&&(e.code==="42501"||/row-level security|permission/i.test(m)))return "Your account doesn't have permission for that. Ask your team admin.";
  if(/Failed to fetch|NetworkError/i.test(m))return "No connection. Check your signal and try again.";
  return m;
}
async function logAct(what){try{await sb.from("activity").insert({team_id:TEAM.id,what,by_name:me.name||me.email});}catch(e){}}
async function run(el,msg,fn){
  setStatus(el,"Saving…");
  try{await fn();setStatus(el,msg,"ok");logAct(msg);return true;}
  catch(e){setStatus(el,errText(e),"err");return false;}
}
async function api(path,body){
  const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+(session?.access_token||"")},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:"The server didn't answer. Try again."}));
  if(!r.ok)throw new Error(j.error||("Error "+r.status));
  return j;
}
async function ai(prompt,image,mediaType){return (await api("/api/ai",{team_id:TEAM.id,prompt,image,media_type:mediaType})).data;}
function resizeImage(file,max,quality){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{const s=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
      c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b?res(b):rej(new Error("Couldn't read that image.")),"image/jpeg",quality);};
    img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("Couldn't read that image."));};
    img.src=url;
  });
}
const blobToB64=b=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(String(fr.result).split(",")[1]);fr.readAsDataURL(b);});

// ---------- auth ----------
async function refreshRole(){
  role=null;siteAdmin=false;me.id=null;me.email="";me.name="";
  if(session){
    me.id=session.user.id;me.email=session.user.email||"";me.name=session.user.user_metadata?.name||"";
    try{
      const [m,sa]=await Promise.all([
        sb.from("memberships").select("role,display_name").eq("user_id",me.id).eq("team_id",TEAM.id),
        sb.from("site_admins").select("user_id").eq("user_id",me.id)]);
      role=m.data?.[0]?.role||null; if(m.data?.[0]?.display_name)me.name=m.data[0].display_name;
      siteAdmin=!!sa.data?.length; if(siteAdmin)role="admin";
    }catch(e){}
  }
  canEdit=role==="admin"||role==="scorekeeper"; isAdmin=role==="admin";
  document.body.classList.toggle("signed-in",!!session);
  document.body.classList.toggle("is-member",!!role);
  document.body.classList.toggle("can-edit",canEdit);
  document.body.classList.toggle("is-owner",isAdmin);
}
function renderAcct(){
  const a=$("#acct");
  if(session)a.innerHTML=`<div>${esc(me.name||me.email)}</div>${role?`<span class="role">${role==="admin"?"Admin":role==="scorekeeper"?"Scorekeeper":"Parent"}</span>`:""}<div><a href="#account">My account</a></div>`;
  else a.innerHTML="";
  const st=$("#si-state");
  if(session&&!role)st.textContent=`You're signed in as ${me.email}, but this account isn't on the ${S.team.name} team yet. Ask the team admin to add you.`;
  else st.textContent="";
  $("#si-title").textContent=`Sign in to ${S.team.name}`;
  $("#ac-who").textContent=session?`Signed in as ${me.name?me.name+" ("+me.email+")":me.email}${role?", "+role:""} on ${S.team.name}.`:"";
}
$("#si-form").addEventListener("submit",async e=>{
  e.preventDefault(); const st=$("#si-status"); setStatus(st,"Signing in…"); $("#si-go").disabled=true;
  const {error}=await sb.auth.signInWithPassword({email:$("#si-email").value.trim(),password:$("#si-pw").value});
  $("#si-go").disabled=false;
  if(error){setStatus(st,/invalid/i.test(error.message)?"That email and password don't match. Check them, or ask your team admin to reset your password.":error.message,"err");return;}
  setStatus(st,""); $("#si-pw").value=""; location.hash="#schedule";
});
$("#ac-form").addEventListener("submit",async e=>{
  e.preventDefault(); const st=$("#ac-status"); const a=$("#ac-pw1").value,b=$("#ac-pw2").value;
  if(a!==b){setStatus(st,"The two passwords don't match.","err");return;}
  if(a.length<8){setStatus(st,"Use at least 8 characters.","err");return;}
  const {error}=await sb.auth.updateUser({password:a});
  if(error){setStatus(st,error.message,"err");return;}
  $("#ac-pw1").value="";$("#ac-pw2").value="";setStatus(st,"Password changed.","ok");
});
$("#ac-signout").onclick=async()=>{await sb.auth.signOut();location.hash="#schedule";};

// ---------- stats ----------
function batTotals(gid){
  const t={};
  for(const [g,L] of Object.entries(S.lines)){if(gid&&g!==gid)continue;
    for(const [pid,b] of Object.entries(L.bat||{})){const x=t[pid]||(t[pid]={g:0});x.g++;for(const [k] of BAT)x[k]=(x[k]||0)+(+b[k]||0);}}
  for(const x of Object.values(t)){const tb=x.h+x.d+2*x.t+3*x.hr,pa=x.ab+x.bb+x.hbp;x.avg=x.ab?x.h/x.ab:NaN;x.obp=pa?(x.h+x.bb+x.hbp)/pa:NaN;x.slg=x.ab?tb/x.ab:NaN;x.ops=x.obp+x.slg;x.pa=pa;}
  return t;
}
function pitTotals(gid){
  const t={};
  for(const [g,L] of Object.entries(S.lines)){if(gid&&g!==gid)continue;
    for(const [pid,p] of Object.entries(L.pit||{})){const x=t[pid]||(t[pid]={g:0,outs:0,pc:0,h:0,r:0,er:0,bb:0,so:0});x.g++;x.outs+=+p.outs||0;for(const k of ["pc","h","r","er","bb","so"])x[k]+=+p[k]||0;}}
  for(const x of Object.values(t)){const ip=x.outs/3;x.era=ip?x.er*inn()/ip:NaN;x.whip=ip?(x.bb+x.h)/ip:NaN;x.k6=ip?x.so*inn()/ip:NaN;}
  return t;
}
function record(){let w=0,l=0,t=0,rs=0,ra=0;for(const g of S.games)if(g.status==="final"&&g.us!=null){rs+=g.us;ra+=g.them;if(g.us>g.them)w++;else if(g.us<g.them)l++;else t++;}return {w,l,t,rs,ra};}

// ---------- header ----------
function renderHeader(){
  document.title=`${S.team.name} Baseball`;
  const lg=$("#logo"); lg.src=logoUrl(TEAM); lg.alt=`${S.team.name} logo`; lg.onerror=()=>{lg.hidden=true;}; lg.onload=()=>{lg.hidden=false;};
  $("#si-logo").src=lg.src;
  $("#h-season").textContent=[S.team.name,S.team.season,S.team.league].filter(Boolean).join(" · ");
  const r=record();
  $("#h-record").innerHTML=`<div><b>${r.w}–${r.l}${r.t?"–"+r.t:""}</b><span>Record</span></div><div><b>${r.rs}</b><span>Runs scored</span></div><div><b>${r.ra}</b><span>Runs allowed</span></div>`;
  const nx=S.games.filter(g=>g.status!=="final"&&g.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
  $("#h-next").innerHTML=nx?`Next game: <strong>${dow(nx.date)} ${dParts(nx.date).m} ${dParts(nx.date).d}, ${esc(nx.time)}</strong> ${nx.home?"vs":"at"} <strong>${esc(nx.opp)}</strong> · ${esc(nx.loc)}`:"No upcoming games on the schedule.";
}

// ---------- schedule ----------
function gameRowHtml(g){
  const p=dParts(g.date); let res="";
  if(g.status==="final"&&g.us!=null){const k=g.us>g.them?"w":g.us<g.them?"l":"t";res=`<span class="pill ${k}">${k.toUpperCase()}</span>${g.us}–${g.them}`;}
  else res=`<span class="pill up">${esc(g.time)}</span>`;
  const actions=[S.lines[g.id]?`<button class="linkbtn" data-box="${g.id}">Box score</button>`:"",canEdit?`<button class="linkbtn" data-edit="${g.id}">Edit</button>`:"",canEdit?`<button class="linkbtn" data-enter="${g.id}">Enter stats</button>`:""].filter(Boolean).join(" · ");
  return `<div class="game"><div class="gdate"><div class="m">${dow(g.date)} ${p.m}</div><div class="d">${p.d}</div></div>
  <div class="gmain"><div class="gopp">${g.home?"vs":"at"} ${esc(g.opp)}</div><div class="gmeta">${esc(g.loc)}${g.status==="final"?"":" · "+esc(g.time)}</div></div>
  <div class="gres">${res}<small>${actions}</small></div></div>`;
}
function renderSchedule(){
  const t=today(), g=[...S.games].sort((a,b)=>a.date.localeCompare(b.date));
  const up=g.filter(x=>x.status!=="final"&&x.date>=t), done=g.filter(x=>x.status==="final"||x.date<t).reverse();
  $("#upcoming").innerHTML=up.map(gameRowHtml).join("")||`<p class="note" style="padding:12px 0">Nothing scheduled yet.${canEdit?" Add a game or import from Spond.":""}</p>`;
  $("#results").innerHTML=done.map(gameRowHtml).join("")||`<p class="note" style="padding:12px 0">No games played yet.</p>`;
  $("#open-import").hidden=!aiEnabled;
}
let editingGame=null;
function openGameForm(g){
  editingGame=g?g.id:null;$("#game-form").hidden=false;$("#game-form-title").textContent=g?"Edit game":"Add game";
  $("#gf-date").value=g?g.date:today();$("#gf-time").value=g?g.time:"";$("#gf-opp").value=g?g.opp:"";$("#gf-home").value=g&&!g.home?"0":"1";$("#gf-loc").value=g?g.loc:"";
  $("#gf-delete").hidden=!g;setStatus($("#gf-status"),"");$("#gf-opp").focus();
}

// ---------- stats view ----------
let statType="bat", sortKey={bat:"avg",pit:"era",fld:"tc"}, sortDir={bat:-1,pit:1,fld:-1};
function pRow(pid){return S.players.find(p=>p.id===pid)||{num:"",name:"(removed)"};}
function renderStats(){
  const sel=$("#stat-game"),cur=sel.value;
  sel.innerHTML=`<option value="">Whole season</option>`+S.games.filter(g=>S.lines[g.id]).sort((a,b)=>b.date.localeCompare(a.date)).map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${esc(g.opp)}</option>`).join("");
  sel.value=cur;
  const gid=sel.value,tbl=$("#stat-table");
  if(statType==="bat"){
    const T=batTotals(gid),cols=[["g","G"],["pa","PA"],...BAT,["avg","AVG"],["obp","OBP"],["slg","SLG"],["ops","OPS"]];
    const rows=Object.entries(T).map(([pid,x])=>({pid,x})),k=sortKey.bat,dir=sortDir.bat;
    rows.sort((a,b)=>((isNaN(a.x[k])?-1:a.x[k])-(isNaN(b.x[k])?-1:b.x[k]))*dir);
    const isRate=c=>["avg","obp","slg","ops"].includes(c);
    const minPa=Math.max(3,rows.reduce((m,r)=>Math.max(m,r.x.g),0)),qualified=rows.filter(r=>r.x.pa>=minPa);
    const lead={};for(const [c] of cols){if(c==="g"||c==="pa")continue;const v=Math.max(...(isRate(c)?qualified:rows).map(r=>isNaN(r.x[c])?-1:r.x[c]));if(v>0)lead[c]=v;}
    const tot={};for(const [c] of BAT)tot[c]=rows.reduce((s,r)=>s+r.x[c],0);
    const ta=tot.ab?tot.h/tot.ab:NaN,tpa=tot.ab+tot.bb+tot.hbp,to=tpa?(tot.h+tot.bb+tot.hbp)/tpa:NaN,ts=tot.ab?(tot.h+tot.d+2*tot.t+3*tot.hr)/tot.ab:NaN;
    tbl.innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${cols.map(([c,l])=>`<th data-k="${c}" ${k===c?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${l}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${cols.map(([c])=>{const v=x[c];const L=lead[c]!==undefined&&v===lead[c]&&(!isRate(c)||qualified.some(q=>q.pid===pid));return `<td class="${L?"lead":""}">${isRate(c)?fmt3(v):v}</td>`}).join("")}</tr>`}).join("")+
      (rows.length?`<tr class="total"><td></td><td class="l">Team</td><td></td><td>${tpa}</td>${BAT.map(([c])=>`<td>${tot[c]}</td>`).join("")}<td>${fmt3(ta)}</td><td>${fmt3(to)}</td><td>${fmt3(ts)}</td><td>${fmt3(to+ts)}</td></tr>`:"")+`</tbody>`;
    $("#stat-note").textContent=rows.length?"Red marks the team leader. Rate leaders need at least one plate appearance per game played. Tap a column to sort.":"No stats entered yet.";
  }else if(statType==="fld"){
    const t={};for(const [g,L] of Object.entries(S.lines)){if(gid&&g!==gid)continue;for(const [pid,f] of Object.entries(L.fld||{})){const x=t[pid]||(t[pid]={g:0,po:0,a:0,e:0});x.g++;for(const [k] of FLD)x[k]+=+f[k]||0;}}
    for(const x of Object.values(t)){x.tc=x.po+x.a+x.e;x.pct=x.tc?(x.po+x.a)/x.tc:NaN;}
    const cols=[["g","G"],["po","PO"],["a","A"],["e","E"],["tc","TC"],["pct","FLD%"]],rows=Object.entries(t).map(([pid,x])=>({pid,x})),k=sortKey.fld,dir=sortDir.fld;
    rows.sort((a,b)=>((isNaN(a.x[k])?-1:a.x[k])-(isNaN(b.x[k])?-1:b.x[k]))*dir);
    tbl.innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${cols.map(([c,l])=>`<th data-k="${c}" ${k===c?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${l}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${cols.map(([c])=>`<td>${c==="pct"?fmt3(x[c]):x[c]}</td>`).join("")}</tr>`}).join("")+`</tbody>`;
    $("#stat-note").textContent=rows.length?"PO is putouts, A is assists, E is errors, TC is total chances.":"No fielding entered yet. Live scoring records it automatically.";
  }else{
    const T=pitTotals(gid),cols=[["g","G"],["ip","IP"],["pc","Pitches"],["h","H"],["r","R"],["er","ER"],["bb","BB"],["so","K"],["era","ERA"],["whip","WHIP"],["k6","K/"+inn()]];
    const rows=Object.entries(T).map(([pid,x])=>({pid,x})),k=sortKey.pit,dir=sortDir.pit,val=(x,c)=>c==="ip"?x.outs:x[c];
    rows.sort((a,b)=>{const va=val(a.x,k),vb=val(b.x,k);return ((isNaN(va)?1e9*dir:va)-(isNaN(vb)?1e9*dir:vb))*dir});
    tbl.innerHTML=`<thead><tr><th class="l">#</th><th class="l">Pitcher</th>${cols.map(([c,l])=>`<th data-k="${c}" ${k===c?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${l}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${cols.map(([c])=>`<td>${c==="ip"?outsToIp(x.outs):["era","whip","k6"].includes(c)?fmt2(x[c]):x[c]}</td>`).join("")}</tr>`}).join("")+`</tbody>`;
    $("#stat-note").textContent=rows.length?`ERA and strikeouts are scaled to a ${inn()}-inning game. Tap a column to sort.`:"No pitching entered yet.";
  }
  renderAvail();
}
function restDays(pc){return pc>=66?4:pc>=51?3:pc>=36?2:pc>=21?1:0;}
function renderAvail(){
  const last={};
  for(const g of [...S.games].sort((a,b)=>a.date.localeCompare(b.date))){const L=S.lines[g.id];if(!L)continue;for(const [pid,p] of Object.entries(L.pit||{}))last[pid]={date:g.date,pc:+p.pc||0};}
  const t=new Date(today()+"T12:00");
  $("#avail").innerHTML=sortedPlayers().filter(p=>last[p.id]).map(p=>{const l=last[p.id],need=restDays(l.pc),d=new Date(l.date+"T12:00"),free=new Date(d);free.setDate(d.getDate()+need+1);const ok=t>=free;
    return `<div class="av"><div><b>#${p.num} ${esc(p.name)}</b><div class="s">${l.pc} pitches on ${dParts(l.date).m} ${dParts(l.date).d}</div></div><span class="chip ${ok?"ok":"rest"}">${ok?"Available":"Rest until "+MON[free.getMonth()]+" "+free.getDate()}</span></div>`}).join("")||`<p class="note">No pitching outings yet.</p>`;
}

// ---------- roster ----------
let editingPlayer=null;
function renderRoster(){
  const T=batTotals(""),P=pitTotals("");
  $("#roster").innerHTML=sortedPlayers().map(p=>{const b=T[p.id],q=P[p.id];
    return `<div class="card"><div class="jersey">${p.num}</div><div style="min-width:0;flex:1"><div class="nm">${esc(p.name)}</div><div class="ln">${b?`${fmt3(b.avg)} AVG · ${b.h} H · ${b.rbi} RBI`:"No at-bats yet"}</div>${q?`<div class="ln">${outsToIp(q.outs)} IP · ${fmt2(q.era)} ERA</div>`:""}${canEdit?`<button class="linkbtn" data-pedit="${p.id}">Edit</button>`:""}</div></div>`}).join("")||`<p class="note">No players yet.</p>`;
  $("#ts-season").value=S.team.season||"";$("#ts-league").value=S.team.league||"";$("#ts-inn").value=inn();$("#ts-pmax").value=S.team.pitchMax||85;
}

// ---------- entry ----------
function renderEntryGames(sel){
  const s=$("#eg-game"),gs=[...S.games].sort((a,b)=>b.date.localeCompare(a.date));
  s.innerHTML=gs.map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d}, ${dParts(g.date).y} ${g.home?"vs":"at"} ${esc(g.opp)}${S.lines[g.id]?" (entered)":""}</option>`).join("");
  const pick=sel||s.value||(gs.find(g=>g.date<=today()&&!S.lines[g.id])||gs[0]||{}).id; if(pick)s.value=pick; fillEntry();
}
const curGame=()=>S.games.find(x=>x.id===$("#eg-game").value);
function lineupFor(g){const ids=S.players.map(p=>p.id);if(g&&Array.isArray(g.lineup))return g.lineup.filter(id=>ids.includes(id));return sortedPlayers().map(p=>p.id);}
function loadLineup(){const on=lineupFor(curGame()),rest=sortedPlayers().map(p=>p.id).filter(id=>!on.includes(id));curLineup={order:[...on,...rest],on:new Set(on)};}
function activeLineup(){return curLineup?curLineup.order.filter(id=>curLineup.on.has(id)).map(id=>S.players.find(p=>p.id===id)).filter(Boolean):[];}
function renderLineup(){
  let n=0;
  $("#lineup").innerHTML=curLineup.order.map(id=>{const p=S.players.find(p=>p.id===id);if(!p)return "";const on=curLineup.on.has(id);
    return `<li class="${on?"":"out"}"><span class="ord">${on?++n:"–"}</span><input type="checkbox" id="lu-${id}" data-lu-on="${id}" ${on?"checked":""} aria-label="${esc(p.name)} is playing"><span class="jersey" style="font-size:20px;min-width:0">${p.num}</span><label for="lu-${id}">${esc(p.name)}</label><span class="arr"><button type="button" data-lu-up="${id}" aria-label="Move ${esc(p.name)} up">↑</button><button type="button" data-lu-dn="${id}" aria-label="Move ${esc(p.name)} down">↓</button></span></li>`}).join("")||`<li class="note">Add players on the Roster tab first.</li>`;
}
function rebuildTables(){
  const snap={};$$("#eb-table input,#ep-table input,#ef-table input").forEach(i=>snap[i.id]=i.value);
  const g=curGame();buildTables(S.lines[g&&g.id]||{bat:{},pit:{}},null);
  $$("#eb-table input,#ep-table input,#ef-table input").forEach(i=>{if(i.id in snap)i.value=snap[i.id];});
}
function fillEntry(data){
  const g=curGame();
  $("#eg-us").value=data&&data.us!=null?data.us:(g&&g.us!=null?g.us:"");$("#eg-them").value=data&&data.them!=null?data.them:(g&&g.them!=null?g.them:"");
  if(!data){loadLineup();renderLineup();}
  buildTables(data||S.lines[g&&g.id]||{bat:{},pit:{}},data);
}
function buildTables(L,data){
  const ps=activeLineup(),F=L.fld||{};
  $("#eb-table").innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${BAT.map(([,l])=>`<th style="text-align:center">${l}</th>`).join("")}</tr></thead><tbody>`+
    ps.map(p=>`<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${BAT.map(([k])=>{const v=((L.bat||{})[p.id]||{})[k];return `<td><input type="number" min="0" inputmode="numeric" id="b-${p.id}-${k}" aria-label="${esc(p.name)} ${k}" value="${v??""}" class="${data&&v?"filled":""}"></td>`}).join("")}</tr>`).join("")+`</tbody>`;
  $("#ep-table").innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${PIT.map(([,l])=>`<th style="text-align:center">${l}</th>`).join("")}</tr></thead><tbody>`+
    ps.map(p=>{const q=(L.pit||{})[p.id];return `<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${PIT.map(([k])=>{const v=q?(k==="ip"?outsToIp(q.outs||0):q[k]):"";return `<td><input ${k==="ip"?'type="text" inputmode="decimal" class="ip'+(data&&q?" filled":"")+'"':'type="number" min="0" inputmode="numeric" class="'+(data&&q&&v?"filled":"")+'"'} id="p-${p.id}-${k}" aria-label="${esc(p.name)} ${k}" value="${v??""}"></td>`}).join("")}</tr>`}).join("")+`</tbody>`;
  $("#ef-table").innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${FLD.map(([,l])=>`<th style="text-align:center">${l}</th>`).join("")}</tr></thead><tbody>`+
    ps.map(p=>`<tr><td class="num l">${p.num}</td><td class="l">${esc(p.name)}</td>${FLD.map(([k])=>{const v=(F[p.id]||{})[k];return `<td><input type="number" min="0" inputmode="numeric" id="f-${p.id}-${k}" aria-label="${esc(p.name)} ${k}" value="${v??""}" class="${data&&v?"filled":""}"></td>`}).join("")}</tr>`).join("")+`</tbody>`;
}
function collectEntry(){
  const bat={},pit={},fld={},errs=[];
  for(const p of activeLineup()){
    const f={};let fa=false;for(const [k] of FLD){const v=$(`#f-${p.id}-${k}`).value;f[k]=+v||0;if(+v)fa=true;}if(fa)fld[p.id]=f;
    const b={};let any=false;for(const [k] of BAT){const v=$(`#b-${p.id}-${k}`).value;if(v!==""){b[k]=Math.max(0,+v);any=true}else b[k]=0;}
    if(any){if(b.h>b.ab)errs.push(`${p.name} has more hits than at-bats`);if(b.d+b.t+b.hr>b.h)errs.push(`${p.name} has more extra-base hits than hits`);bat[p.id]=b;}
    const ipv=$(`#p-${p.id}-ip`).value.trim(),pc=$(`#p-${p.id}-pc`).value;
    if(ipv!==""||pc!==""){
      if(ipv!==""&&!/^\d+(\.[0-2])?$/.test(ipv))errs.push(`${p.name}'s innings should look like 2 or 2.1`);
      const qq={outs:ipToOuts(ipv)};for(const [k] of PIT.slice(1))qq[k]=+$(`#p-${p.id}-${k}`).value||0;if(qq.er>qq.r)errs.push(`${p.name} has more earned runs than runs`);pit[p.id]=qq;}
  }
  return {bat,pit,fld,errs};
}

// ---------- scoresheet ----------
function sheetHTML(gid){
  const g=S.games.find(x=>x.id===gid),ps=lineupFor(g).map(id=>S.players.find(p=>p.id===id)).filter(Boolean),extra=Math.max(2,14-ps.length);
  const rows=ps.map((p,i)=>`<tr><td>${i+1}</td><td>${p.num}</td><td class="l">${esc(p.name)}</td>${BAT.map(()=>"<td></td>").join("")}</tr>`).join("")+Array.from({length:extra},()=>`<tr><td></td><td></td><td class="l"></td>${BAT.map(()=>"<td></td>").join("")}</tr>`).join("");
  const prow=Array.from({length:5},()=>`<tr><td></td><td class="l"></td>${PIT.map(()=>"<td></td>").join("")}</tr>`).join("");
  const dt=g?`${dow(g.date)} ${dParts(g.date).m} ${dParts(g.date).d}, ${dParts(g.date).y}`:"";
  return `<div class="hdr"><span class="mark"></span><span>${esc(S.team.name)} scoresheet</span><span>Date <span class="box">${esc(dt)}</span></span><span>Opponent <span class="box">${g?(g.home?"vs ":"at ")+esc(g.opp):""}</span></span><span>Final: Us <span class="box" style="min-width:50px"></span> Them <span class="box" style="min-width:50px"></span></span></div>
  <h4>Batting (game totals, in batting order)</h4><table><thead><tr><th>Bat</th><th>#</th><th class="l" style="text-align:left;min-width:110px">Player</th>${BAT.map(([,l])=>`<th style="min-width:44px">${l}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
  <h4>Pitching</h4><table><thead><tr><th>#</th><th style="text-align:left;min-width:110px">Pitcher</th>${PIT.map(([,l])=>`<th style="min-width:54px">${l}</th>`).join("")}</tr></thead><tbody>${prow}</tbody></table>
  <p style="font-size:11px;margin:8px 0 0">One player per row. Write numbers clearly; tally marks are fine. Innings as 2.1 for two innings and one out. Photograph the whole sheet, flat, in good light.</p>`;
}
function renderSheet(){
  const s=$("#sh-game"),cur=s.value,gs=[...S.games].sort((a,b)=>a.date.localeCompare(b.date));
  s.innerHTML=`<option value="">Blank (no game)</option>`+gs.map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d}, ${dParts(g.date).y} ${g.home?"vs":"at"} ${esc(g.opp)}${g.lineup?" (lineup set)":""}</option>`).join("");
  s.value=cur||((gs.find(g=>g.status!=="final"&&g.date>=today())||{}).id||"");
  $("#sheet").innerHTML=sheetHTML(s.value);
}

// ---------- photos ----------
let mediaRows=[];
function ytId(u){const m=String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);return m?m[1]:null;}
async function renderPhotos(){
  const note=$("#ph-note"),gal=$("#gallery");
  $("#ph-game").innerHTML=`<option value="">None</option>`+[...S.games].sort((a,b)=>b.date.localeCompare(a.date)).map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${esc(g.opp)}</option>`).join("");
  if(!role){note.textContent=session?"Your account isn't on this team yet, so photos stay hidden. Ask the team admin to add you.":"Team photos and videos are for families on the team. Sign in to see them.";gal.innerHTML="";return;}
  note.textContent="Visible only to signed-in team members.";
  gal.innerHTML=`<p class="note">Loading…</p>`;
  try{
    mediaRows=await q(sb.from("media").select("*").eq("team_id",TEAM.id).order("created_at",{ascending:false}).limit(300));
    const paths=mediaRows.filter(m=>m.kind==="photo").map(m=>m.path);
    const urls={};
    if(paths.length){const {data}=await sb.storage.from("media").createSignedUrls(paths,3600);(data||[]).forEach(d=>{if(d.signedUrl)urls[d.path]=d.signedUrl;});}
    const gname=id=>{const g=S.games.find(x=>x.id===id);return g?`${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${g.opp}`:"";};
    gal.innerHTML=mediaRows.map(m=>{
      const del=(m.created_by===me.id||isAdmin)?`<button class="linkbtn" data-mdel="${m.id}">Delete</button>`:"";
      const cap=[m.caption,gname(m.game_id)].filter(Boolean).join(" · ");
      if(m.kind==="video"){const id=ytId(m.url);return id?`<div class="tile video"><div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(m.caption||"Team video")}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div><div class="cap"><span>${esc(cap)}</span>${del}</div></div>`:"";}
      return urls[m.path]?`<div class="tile"><img src="${urls[m.path]}" alt="${esc(m.caption||"Team photo")}" loading="lazy" data-full="${urls[m.path]}"><div class="cap"><span>${esc(cap)}</span>${del}</div></div>`:"";
    }).join("")||`<p class="note">No photos or videos yet. Add the first ones above.</p>`;
  }catch(e){gal.innerHTML=`<p class="status err">${esc(errText(e))}</p>`;}
}
$("#ph-upload").onclick=async()=>{
  const files=[...$("#ph-files").files],st=$("#ph-status"); if(!files.length){setStatus(st,"Choose one or more photos first.","err");return;}
  $("#ph-upload").disabled=true; let ok=0;
  try{
    for(const f of files){
      setStatus(st,`Uploading ${ok+1} of ${files.length}…`);
      const blob=await resizeImage(f,2048,.85),path=`${TEAM.id}/${uuid()}.jpg`;
      const up=await sb.storage.from("media").upload(path,blob,{contentType:"image/jpeg"}); if(up.error)throw up.error;
      await q(sb.from("media").insert({team_id:TEAM.id,kind:"photo",path,caption:$("#ph-cap").value.trim(),game_id:$("#ph-game").value||null}));
      ok++;
    }
    setStatus(st,`Added ${ok} photo${ok>1?"s":""}.`,"ok"); $("#ph-files").value=""; $("#ph-cap").value=""; renderPhotos();
  }catch(e){setStatus(st,(ok?`Added ${ok}, then stopped: `:"")+errText(e),"err");}
  finally{$("#ph-upload").disabled=false;}
};
$("#vd-add").onclick=async()=>{
  const u=$("#vd-url").value.trim(),st=$("#ph-status");
  if(!ytId(u)){setStatus(st,"That doesn't look like a YouTube link. Copy it from YouTube's Share button.","err");return;}
  try{await q(sb.from("media").insert({team_id:TEAM.id,kind:"video",url:u,caption:$("#vd-cap").value.trim()}));setStatus(st,"Video added.","ok");$("#vd-url").value="";$("#vd-cap").value="";renderPhotos();}
  catch(e){setStatus(st,errText(e),"err");}
};
let pendingDel=null;
$("#gallery").addEventListener("click",async e=>{
  const img=e.target.closest("img[data-full]");
  if(img){$("#lb-img").src=img.dataset.full;$("#lb-img").alt=img.alt;$("#lightbox").hidden=false;return;}
  const d=e.target.closest("[data-mdel]"); if(!d)return;
  if(pendingDel!==d.dataset.mdel){pendingDel=d.dataset.mdel;d.textContent="Tap again to delete";setTimeout(()=>{if(pendingDel===d.dataset.mdel){pendingDel=null;d.textContent="Delete";}},4000);return;}
  pendingDel=null; const m=mediaRows.find(x=>x.id===d.dataset.mdel);
  try{if(m.kind==="photo")await sb.storage.from("media").remove([m.path]);await q(sb.from("media").delete().eq("id",m.id));renderPhotos();}
  catch(err){setStatus($("#ph-status"),errText(err),"err");}
});
$("#lightbox").onclick=()=>{$("#lightbox").hidden=true;};

// ---------- admin ----------
const genPw=()=>{const w="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";const a=new Uint32Array(10);crypto.getRandomValues(a);return [...a].map(x=>w[x%w.length]).join("");};
let members=[];
function showPw(name,pw){
  const box=$("#ad-pwbox");box.hidden=false;
  box.innerHTML=`<span>Temporary password for ${esc(name)}: <span class="temp-pw">${esc(pw)}</span> Send it to them privately. They can change it under My account.</span><button type="button" id="pw-copy">Copy</button>`;
  $("#pw-copy").onclick=async()=>{try{await navigator.clipboard.writeText(pw);$("#pw-copy").textContent="Copied";}catch(e){}};
}
async function renderAdmin(){
  if(!isAdmin)return;
  const st=$("#ad-mstatus");setStatus(st,"Loading people…");
  try{
    members=(await api("/api/admin",{action:"list",team_id:TEAM.id})).members||[];
    $("#ad-members").innerHTML=`<thead><tr><th class="l">Name</th><th class="l">Email</th><th class="l">Role</th><th class="l"></th></tr></thead><tbody>`+
      members.map(m=>`<tr><td class="l">${esc(m.display_name||"")}</td><td class="l">${esc(m.email)}</td><td class="l"><select data-role="${m.user_id}" aria-label="Role for ${esc(m.email)}">${["parent","scorekeeper","admin"].map(r=>`<option value="${r}" ${m.role===r?"selected":""}>${r[0].toUpperCase()+r.slice(1)}</option>`).join("")}</select></td><td class="l"><button class="linkbtn" data-reset="${m.user_id}">Reset password</button>${m.user_id===me.id?"":` · <button class="linkbtn" data-remove="${m.user_id}">Remove</button>`}</td></tr>`).join("")+`</tbody>`;
    setStatus(st,members.length?"":"No one added yet.");
  }catch(e){setStatus(st,errText(e),"err");}
  $("#ad-teams").hidden=!siteAdmin;
  if(siteAdmin)$("#ad-teamlist").innerHTML=`<p>${teams.map(t=>`<a href="${teamLink(t.id)}">${esc(t.name)}</a>`).join(" · ")}</p>`;
  try{
    const log=await q(sb.from("activity").select("*").eq("team_id",TEAM.id).order("at",{ascending:false}).limit(25));
    $("#ad-log").innerHTML=log.length?`<thead><tr><th class="l">When</th><th class="l">Who</th><th class="l">Change</th></tr></thead><tbody>${log.map(l=>`<tr><td class="l">${esc(new Date(l.at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</td><td class="l">${esc(l.by_name||"Someone")}</td><td class="l">${esc(l.what)}</td></tr>`).join("")}</tbody>`:"";
    $("#ad-log-note").textContent=log.length?"Shows the last 25 changes.":"No changes yet.";
  }catch(e){}
}
$("#ad-members").addEventListener("change",async e=>{
  const s=e.target.closest("[data-role]");if(!s)return;const st=$("#ad-mstatus");
  try{await api("/api/admin",{action:"set_role",team_id:TEAM.id,user_id:s.dataset.role,role:s.value});setStatus(st,"Role updated.","ok");logAct("Changed a role");}
  catch(err){setStatus(st,err.message,"err");renderAdmin();}
});
let pendingRemove=null;
$("#ad-members").addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;const st=$("#ad-mstatus");
  const m=members.find(x=>x.user_id===(b.dataset.reset||b.dataset.remove));if(!m)return;
  if(b.dataset.reset){const pw=genPw();try{await api("/api/admin",{action:"reset_password",team_id:TEAM.id,user_id:m.user_id,password:pw});showPw(m.display_name||m.email,pw);setStatus(st,"");logAct("Reset a password");}catch(err){setStatus(st,err.message,"err");}}
  else if(b.dataset.remove){
    if(pendingRemove!==m.user_id){pendingRemove=m.user_id;b.textContent="Tap again to remove";return;}
    pendingRemove=null;try{await api("/api/admin",{action:"remove",team_id:TEAM.id,user_id:m.user_id});setStatus(st,`Removed ${m.display_name||m.email}.`,"ok");logAct("Removed a person");renderAdmin();}catch(err){setStatus(st,err.message,"err");}
  }
});
$("#ad-add").onclick=async()=>{
  const st=$("#ad-astatus"),name=$("#ad-name").value.trim(),email=$("#ad-email").value.trim(),r=$("#ad-role").value,pw=genPw();
  if(!email){setStatus(st,"Enter their email.","err");return;}
  setStatus(st,"Adding…");
  try{const res=await api("/api/admin",{action:"add",team_id:TEAM.id,name,email,role:r,password:pw});
    setStatus(st,res.created?`Added ${name||email}.`:`Added ${name||email}. They already had an account, so their password didn't change.`,"ok");
    if(res.created)showPw(name||email,pw);
    $("#ad-name").value="";$("#ad-email").value="";logAct(`Added ${name||email} as ${r}`);renderAdmin();}
  catch(e){setStatus(st,e.message,"err");}
};
$("#nt-add").onclick=async()=>{
  const st=$("#nt-status");
  try{const r=await api("/api/admin",{action:"create_team",name:$("#nt-name").value.trim(),id:$("#nt-id").value.trim()});setStatus(st,"Team added. Opening it…","ok");location.href=teamLink(r.team.id);}
  catch(e){setStatus(st,e.message,"err");}
};
$("#lg-up").onclick=async()=>{
  const f=$("#lg-file").files[0],st=$("#lg-status");if(!f){setStatus(st,"Choose an image first.","err");return;}
  try{setStatus(st,"Uploading…");const blob=await resizeImage(f,600,.9),path=`${TEAM.id}/logo-${Date.now()}.jpg`;
    const up=await sb.storage.from("logos").upload(path,blob,{contentType:"image/jpeg"});if(up.error)throw up.error;
    await q(sb.from("teams").update({logo_path:path}).eq("id",TEAM.id));TEAM.logo_path=path;renderHeader();setStatus(st,"Logo updated.","ok");}
  catch(e){setStatus(st,errText(e),"err");}
};

// ---------- routing ----------
const VIEWS=["schedule","live","stats","roster","photos","scorebook","sheet","admin","signin","account","teams"];
function route(){
  let v=location.hash.slice(1); if(!VIEWS.includes(v))v="schedule";
  if(!TEAM)v="teams";
  else{
    if(!canEdit&&["scorebook","sheet"].includes(v))v="signin";
    if(v==="admin"&&!isAdmin)v=session?"schedule":"signin";
    if(v==="account"&&!session)v="signin";
    if(v==="signin"&&session&&role)v="schedule";
  }
  for(const x of VIEWS)$("#v-"+x).hidden=x!==v;
  $$("nav.tabs a").forEach(a=>a.getAttribute("data-v")===v?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current"));
  if(!TEAM)return;
  if(v==="admin")renderAdmin();
  if(v==="photos")renderPhotos();
  if(v==="live")startLive();
  if(v==="scorebook"){renderEntryGames(pendingEnter);if(pendingData){fillEntry(pendingData);setStatus($("#eg-status"),"Box score built from live scoring. Check it, then press Save game.","ok");}}
  pendingEnter=null;pendingData=null;
}
function render(){renderHeader();renderAcct();renderSchedule();renderStats();renderRoster();renderSheet();}
window.addEventListener("hashchange",route);

// ---------- events ----------
document.addEventListener("click",e=>{
  const t=e.target.closest("[data-box],[data-edit],[data-enter],[data-pedit],[data-st],th[data-k]");if(!t)return;
  if(t.dataset.box){location.hash="#stats";$("#stat-game").value=t.dataset.box;renderStats();}
  else if(t.dataset.edit)openGameForm(S.games.find(g=>g.id===t.dataset.edit));
  else if(t.dataset.enter){pendingEnter=t.dataset.enter;if(location.hash==="#scorebook")route();else location.hash="#scorebook";}
  else if(t.dataset.pedit){const p=S.players.find(p=>p.id===t.dataset.pedit);editingPlayer=p.id;$("#player-form").hidden=false;$("#pf-name").value=p.name;$("#pf-num").value=p.num;$("#pf-delete").hidden=false;}
  else if(t.dataset.st){statType=t.dataset.st;$$("[data-st]").forEach(b=>b.setAttribute("aria-pressed",b===t));renderStats();}
  else if(t.dataset.k){const k=t.dataset.k;if(sortKey[statType]===k)sortDir[statType]*=-1;else{sortKey[statType]=k;sortDir[statType]=(statType==="pit"&&["era","whip","h","r","er","bb"].includes(k))?1:-1;}renderStats();}
});
$("#stat-game").addEventListener("change",renderStats);
$("#add-game").onclick=()=>openGameForm(null);
$("#gf-cancel").onclick=()=>{$("#game-form").hidden=true};
$("#gf-save").onclick=async()=>{
  const d=$("#gf-date").value,o=$("#gf-opp").value.trim();if(!d||!o){setStatus($("#gf-status"),"Add a date and an opponent.","err");return;}
  const g=editingGame?{...S.games.find(x=>x.id===editingGame)}:{id:uuid(),status:"scheduled",us:null,them:null,lineup:null};
  Object.assign(g,{date:d,time:$("#gf-time").value.trim(),opp:o,home:$("#gf-home").value==="1",loc:$("#gf-loc").value.trim()});
  if(await run($("#gf-status"),`${editingGame?"Updated":"Added"} game ${g.home?"vs":"at"} ${o}`,()=>q(sb.from("games").upsert(gameRow(g))))){
    const i=S.games.findIndex(x=>x.id===g.id);if(i>=0)S.games[i]=g;else S.games.push(g);render();$("#game-form").hidden=true;}
};
let pendingGameDel=false;
$("#gf-delete").onclick=async()=>{
  if(!pendingGameDel){pendingGameDel=true;$("#gf-delete").textContent="Tap again to delete";setTimeout(()=>{pendingGameDel=false;$("#gf-delete").textContent="Delete game";},4000);return;}
  pendingGameDel=false;$("#gf-delete").textContent="Delete game";
  if(await run($("#gf-status"),"Deleted a game",()=>q(sb.from("games").delete().eq("id",editingGame)))){S.games=S.games.filter(g=>g.id!==editingGame);delete S.lines[editingGame];render();$("#game-form").hidden=true;}
};
$("#open-import").onclick=()=>{$("#import-panel").hidden=!$("#import-panel").hidden;};
let importRows=[];
$("#run-import").onclick=async()=>{
  const txt=$("#import-text").value.trim(),st=$("#import-status");if(!txt){setStatus(st,"Paste the Spond events first.","err");return;}
  setStatus(st,"Reading events…");$("#run-import").disabled=true;
  try{
    const out=await ai(`You are reading a youth baseball team's schedule copied from the Spond app. Today is ${today()}. Extract every game (skip practices unless no games exist). Return ONLY JSON: {"games":[{"date":"YYYY-MM-DD","time":"h:mm","opp":"opponent team name","home":true,"loc":"field or park name"}]}. Infer the year from context; if missing, use the next occurrence on or after today. If home/away is unclear, use true.\n\nTEXT:\n${txt}`);
    importRows=(out&&out.games||[]).filter(g=>/^\d{4}-\d{2}-\d{2}$/.test(g.date));
    $("#import-preview").innerHTML=importRows.length?`<div class="tbl-wrap"><table><thead><tr><th class="l">Date</th><th class="l">Time</th><th class="l">Opponent</th><th class="l">Home</th><th class="l">Field</th></tr></thead><tbody>${importRows.map(g=>`<tr><td class="l">${g.date}</td><td class="l">${esc(g.time)}</td><td class="l">${esc(g.opp)}</td><td class="l">${g.home?"Home":"Away"}</td><td class="l">${esc(g.loc)}</td></tr>`).join("")}</tbody></table></div><div class="row" style="margin-top:10px"><button class="primary" id="import-add" type="button">Add ${importRows.length} games</button></div>`:"";
    setStatus(st,importRows.length?"Check these before adding.":"No games found in that text.",importRows.length?"":"err");
  }catch(e){setStatus(st,e.message,"err");}
  finally{$("#run-import").disabled=false;}
};
document.addEventListener("click",async e=>{if(e.target.id!=="import-add")return;
  const add=importRows.filter(g=>!S.games.some(x=>x.date===g.date&&x.opp.toLowerCase()===String(g.opp).toLowerCase())).map(g=>({id:uuid(),date:g.date,time:g.time||"",opp:g.opp||"TBD",home:g.home!==false,loc:g.loc||"",status:"scheduled",us:null,them:null,lineup:null}));
  if(await run($("#import-status"),`Imported ${add.length} games from Spond`,()=>q(sb.from("games").insert(add.map(gameRow))))){S.games.push(...add);render();$("#import-preview").innerHTML="";$("#import-text").value="";}
});
$("#add-player").onclick=()=>{editingPlayer=null;$("#player-form").hidden=false;$("#pf-name").value="";$("#pf-num").value="";$("#pf-delete").hidden=true;$("#pf-name").focus();};
$("#pf-cancel").onclick=()=>{$("#player-form").hidden=true};
$("#pf-save").onclick=async()=>{const n=$("#pf-name").value.trim(),num=+$("#pf-num").value;if(!n)return;
  const p=editingPlayer?{...S.players.find(x=>x.id===editingPlayer),name:n,num}:{id:uuid(),name:n,num,active:true};
  if(await run($("#ts-status"),`Saved player ${n}`,()=>q(sb.from("players").upsert({id:p.id,team_id:TEAM.id,name:p.name,num:p.num,active:p.active!==false})))){
    const i=S.players.findIndex(x=>x.id===p.id);if(i>=0)S.players[i]=p;else S.players.push(p);render();$("#player-form").hidden=true;}
};
$("#pf-delete").onclick=async()=>{ // keep stats history: mark inactive instead of deleting
  const p=S.players.find(x=>x.id===editingPlayer);
  if(await run($("#ts-status"),`Removed ${p.name} from the roster`,()=>q(sb.from("players").update({active:false}).eq("id",p.id)))){p.active=false;render();$("#player-form").hidden=true;}
};
$("#ts-save").onclick=async()=>{
  const v={season:$("#ts-season").value.trim(),league:$("#ts-league").value.trim(),innings:Math.min(9,Math.max(4,+$("#ts-inn").value||6)),pitch_max:Math.min(105,Math.max(20,+$("#ts-pmax").value||85))};
  if(await run($("#ts-status"),"Updated team settings",()=>q(sb.from("teams").update(v).eq("id",TEAM.id)))){Object.assign(TEAM,v);Object.assign(S.team,{season:v.season,league:v.league,innings:v.innings,pitchMax:v.pitch_max});render();}
};
$("#eg-game").addEventListener("change",()=>fillEntry());
$("#sh-game").addEventListener("change",()=>{$("#sheet").innerHTML=sheetHTML($("#sh-game").value);});
$("#sheet-print").onclick=()=>window.print();
$("#lineup").addEventListener("change",e=>{const id=e.target.dataset.luOn;if(!id)return;if(e.target.checked)curLineup.on.add(id);else curLineup.on.delete(id);
  const o=curLineup.order.filter(x=>x!==id),lastOn=o.reduce((m,x,i)=>curLineup.on.has(x)?i:m,-1);o.splice(e.target.checked?lastOn+1:o.length,0,id);curLineup.order=o;renderLineup();rebuildTables();$("#lu-"+id).focus();});
$("#lineup").addEventListener("click",e=>{const b=e.target.closest("[data-lu-up],[data-lu-dn]");if(!b)return;const id=b.dataset.luUp||b.dataset.luDn,o=curLineup.order,i=o.indexOf(id),j=b.dataset.luUp?i-1:i+1;if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];renderLineup();rebuildTables();const nb=$(`[data-lu-${b.dataset.luUp?"up":"dn"}="${id}"]`);if(nb)nb.focus();});
$("#lu-all").onclick=()=>{curLineup.on=new Set(curLineup.order);renderLineup();rebuildTables();};
$("#lu-save").onclick=async()=>{const g=curGame();if(!g)return;const lu=activeLineup().map(p=>p.id);
  if(await run($("#lu-status"),`Set lineup ${g.home?"vs":"at"} ${g.opp} (${lu.length} players)`,()=>q(sb.from("games").update({lineup:lu}).eq("id",g.id)))){g.lineup=lu;renderSheet();}};
$("#eg-save").onclick=async()=>{
  const gid=$("#eg-game").value,st=$("#eg-status");if(!gid){setStatus(st,"Add the game to the schedule first.","err");return;}
  const {bat,pit,fld,errs}=collectEntry();if(errs.length){setStatus(st,errs[0]+". Fix that line and save again.","err");return;}
  const us=$("#eg-us").value,them=$("#eg-them").value;if(us===""||them===""){setStatus(st,"Enter the final score for both teams.","err");return;}
  const g=S.games.find(x=>x.id===gid),lu=activeLineup().map(p=>p.id);
  const ok=await run(st,`Stats entered: ${g.home?"vs":"at"} ${g.opp}, ${us}–${them}`,async()=>{
    await q(sb.from("games").update({us:+us,them:+them,status:"final",lineup:lu}).eq("id",gid));
    await q(sb.from("game_lines").upsert({game_id:gid,team_id:TEAM.id,bat,pit,fld,updated_by:me.id,updated_at:new Date().toISOString()}));
  });
  if(ok){Object.assign(g,{us:+us,them:+them,status:"final",lineup:lu});S.lines[gid]={bat,pit,fld};render();renderEntryGames(gid);setStatus(st,"Game saved. Stats are updated.","ok");}
};
$("#scan-file").addEventListener("change",()=>{const f=$("#scan-file").files[0];$("#scan-run").disabled=!(f&&aiEnabled);if(f){$("#scan-img").src=URL.createObjectURL(f);$("#scan-img").hidden=false;}});
$("#scan-run").onclick=async()=>{
  const f=$("#scan-file").files[0],st=$("#scan-status");if(!f)return;
  setStatus(st,"Reading the sheet. This usually takes 20–60 seconds.");$("#scan-run").disabled=true;
  const roster=activeLineup().map((p,i)=>`batting ${i+1}: #${p.num} ${p.name}`).join(", ");
  try{
    const blob=await resizeImage(f,2200,.85),b64=await blobToB64(blob);
    const out=await ai(`This photo is a youth baseball scoresheet. Batting columns in order: AB, R, H, 2B, 3B, HR, RBI, BB, K, HBP, SB. Pitching columns: IP, Pitches, H, R, ER, BB, K. Cells may hold a number or tally marks: count tally marks. Blank cells are 0. Our roster: ${roster}.
Return ONLY JSON: {"us":number|null,"them":number|null,"batting":[{"num":jersey,"ab":0,"r":0,"h":0,"d":0,"t":0,"hr":0,"rbi":0,"bb":0,"so":0,"hbp":0,"sb":0}],"pitching":[{"num":jersey,"ip":"2.1","pc":0,"h":0,"r":0,"er":0,"bb":0,"so":0}],"unsure":["short notes on any cell you could not read"]}. Include only rows with any marks. Use jersey numbers from the roster.`,b64,"image/jpeg");
    const byNum=n=>S.players.find(p=>p.num===+n),data={us:out.us,them:out.them,bat:{},pit:{},fld:{}};
    for(const b of out.batting||[]){const p=byNum(b.num);if(p)data.bat[p.id]=b;}
    for(const x of out.pitching||[]){const p=byNum(x.num);if(p)data.pit[p.id]={...x,outs:ipToOuts(x.ip)};}
    fillEntry(data);const u=(out.unsure||[]).filter(Boolean);
    setStatus(st,`Filled ${Object.keys(data.bat).length} batters and ${Object.keys(data.pit).length} pitchers (outlined in red). Check them against the sheet, then press Save game.${u.length?" Couldn't read clearly: "+u.join("; "):""}`,"ok");
  }catch(e){setStatus(st,e.message,"err");}
  finally{$("#scan-run").disabled=false;}
};

// ================= LIVE SCORING =================
const POS=["P","C","1B","2B","3B","SS","LF","CF","RF"];
const POSXY={P:[50,60],C:[50,90],"1B":[76,56],"2B":[63,38],"3B":[24,56],SS:[37,38],LF:[16,18],CF:[50,9],RF:[84,18]};
const POSNUM={P:1,C:2,"1B":3,"2B":4,"3B":5,SS:6,LF:7,CF:8,RF:9};
const PA_RES=[["1b","Single","hit"],["2b","Double","hit"],["3b","Triple","hit"],["hr","Home run","hit"],["bb","Walk","hit"],["hbp","Hit by pitch","hit"],["k","Strikeout","outb"],["go","Ground out","outb"],["fo","Fly / line out","outb"],["e","On error",""],["fc","Fielder's choice",""],["sac","Sacrifice","outb"]];
const RES_TXT=Object.fromEntries(PA_RES.map(([k,l])=>[k,l.toLowerCase()]));
let lvGame=null,lvChan=null,lvEvents=[],lvState=null,lvMode=lsGet("rr-mode")||"all",lvRefetch=null;
const pn=id=>{const p=S.players.find(p=>p.id===id);return p?`#${p.num} ${p.name}`:"?"};
const first=id=>{const p=S.players.find(p=>p.id===id);return p?p.name:"?"};

function replay(ev,g){
  const lu=lineupFor(g);
  const st={inning:1,top:true,outs:0,b:0,s:0,next:0,bases:[null,null,null],pos:{},us:0,them:0,line:{us:[],them:[]},bat:{},pit:{},fld:{},log:[],ended:false};
  const B=id=>st.bat[id]||(st.bat[id]={ab:0,r:0,h:0,d:0,t:0,hr:0,rbi:0,bb:0,so:0,hbp:0,sb:0});
  const P=id=>st.pit[id]||(st.pit[id]={outs:0,pc:0,h:0,r:0,er:0,bb:0,so:0});
  const F=id=>st.fld[id]||(st.fld[id]={po:0,a:0,e:0});
  const lbl=()=>(st.top?"Top ":"Bot ")+st.inning, log=t=>st.log.push({inn:lbl(),t});
  const run=side=>{const i=st.inning-1;st.line[side][i]=(st.line[side][i]||0)+1;st[side]++;};
  const endHalf=()=>{st.outs=0;st.b=0;st.s=0;st.bases=[null,null,null];if(st.top)st.top=false;else{st.top=true;st.inning++;}};
  const out=n=>{st.outs+=n;if(st.outs>=3)endHalf();}, resetCount=()=>{st.b=0;st.s=0;};
  const credit=(seq,outs)=>{const ids=seq.map(p=>st.pos[p]).filter(Boolean);if(!ids.length)return;const n=Math.max(1,Math.min(outs,ids.length));ids.slice(-n).forEach(id=>F(id).po++);new Set(ids.slice(0,-1)).forEach(id=>F(id).a++);};
  const seqTxt=seq=>seq.map(p=>POSNUM[p]).join("-");
  for(const e of ev){
    const pit=st.pos.P;
    switch(e.k){
      case "pos":st.pos={...e.map};log("Defense set: "+POS.filter(p=>e.map[p]).map(p=>p+" "+first(e.map[p])).join(", "));break;
      case "pa":{const b=B(e.pid),r=e.r;
        if(!["bb","hbp","sac"].includes(r))b.ab++;
        if(["1b","2b","3b","hr"].includes(r))b.h++;
        if(r==="2b")b.d++;if(r==="3b")b.t++;if(r==="hr")b.hr++;if(r==="bb")b.bb++;if(r==="hbp")b.hbp++;if(r==="k")b.so++;
        const nb=[null,null,null];let outs=0;const scored=[];
        for(const [rp,d] of Object.entries(e.dest||{})){if(d==="H")scored.push(rp);else if(d==="X")outs++;else nb[d-1]=rp;}
        st.bases=nb;for(const rp of scored){B(rp).r++;run("us");if(e.rbi)b.rbi++;}
        const i=lu.indexOf(e.pid);st.next=i<0?st.next:(i+1)%Math.max(1,lu.length);
        log(`${first(e.pid)}: ${RES_TXT[r]}${scored.length?`, ${scored.map(first).join(" and ")} scored`:""}${e.rbi&&scored.length?` (${scored.length} RBI)`:""}`);
        out(outs);break;}
      case "rmove":{const i=st.bases.indexOf(e.pid);if(i>=0)st.bases[i]=null;if(e.sb)B(e.pid).sb++;
        if(e.to==="H"){B(e.pid).r++;run("us");log(`${first(e.pid)} scored${e.why?" ("+e.why+")":""}`);}
        else if(e.to==="X"){log(`${first(e.pid)} out on the bases${e.why?" ("+e.why+")":""}`);out(1);}
        else{st.bases[e.to-1]=e.pid;log(`${first(e.pid)} ${e.sb?"stole":"to"} ${["","1st","2nd","3rd"][e.to]}${!e.sb&&e.why?" ("+e.why+")":""}`);}
        break;}
      case "pitch":{if(pit)P(pit).pc++;
        if(e.t==="b"){st.b++;if(st.b>=4){if(pit)P(pit).bb++;resetCount();log("Walk");}}
        else if(e.t==="s"){st.s++;if(st.s>=3){if(pit){P(pit).so++;P(pit).outs++;}if(st.pos.C)F(st.pos.C).po++;resetCount();log("Strikeout");out(1);}}
        else if(e.t==="f"){if(st.s<2)st.s++;}
        else if(e.t==="h"){resetCount();log("Hit by pitch");}
        break;}
      case "inplay":{if(pit)P(pit).pc++;resetCount();const r=e.r;
        if(["1b","2b","3b","hr"].includes(r)){if(pit)P(pit).h++;log(RES_TXT[r][0].toUpperCase()+RES_TXT[r].slice(1)+(r==="hr"?", 1 run":""));if(r==="hr"){if(pit){P(pit).r++;P(pit).er++;}run("them");}}
        else if(r==="e"){const id=st.pos[e.seq[0]];if(id)F(id).e++;log(`Reached on error by ${e.seq[0]}${id?" ("+first(id)+")":""}`);}
        else{credit(e.seq,e.outs);if(pit)P(pit).outs+=e.outs;log(`${r==="fc"?"Fielder's choice":e.outs>1?(e.outs===2?"Double play":"Triple play"):"Out"} ${seqTxt(e.seq)}`);out(e.outs);}
        break;}
      case "bout":credit(e.seq,e.outs);if(pit)P(pit).outs+=e.outs;log(`Out on the bases ${seqTxt(e.seq)}`);out(e.outs);break;
      case "orun":if(pit){P(pit).r++;if(e.earned)P(pit).er++;}run("them");log(`Run scored${e.earned?"":" (unearned)"}`);break;
      case "end":log("Half inning ended early");endHalf();break;
      case "final":st.ended=true;log("Game over");break;
    }
  }
  st.usBat=st.top!==!!g.home;st.lu=lu;st.batter=lu[st.next%Math.max(1,lu.length)];
  return st;
}
function startLive(){
  const sel=$("#lv-game"),gs=[...S.games].sort((a,b)=>a.date.localeCompare(b.date));
  const def=(gs.find(g=>g.status!=="final"&&g.date>=today())||gs.filter(g=>g.date<=today()).pop()||gs[0]||{}).id;
  sel.innerHTML=gs.map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d}, ${dParts(g.date).y} ${g.home?"vs":"at"} ${esc(g.opp)}</option>`).join("");
  const cur=lvGame||def;if(cur)sel.value=cur;
  subscribeGame(sel.value);
}
async function fetchPlays(){
  const gid=lvGame;
  try{const rows=await q(sb.from("plays").select("id,t,ev").eq("game_id",gid).order("t").limit(5000));
    if(gid!==lvGame)return;lvEvents=rows.map(r=>({id:r.id,t:r.t,...r.ev}));$("#lv-note").hidden=true;renderLive();}
  catch(e){flash("Live scores aren't loading: "+errText(e));}
}
function subscribeGame(gid){
  if(!gid){flash("Add a game to the schedule first.");return;}
  if(gid===lvGame&&lvChan)return;
  if(lvChan){sb.removeChannel(lvChan);lvChan=null;}
  lvGame=gid;lvEvents=[];renderLive();fetchPlays();
  lvChan=sb.channel("plays-"+gid).on("postgres_changes",{event:"*",schema:"public",table:"plays",filter:`game_id=eq.${gid}`},()=>{clearTimeout(lvRefetch);lvRefetch=setTimeout(fetchPlays,150);})
    .on("postgres_changes",{event:"DELETE",schema:"public",table:"plays"},()=>{clearTimeout(lvRefetch);lvRefetch=setTimeout(fetchPlays,150);})
    .subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&lvGame&&location.hash==="#live")fetchPlays();});
async function addEv(o){
  if(!canEdit)return;
  const t=Date.now(),id=uuid(),local={id,t,...o};
  lvEvents=[...lvEvents,local];renderLive();
  try{await q(sb.from("plays").insert({id,game_id:lvGame,team_id:TEAM.id,t,ev:o}));}
  catch(e){lvEvents=lvEvents.filter(x=>x.id!==id);renderLive();flash("That tap didn't save. "+errText(e)+" Tap it again.");}
}
function flash(t){const n=$("#lv-note");n.hidden=false;n.textContent=t;}
async function undo(){const last=lvEvents[lvEvents.length-1];if(!last)return;
  lvEvents=lvEvents.slice(0,-1);renderLive();
  try{await q(sb.from("plays").delete().eq("id",last.id));}catch(e){flash("Couldn't undo. "+errText(e));fetchPlays();}}

function restInfo(pc){const max=S.team.pitchMax||85,d=restDays(pc);return {d,max,cls:pc>=max-10?"w2":pc>=51?"w1":""};}
function renderLive(){
  const g=S.games.find(x=>x.id===lvGame);if(!g){$("#lv-board").innerHTML="";$("#lv-ctrl").innerHTML="";$("#lv-log").innerHTML="";return;}
  const st=lvState=replay(lvEvents,g),n=Math.max(inn(),st.inning),awayUs=!g.home;
  const curHalf=lvEvents.length?(st.ended?1e9:2*(st.inning-1)+(st.top?0:1)):-1;
  const rowFor=(side,name)=>{const isAway=(side==="us")===awayUs;return `<tr><td class="l">${esc(name)}</td>${Array.from({length:n},(_,i)=>{const h=2*i+(isAway?0:1),v=st.line[side][i],isCur=h===curHalf;return `<td class="${isCur?"cur":""}">${v!=null?v:(h<=curHalf?"0":"")}</td>`}).join("")}<td>${st[side]}</td></tr>`;};
  const away=awayUs?["us",S.team.name]:["them",g.opp],home=awayUs?["them",g.opp]:["us",S.team.name],b=st.bases;
  $("#lv-board").innerHTML=`<div class="board"><div class="tbl-wrap" style="border:0"><table><thead><tr><th class="l" style="text-align:left">${lvEvents.length?(st.ended?"Final":"Live"):"Not started"}</th>${Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join("")}<th>R</th></tr></thead><tbody>${rowFor(...away)}${rowFor(...home)}</tbody></table></div>
   ${st.ended||!lvEvents.length?"":`<div class="sit"><span class="big">${st.top?"Top":"Bottom"} ${st.inning}</span><span>Outs <span class="dots">${[0,1].map(i=>`<i class="${st.outs>i?"on":""}"></i>`).join("")}</span></span>${st.usBat?`<span class="mini-dia" aria-label="Runners on ${["1st","2nd","3rd"].filter((_,i)=>b[i]).join(", ")||"no bases"}"><span class="b1 ${b[0]?"on":""}"></span><span class="b2 ${b[1]?"on":""}"></span><span class="b3 ${b[2]?"on":""}"></span></span><span>${esc(S.team.name)} batting</span>`:`<span class="big">${st.b}-${st.s}</span><span>${esc(g.opp)} batting</span>`}</div>`}</div>`;
  $("#lv-log").innerHTML=st.log.slice(-14).reverse().map(l=>`<li><span class="inn">${l.inn}</span><span>${esc(l.t)}</span></li>`).join("")||`<li class="note">No plays yet.${canEdit?" Tap a button above to start.":""}</li>`;
  if(!canEdit){$("#lv-ctrl").innerHTML="";return;}
  const modeSeg=`<div class="seg" role="group" aria-label="What I'm scoring">${[["all","Everything"],["bat","Our at-bats"],["def","Pitching & fielding"]].map(([k,l])=>`<button type="button" data-mode="${k}" aria-pressed="${lvMode===k}">${l}</button>`).join("")}</div>`;
  const top=`<div class="lv-top">${modeSeg}<span class="row"><button type="button" data-lv="undo" ${lvEvents.length?"":"disabled"}>Undo last tap</button><button type="button" data-lv="endhalf">End half inning</button><button type="button" class="primary" data-lv="finish">Finish game</button></span></div>`;
  let body="";
  if(st.ended)body=`<div class="who"><div><div class="nm">Game over</div><div class="sub">Open the box score to check it, then save it to the season stats.</div></div><button class="primary" data-lv="review">Review box score</button></div>`;
  else if(st.usBat){
    if(lvMode==="def")body=`<div class="who"><div><div class="nm">${esc(S.team.name)} batting</div><div class="sub">The at-bat scorer has this half. Switch to Everything to take over.</div></div></div>`;
    else if(!st.lu.length)body=`<p class="note">Set this game's lineup on the Enter game tab first.</p>`;
    else{const nx=st.lu[(st.next+1)%st.lu.length];
      const rn=[0,1,2].filter(i=>b[i]).map(i=>`<button type="button" data-runner="${b[i]}">${["1st","2nd","3rd"][i]}: ${esc(first(b[i]))}</button>`).join("");
      body=`<div class="who"><div><div class="sub">Now batting (${st.next+1} in order)</div><div class="nm">${esc(pn(st.batter))}</div><div class="sub">On deck: ${esc(pn(nx))}</div></div></div>
      ${rn?`<div><h3 style="margin-bottom:6px">Runners (tap for steals and scoring)</h3><div class="runners">${rn}</div></div>`:""}
      <div class="pad">${PA_RES.map(([k,l,c])=>`<button type="button" class="${c}" data-pa="${k}">${l}</button>`).join("")}</div>`;}
  }else{
    if(lvMode==="bat")body=`<div class="who"><div><div class="nm">${esc(g.opp)} batting</div><div class="sub">The pitch scorer has this half. Switch to Everything to take over.</div></div></div>`;
    else if(!st.pos.P)body=`<div class="who"><div><div class="nm">Set the defense</div><div class="sub">Pick who's playing each position so putouts, assists, and errors go to the right player.</div></div><button class="primary" data-lv="pos">Set positions</button></div>`;
    else{const p=st.pos.P,pc=(st.pit[p]||{pc:0}).pc,ri=restInfo(pc);
      body=`<div class="who"><div><div class="sub">Pitching</div><div class="nm">${esc(pn(p))}</div><div class="sub">${pc>=ri.max?"At the daily limit":`${ri.max-pc} pitches to the ${ri.max} limit`} · ${ri.d?ri.d+" day"+(ri.d>1?"s":"")+" rest if pulled now":"no rest needed yet"}</div></div><div class="pc ${ri.cls}" aria-label="${pc} pitches">${pc}</div></div>
      <div class="pad"><button type="button" class="ball" data-p="b">Ball</button><button type="button" class="strike" data-p="s">Strike</button><button type="button" class="foul" data-p="f">Foul</button>
      <button type="button" class="wide" data-lv="inplay">Ball in play</button>
      <button type="button" data-p="h">Hit by pitch</button><button type="button" data-lv="orun">Run scored</button><button type="button" data-lv="bout">Out on bases</button>
      <button type="button" data-lv="pos" style="grid-column:span 3;min-height:44px;font-size:14px">Change pitcher or positions</button></div>`;}
  }
  $("#lv-ctrl").innerHTML=`<div class="stack" style="gap:14px">${top}${body}</div>`;
}
let sheetState=null;
function openSheet(html){$("#lv-sheet-card").innerHTML=html;$("#lv-sheet").hidden=false;const f=$("#lv-sheet-card button");if(f)f.focus();}
function closeSheet(){$("#lv-sheet").hidden=true;sheetState=null;}
$("#lv-sheet").addEventListener("click",e=>{if(e.target.id==="lv-sheet")closeSheet();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("#lv-sheet").hidden)closeSheet();$("#lightbox").hidden=true;}});
function defaultDest(r,bases,batter){
  const d={},adv={"1b":1,"2b":2,"3b":3,"hr":4,"sac":1}[r],put=(id,i,n)=>{const t=i+1+n;d[id]=t>3?"H":t;};
  if(["bb","hbp","e","fc"].includes(r)){d[batter]=1;if(bases[0]){d[bases[0]]=2;if(bases[1]){d[bases[1]]=3;if(bases[2])d[bases[2]]="H";}}bases.forEach((id,i)=>{if(id&&!(id in d))d[id]=i+1;});}
  else if(adv){bases.forEach((id,i)=>{if(id)put(id,i,adv);});d[batter]=r==="sac"?"X":(adv>3?"H":adv);}
  else{bases.forEach((id,i)=>{if(id)d[id]=i+1;});d[batter]="X";}
  return d;
}
function paSheet(r){
  const st=lvState,batter=st.batter,dest=defaultDest(r,st.bases,batter);
  if(!st.bases.some(Boolean)){addEv({k:"pa",pid:batter,r,dest,rbi:r==="hr"});return;}
  sheetState={type:"pa",r,batter,dest,rbi:!["e","k"].includes(r)};drawPaSheet();
}
function drawPaSheet(){
  const s=sheetState,opts=[[1,"1st"],[2,"2nd"],[3,"3rd"],["H","Scored"],["X","Out"]];
  const order=Object.keys(s.dest).sort((a,b)=>(a===s.batter?1:0)-(b===s.batter?1:0));
  openSheet(`<h2 id="lv-sheet-title">${esc(first(s.batter))}: ${RES_TXT[s.r]}</h2><p class="note">Where did everyone end up? The likely result is picked already. Change anything that's different, then save.</p>
  ${order.map(id=>`<div class="rrow"><b>${esc(pn(id))}${id===s.batter?" (batter)":` (was on ${["","1st","2nd","3rd"][lvState.bases.indexOf(id)+1]})`}</b><div class="seg" role="group">${opts.map(([v,l])=>`<button type="button" data-dest="${id}" data-v="${v}" aria-pressed="${String(s.dest[id])===String(v)}">${l}</button>`).join("")}</div></div>`).join("")}
  <label class="row" style="gap:8px;font-weight:600"><input type="checkbox" id="pa-rbi" ${s.rbi?"checked":""} style="width:20px;height:20px;accent-color:var(--red)"> Credit RBIs to ${esc(first(s.batter))} for runs on this play</label>
  <div class="row"><button class="primary big" type="button" data-sh="pa-save" style="flex:1">Save play</button><button type="button" data-sh="close">Cancel</button></div>`);
}
function runnerSheet(id){
  const i=lvState.bases.indexOf(id),nxt=i+2;sheetState={type:"runner",id};
  openSheet(`<h2 id="lv-sheet-title">${esc(pn(id))} on ${["1st","2nd","3rd"][i]}</h2><div class="pad">
   ${nxt<=3?`<button type="button" data-rm="${nxt}" data-sb="1" class="hit">Stole ${["","","2nd","3rd"][nxt]}</button>`:`<button type="button" data-rm="H" data-sb="1" class="hit">Stole home</button>`}
   <button type="button" data-rm="${nxt<=3?nxt:"H"}" data-why="passed ball or wild pitch">Advanced on wild pitch</button>
   <button type="button" data-rm="H" data-why="">Scored</button>
   <button type="button" data-rm="X" data-why="caught stealing" class="outb">Caught stealing</button>
   <button type="button" data-rm="X" data-why="picked off" class="outb">Picked off</button>
   <button type="button" data-sh="close">Cancel</button></div>`);
}
function fieldSheet(kind,r){sheetState={type:kind,r,seq:[],outs:1};drawFieldSheet();}
function drawFieldSheet(){
  const s=sheetState,st=lvState;
  const title=s.type==="bout"?"Out on the bases":s.r==="e"?"Who made the error?":s.r==="fc"?"Fielder's choice":"Who made the play?";
  const hint=s.r==="e"?"Tap the fielder charged with the error.":"Tap each fielder who touched the ball, in order. Example: shortstop then first base for a 6-3 ground out. A catch is one tap.";
  openSheet(`<h2 id="lv-sheet-title">${title}</h2><p class="note">${hint}</p>
   <div class="field">${POS.map(p=>{const [x,y]=POSXY[p],id=st.pos[p];return `<button type="button" data-fp="${p}" style="left:${x}%;top:${y}%" aria-pressed="${s.seq.includes(p)}">${POSNUM[p]}<small>${id?esc(first(id)):p}</small></button>`}).join("")}</div>
   <div class="seqtxt">${s.seq.map(p=>POSNUM[p]).join(" – ")||"&nbsp;"}</div>
   ${s.r==="e"?"":`<div class="row" style="justify-content:center"><span class="note">Outs on this play</span><div class="seg" role="group">${[1,2,3].map(n=>`<button type="button" data-outs="${n}" aria-pressed="${s.outs===n}">${n}</button>`).join("")}</div></div>`}
   <div class="row"><button class="primary big" type="button" data-sh="field-save" style="flex:1" ${s.seq.length?"":"disabled"}>Save play</button><button type="button" data-sh="field-clear">Clear</button><button type="button" data-sh="close">Cancel</button></div>`);
}
function inplaySheet(){
  sheetState={type:"inplay-pick"};
  openSheet(`<h2 id="lv-sheet-title">Ball in play</h2><div class="pad">
   <button type="button" class="outb" data-ip="out">Out</button><button type="button" class="hit" data-ip="1b">Single</button><button type="button" class="hit" data-ip="2b">Double</button>
   <button type="button" class="hit" data-ip="3b">Triple</button><button type="button" class="hit" data-ip="hr">Home run</button><button type="button" data-ip="e">Error</button>
   <button type="button" data-ip="fc">Fielder's choice</button><button type="button" data-sh="close" style="grid-column:span 2">Cancel</button></div>`);
}
function posSheet(){
  const st=lvState,lu=st.lu.length?st.lu:sortedPlayers().map(p=>p.id),cur={...st.pos};if(!cur.P)POS.forEach((p,i)=>{if(lu[i])cur[p]=lu[i];});
  sheetState={type:"pos"};
  const opts=id=>`<option value="">—</option>`+sortedPlayers().map(p=>`<option value="${p.id}" ${p.id===id?"selected":""}>#${p.num} ${esc(p.name)}</option>`).join("");
  openSheet(`<h2 id="lv-sheet-title">Positions</h2><p class="note">Change the pitcher here too. Pitches and outs count for whoever is on the mound.</p>
   <div class="posgrid">${POS.map(p=>`<label class="f">${p} (${POSNUM[p]})<select id="pos-${p}">${opts(cur[p])}</select></label>`).join("")}</div>
   <span class="status" id="pos-status"></span>
   <div class="row"><button class="primary big" type="button" data-sh="pos-save" style="flex:1">Save positions</button><button type="button" data-sh="close">Cancel</button></div>`);
}
function finishGame(){
  const st=lvState,g=S.games.find(x=>x.id===lvGame);
  if(st.lu.length&&!g.lineup)g.lineup=st.lu;
  pendingEnter=lvGame;pendingData={us:st.us,them:st.them,bat:st.bat,pit:st.pit,fld:st.fld};location.hash="#scorebook";
}
$("#lv-game").addEventListener("change",e=>subscribeGame(e.target.value));
$("#lv-ctrl").addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t||!lvState)return;
  if(t.dataset.mode){lvMode=t.dataset.mode;lsSet("rr-mode",lvMode);renderLive();return;}
  if(t.dataset.pa){paSheet(t.dataset.pa);return;}
  if(t.dataset.runner){runnerSheet(t.dataset.runner);return;}
  if(t.dataset.p){await addEv({k:"pitch",t:t.dataset.p});return;}
  const a=t.dataset.lv;
  if(a==="undo")undo();
  else if(a==="endhalf")openSheet(`<h2 id="lv-sheet-title">End this half inning?</h2><p class="note">Use this for a run rule or when the umpire calls it. Outs normally end the half on their own.</p><div class="row"><button class="primary big" data-sh="end-yes" type="button">End half inning</button><button type="button" data-sh="close">Cancel</button></div>`);
  else if(a==="finish")openSheet(`<h2 id="lv-sheet-title">Finish the game?</h2><p class="note">This marks the game over and opens the box score so you can check it and save it to the season stats.</p><div class="row"><button class="primary big" data-sh="fin-yes" type="button">Finish game</button><button type="button" data-sh="close">Cancel</button></div>`);
  else if(a==="review")finishGame();
  else if(a==="pos")posSheet();
  else if(a==="inplay")inplaySheet();
  else if(a==="bout")fieldSheet("bout","out");
  else if(a==="orun")openSheet(`<h2 id="lv-sheet-title">Run scored</h2><div class="pad"><button class="primary" style="grid-column:span 3;min-height:64px;font-size:20px" data-sh="orun-e" type="button">Earned run</button><button type="button" data-sh="orun-u" style="grid-column:span 2">Unearned (after an error)</button><button type="button" data-sh="close">Cancel</button></div>`);
});
$("#lv-sheet-card").addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;const s=sheetState;
  if(t.dataset.sh==="close"){closeSheet();return;}
  if(t.dataset.dest){s.dest[t.dataset.dest]=t.dataset.v==="H"||t.dataset.v==="X"?t.dataset.v:+t.dataset.v;s.rbi=$("#pa-rbi").checked;drawPaSheet();return;}
  if(t.dataset.sh==="pa-save"){const occ={};for(const [id,d] of Object.entries(s.dest)){if(typeof d==="number"){if(occ[d]){$("#lv-sheet-card .note").textContent=`Two runners can't both be on ${["","1st","2nd","3rd"][d]}. Move one of them.`;return;}occ[d]=id;}}
    const ev={k:"pa",pid:s.batter,r:s.r,dest:s.dest,rbi:$("#pa-rbi").checked};closeSheet();await addEv(ev);return;}
  if(t.dataset.rm){const to=t.dataset.rm==="H"||t.dataset.rm==="X"?t.dataset.rm:+t.dataset.rm;
    if(typeof to==="number"&&lvState.bases[to-1]){$("#lv-sheet-card h2").textContent=`${["","1st","2nd","3rd"][to]} is taken. Move that runner first.`;return;}
    const ev={k:"rmove",pid:s.id,to,sb:!!t.dataset.sb,why:t.dataset.why||""};closeSheet();await addEv(ev);return;}
  if(t.dataset.ip){const r=t.dataset.ip;if(["1b","2b","3b","hr"].includes(r)){closeSheet();await addEv({k:"inplay",r,seq:[],outs:0});}else fieldSheet("inplay",r);return;}
  if(t.dataset.fp){if(s.r==="e")s.seq=[t.dataset.fp];else s.seq.push(t.dataset.fp);drawFieldSheet();return;}
  if(t.dataset.outs){s.outs=+t.dataset.outs;drawFieldSheet();return;}
  if(t.dataset.sh==="field-clear"){s.seq=[];drawFieldSheet();return;}
  if(t.dataset.sh==="field-save"){const ev=s.type==="bout"?{k:"bout",seq:s.seq,outs:s.outs}:{k:"inplay",r:s.r,seq:s.seq,outs:s.r==="e"?0:s.outs};closeSheet();await addEv(ev);return;}
  if(t.dataset.sh==="pos-save"){const map={},used=new Set();for(const p of POS){const v=$("#pos-"+p).value;if(v){if(used.has(v)){setStatus($("#pos-status"),`${first(v)} is in two positions. Fix that, then save.`,"err");return;}used.add(v);map[p]=v;}}
    if(!map.P){setStatus($("#pos-status"),"Pick a pitcher.","err");return;}closeSheet();await addEv({k:"pos",map});return;}
  if(t.dataset.sh==="orun-e"||t.dataset.sh==="orun-u"){closeSheet();await addEv({k:"orun",earned:t.dataset.sh==="orun-e"});return;}
  if(t.dataset.sh==="end-yes"){closeSheet();await addEv({k:"end"});return;}
  if(t.dataset.sh==="fin-yes"){closeSheet();await addEv({k:"final"});finishGame();return;}
});

// ---------- start ----------
async function boot(){
  if(!sb){document.body.innerHTML=`<main class="wrap" style="padding-block:40px"><h2>Almost there</h2><p>Add the Supabase project URL and anon key to <code>config.js</code>, then redeploy.</p></main>`;return;}
  try{teams=await q(sb.from("teams").select("*").order("name"));}
  catch(e){document.body.innerHTML=`<main class="wrap" style="padding-block:40px"><h2>Can't reach the team database</h2><p>${esc(errText(e))}</p></main>`;return;}
  let tid=teamIdFromUrl();
  if(!tid&&teams.length===1)tid=teams[0].id;
  if(!tid){const last=lsGet("rr-team");if(last&&teams.some(t=>t.id===last))tid=last;}
  TEAM=teams.find(t=>t.id===tid)||null;
  if(!TEAM){
    $("#teampick").innerHTML=teams.map(t=>`<a href="${teamLink(t.id)}"><img src="${logoUrl(t)}" alt="" onerror="this.remove()"><b>${esc(t.name)}</b></a>`).join("")||`<p class="note">No teams yet. Run the database setup first.</p>`;
    $("header.band").hidden=true;$("nav.tabs").hidden=true;route();return;
  }
  lsSet("rr-team",TEAM.id);
  await loadTeamData();
  const {data}=await sb.auth.getSession();session=data.session;
  await refreshRole();render();route();
  fetch("/api/ai").then(r=>r.ok?r.json():{enabled:false}).then(j=>{aiEnabled=!!j.enabled;renderSchedule();$("#scan-run").disabled=!(aiEnabled&&$("#scan-file").files.length);
    if(!aiEnabled)$("#scan-status").textContent="Photo reading is turned off for this site. Enter numbers in the tables below.";}).catch(()=>{});
  sb.auth.onAuthStateChange(async(ev,sess)=>{
    if(ev==="INITIAL_SESSION"||ev==="TOKEN_REFRESHED")return;
    session=sess;await refreshRole();render();route();
  });
}
boot();
})();
