// Rough Riders team site. Plain JavaScript, no build step.
// Data lives in Supabase (see supabase/schema.sql). Settings come from config.js.
(function(){
"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const CFG=window.RR_CONFIG||{};
// Refuse to run with a secret key in the public config: it would bypass every access rule.
const keyRole=(()=>{try{return JSON.parse(atob(String(CFG.supabaseAnonKey).split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).role;}catch(e){return /^sb_secret_/.test(CFG.supabaseAnonKey||"")?"service_role":null;}})();
const configured=CFG.supabaseUrl&&!/PASTE_/.test(CFG.supabaseUrl)&&!/PASTE_/.test(CFG.supabaseAnonKey||"")&&keyRole!=="service_role";
const sb=configured?window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseAnonKey):null;

let S=null, TEAM=null, teams=[], session=null, role=null, myPlayer=null, siteAdmin=false, canEdit=false, isAdmin=false, isCoach=false, aiEnabled=false, aiMulti=false;
const me={id:null,email:"",name:""};
let curLineup=null, pendingEnter=null, pendingData=null, myTeams=[], myAdminTeams=[];

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
// A team's address is its web name as the first part of the path (/eastlake), a mapped
// host name from config.js, or the older ?team= form.
function teamIdFromUrl(){
  const host=location.hostname, map=CFG.hostTeams||{};
  if(map[host])return map[host];
  const seg=decodeURIComponent(location.pathname.split("/")[1]||"").toLowerCase();
  if(seg)return seg;
  return new URLSearchParams(location.search).get("team");
}
const teamPath=id=>{const host=Object.keys(CFG.hostTeams||{}).find(h=>CFG.hostTeams[h]===id);return host?`https://${host}/`:`/${encodeURIComponent(id)}`;};
const teamLink=id=>teamPath(id)+"#schedule";
const teamUrl=id=>{const p=teamPath(id);return p.startsWith("http")?p:location.origin+p;};
// Pitch-count rest rules: [[min pitches, days of rest], ...] highest first.
const PITCH_PRESETS={
  "ll":{max:85,rest:[[66,4],[51,3],[36,2],[21,1]],label:"Little League rules for ages 7–16 (daily limit is 75 for ages 9–10, 85 for 11–12)"},
  "cif-v":{max:110,rest:[[76,3],[51,2],[31,1]],label:"CIF high school varsity rules (110 pitches a game)"},
  "cif-jv":{max:90,rest:[[76,3],[51,2],[31,1]],label:"CIF high school JV and frosh rules (90 pitches a game)"}};
const restTiers=()=>Array.isArray(TEAM&&TEAM.pitch_rest)&&TEAM.pitch_rest.length?TEAM.pitch_rest:PITCH_PRESETS.ll.rest;
function presetFor(max,rest){const key=JSON.stringify(rest||PITCH_PRESETS.ll.rest);for(const [k,v] of Object.entries(PITCH_PRESETS))if(JSON.stringify(v.rest)===key&&(k==="ll"||v.max===max))return k;return "custom";}
const fmtRest=r=>r.map(([p,d])=>`${p}:${d}`).join(", ");
function parseRest(s){const out=[];for(const part of String(s).split(/[,;]+/)){const m=part.trim().match(/^(\d+)\s*[:=\-]\s*(\d+)$/);if(!part.trim())continue;if(!m)return null;out.push([+m[1],+m[2]]);}return out.sort((a,b)=>b[0]-a[0]);}
function restNote(){
  const r=restTiers(),k=presetFor(S.team.pitchMax,TEAM.pitch_rest&&TEAM.pitch_rest.length?TEAM.pitch_rest:null);
  const tiers=r.map(([p,d],i)=>`${p}${i===0?" or more":"–"+(r[i-1][0]-1)} pitches needs ${d} day${d>1?"s":""}`).join(", ");
  return `Rest days follow ${k==="custom"?"this team's rules":PITCH_PRESETS[k].label}: ${tiers}. Fewer than ${r[r.length-1][0]} needs no rest. Daily limit: ${S.team.pitchMax}. Check your league's current rulebook if anything changes.`;
}
function logoUrl(t){
  if(t.logo_path)return sb.storage.from("logos").getPublicUrl(t.logo_path).data.publicUrl;
  return `/logos/${t.id}.jpg`;
}
async function loadTeamData(){
  const [p,g,l,ic]=await Promise.all([
    sb.from("players").select("*").eq("team_id",TEAM.id),
    sb.from("games").select("*").eq("team_id",TEAM.id),
    sb.from("game_lines").select("game_id,bat,pit,fld").eq("team_id",TEAM.id),
    fetch(`/api/calsync?team=${encodeURIComponent(TEAM.id)}`).then(r=>r.json()).catch(()=>({}))]);
  TEAM.ics_source=ic&&ic.source||null;TEAM.ics_synced_at=ic&&ic.synced_at||null;
  const err=p.error||g.error||l.error; if(err)throw err;
  S={team:{name:TEAM.name,season:TEAM.season,league:TEAM.league,innings:TEAM.innings||6,pitchMax:TEAM.pitch_max||85},
     players:p.data, games:g.data.filter(x=>(x.kind||"game")==="game"), events:g.data.filter(x=>x.kind==="event"), lines:{}};
  for(const r of l.data)S.lines[r.game_id]={bat:r.bat||{},pit:r.pit||{},fld:r.fld||{}};
  const tt=await sb.rpc("team_totals",{t:TEAM.id});
  S.totals={};if(!tt.error)for(const r of tt.data||[])S.totals[r.game_id]={bat:r.bat||{},pit:r.pit||{},fld:r.fld||{}};
  const o=await sb.from("player_games").select("*").eq("team_id",TEAM.id).order("date");
  S.outside=o.error?[]:o.data; S.outsideReady=!o.error;
  // A player (or a parent linked to them) gets only their own numbers from each game.
  if(myPlayer&&!isCoach&&!l.data.length){const ml=await sb.rpc("my_lines",{t:TEAM.id});
    if(!ml.error)for(const r of ml.data||[]){if(!r.bat&&!r.pit&&!r.fld)continue;const L=S.lines[r.game_id]||(S.lines[r.game_id]={bat:{},pit:{},fld:{}});if(r.bat)L.bat[r.player_id]=r.bat;if(r.pit)L.pit[r.player_id]=r.pit;if(r.fld)L.fld[r.player_id]=r.fld;}}
}
const gameRow=g=>({id:g.id,team_id:TEAM.id,date:g.date,time:g.time||"",opp:g.opp,home:!!g.home,loc:g.loc||"",status:g.status||"scheduled",us:g.us,them:g.them,lineup:g.lineup||null,...(g.kind==="event"?{kind:"event"}:{})});
const isEvent=g=>g&&g.kind==="event";
const findItem=id=>S.games.find(x=>x.id===id)||S.events.find(x=>x.id===id);
function putItem(g){S.games=S.games.filter(x=>x.id!==g.id);S.events=S.events.filter(x=>x.id!==g.id);(isEvent(g)?S.events:S.games).push(g);}
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
async function aiImages(prompt,images){return (await api("/api/ai",{team_id:TEAM.id,prompt,images})).data;}
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
  role=null;myPlayer=null;siteAdmin=false;me.id=null;me.email="";me.name="";myTeams=[];myAdminTeams=[];
  if(session){
    me.id=session.user.id;me.email=session.user.email||"";me.name=session.user.user_metadata?.name||"";
    try{
      const [m,sa]=await Promise.all([
        sb.from("memberships").select("*").eq("user_id",me.id).eq("team_id",TEAM.id),
        sb.from("site_admins").select("user_id").eq("user_id",me.id)]);
      role=m.data?.[0]?.role||null; myPlayer=m.data?.[0]?.player_id||null; if(m.data?.[0]?.display_name)me.name=m.data[0].display_name;
      siteAdmin=!!sa.data?.length; if(siteAdmin)role="admin";
      if(siteAdmin){myTeams=teams.map(t=>t.id);myAdminTeams=myTeams.slice();}
      else{const all=await sb.from("memberships").select("team_id,role").eq("user_id",me.id);myTeams=(all.data||[]).map(x=>x.team_id);myAdminTeams=(all.data||[]).filter(x=>x.role==="admin").map(x=>x.team_id);}
    }catch(e){}
  }
  isAdmin=role==="admin"; isCoach=isAdmin||role==="coach"; canEdit=isCoach||role==="scorekeeper";
  document.body.classList.toggle("signed-in",!!session);
  document.body.classList.toggle("is-member",!!role);
  document.body.classList.toggle("can-edit",canEdit);
  document.body.classList.toggle("is-owner",isAdmin);
  document.body.classList.toggle("is-coach",isCoach);
  document.body.classList.toggle("has-mine",!!myPlayer&&!isCoach);
  const nm=$("#nav-me");if(nm)nm.textContent=role==="player"?"My page":"My player";
}
const ROLE_LABEL={admin:"Admin",coach:"Coach",scorekeeper:"Scorekeeper",parent:"Parent",player:"Player"};
function renderAcct(){
  const a=$("#acct");
  const all=teams.length>1?`<a href="/">All teams</a>`:"";
  if(session)a.innerHTML=`<div>${esc(me.name||me.email)}</div>${role?`<span class="role">${ROLE_LABEL[role]||role}</span>`:""}<div><a href="#account">My account</a> · <a href="#" data-signout>Sign out</a>${all?" · "+all:""}</div>`;
  else a.innerHTML=all?`<div>${all}</div>`:"";
  $("#rq-form").hidden=!!session;
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
async function signOut(){
  // Sign out on this device even if the server call stalls, then reload into a clean state.
  try{await Promise.race([sb.auth.signOut({scope:"local"}),new Promise(r=>setTimeout(r,3000))]);}catch(e){}
  try{Object.keys(localStorage).filter(k=>k.startsWith("sb-")).forEach(k=>localStorage.removeItem(k));}catch(e){}
  location.hash="#schedule";location.reload();
}
$("#ac-signout").onclick=signOut;
document.addEventListener("click",e=>{if(e.target.closest("[data-signout]")){e.preventDefault();signOut();}});

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
  $("#si-logo").src=lg.src;$("#favicon").href=lg.src;
  $("#h-season").textContent=[S.team.name,S.team.season,S.team.league].filter(Boolean).join(" · ");
  const r=record();
  $("#h-record").innerHTML=`<div><b>${r.w}–${r.l}${r.t?"–"+r.t:""}</b><span>Record</span></div><div><b>${r.rs}</b><span>Runs scored</span></div><div><b>${r.ra}</b><span>Runs allowed</span></div>`;
  const nx=S.games.filter(g=>g.status!=="final"&&g.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
  const ne=S.events.filter(g=>g.date>=today()).sort((a,b)=>a.date.localeCompare(b.date))[0];
  const nxt=[nx,ne].filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date))[0];
  $("#h-next").innerHTML=nxt?(isEvent(nxt)?`Next up: <strong>${esc(nxt.opp)}</strong>, <strong>${dow(nxt.date)} ${dParts(nxt.date).m} ${dParts(nxt.date).d}${nxt.time?", "+esc(nxt.time):""}</strong>${nxt.loc?" · "+esc(nxt.loc):""}`:`Next game: <strong>${dow(nxt.date)} ${dParts(nxt.date).m} ${dParts(nxt.date).d}, ${esc(nxt.time)}</strong> ${nxt.home?"vs":"at"} <strong>${esc(nxt.opp)}</strong> · ${esc(nxt.loc)}`):"Nothing on the schedule yet.";
  renderBanner();
}

// ---------- schedule ----------
function eventRowHtml(g){
  const p=dParts(g.date);
  return `<div class="game event"><div class="gdate"><div class="m">${dow(g.date)} ${p.m}</div><div class="d">${p.d}</div></div>
  <div class="gmain"><div class="gopp">${esc(g.opp)}</div><div class="gmeta">${[g.loc,g.time].filter(Boolean).map(esc).join(" · ")}</div></div>
  <div class="gres"><span class="pill ev">Event</span><small>${canEdit?`<button class="linkbtn" data-edit="${g.id}">Edit</button>`:""}</small></div></div>`;
}
// "Today", "Tomorrow", "In 5 days", "In 3 wks": the time is already on the row.
function relDay(d){const n=Math.round((new Date(d+"T12:00")-new Date(today()+"T12:00"))/864e5);return n<=0?"Today":n===1?"Tomorrow":n<14?`In ${n} days`:`In ${Math.round(n/7)} wks`;}
function gameRowHtml(g){
  if(isEvent(g))return eventRowHtml(g);
  const p=dParts(g.date); let res="";
  if(g.status==="final"&&g.us!=null){const k=g.us>g.them?"w":g.us<g.them?"l":"t";res=`<span class="pill ${k}">${k.toUpperCase()}</span>${g.us}–${g.them}`;}
  else if(g.status==="cancelled")res=`<span class="pill l">Cancelled</span>`;
  else if(g.status==="postponed")res=`<span class="pill t">Postponed</span>`;
  else if(g.date<today())res=`<span class="pill up">No score yet</span>`;
  else res=`<span class="pill up${g.date===today()?" today":""}">${relDay(g.date)}</span>`;
  const actions=[isCoach&&S.lines[g.id]?`<button class="linkbtn" data-box="${g.id}">Box score</button>`:"",canEdit?`<button class="linkbtn" data-edit="${g.id}">Edit</button>`:"",canEdit?`<button class="linkbtn" data-enter="${g.id}">${g.status!=="final"&&g.date>=today()?"Lineup":"Enter stats"}</button>`:""].filter(Boolean).join(" · ");
  return `<div class="game"><div class="gdate"><div class="m">${dow(g.date)} ${p.m}</div><div class="d">${p.d}</div></div>
  <div class="gmain"><div class="gopp">${g.home?"vs":"at"} ${esc(g.opp)}</div><div class="gmeta">${esc(g.loc)}${g.status==="final"?"":" · "+esc(g.time)}</div></div>
  <div class="gres">${res}<small>${actions}</small></div></div>`;
}
function renderSchedule(){
  const t=today(), g=[...S.games,...S.events].sort((a,b)=>a.date.localeCompare(b.date)||String(a.time).localeCompare(String(b.time)));
  const up=g.filter(x=>x.status!=="final"&&x.date>=t), done=g.filter(x=>!isEvent(x)&&(x.status==="final"||x.date<t)).reverse();
  $("#upcoming").innerHTML=up.map(gameRowHtml).join("")||`<p class="note" style="padding:12px 0">${TEAM.announcement?esc(TEAM.announcement):"Nothing scheduled yet."}${canEdit?" Add a game or event, or paste a schedule.":""}</p>`;
  $("#results").innerHTML=done.map(gameRowHtml).join("")||`<p class="note" style="padding:12px 0">No games played yet.</p>`;
  $("#open-import").hidden=!aiEnabled;
  const src=syncSources();
  $("#sp-sync").hidden=!src.length;
  const line=$("#sp-line");line.hidden=!src.length;
  if(src.length)line.textContent=src.map(s=>`Games sync from ${s.name}. ${s.at?"Last synced "+ago(s.at)+".":"Not synced yet."}`).join(" ");
}
function syncSources(){
  const out=[];
  if(TEAM.spond_group)out.push({kind:"spond",name:"Spond"+(TEAM.spond_group_name?" ("+TEAM.spond_group_name+")":""),at:TEAM.spond_synced_at});
  if(TEAM.ics_source)out.push({kind:"ics",name:TEAM.ics_source,at:TEAM.ics_synced_at});
  return out;
}
function ago(ts){const m=Math.round((Date.now()-new Date(ts))/6e4);if(m<1)return "just now";if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+" hr ago";return new Date(ts).toLocaleDateString(undefined,{month:"short",day:"numeric"});}
async function reloadTeam(){const t=await q(sb.from("teams").select("*").eq("id",TEAM.id));if(t[0])Object.assign(TEAM,t[0]);await loadTeamData();render();}
function syncSummary(r,from="Spond"){const parts=[];if(r.added)parts.push(`${r.added} new`);if(r.updated)parts.push(`${r.updated} updated`);if(r.cancelled)parts.push(`${r.cancelled} cancelled or postponed`);if(r.removed)parts.push(`${r.removed} removed`);return parts.length?`Synced from ${from}: ${parts.join(", ")}.`:`Synced. No upcoming games found in ${from} yet.`;}
let editingGame=null;
function setFormKind(k){const ev=k==="event";$("#gf-kind").value=k;$("#gf-opp-label").textContent=ev?"What":"Opponent";$("#gf-opp").placeholder=ev?"Tryouts":"";$("#gf-home-wrap").hidden=ev;$("#gf-st-wrap").hidden=ev;
  $("#game-form-title").textContent=(editingGame?"Edit ":"Add ")+(ev?"event":"game");}
function openGameForm(g,kind){
  editingGame=g?g.id:null;$("#game-form").hidden=false;setFormKind(g?(isEvent(g)?"event":"game"):(kind||"game"));$("#gf-kind").disabled=!!(g&&!isEvent(g)&&S.lines[g.id]);
  $("#gf-st").value=g&&["postponed","cancelled"].includes(g.status)?g.status:"scheduled";$("#gf-st-wrap").hidden=$("#gf-st-wrap").hidden||!!(g&&g.status==="final");
  $("#gf-date").value=g?g.date:today();$("#gf-time").value=g?g.time:"";$("#gf-opp").value=g?g.opp:"";$("#gf-home").value=g&&!g.home?"0":"1";$("#gf-loc").value=g?g.loc:"";
  $("#gf-delete").hidden=!g;setStatus($("#gf-status"),"");$("#gf-opp").focus();
}

// ---------- stats view ----------
let statType="bat", sortKey={bat:"avg",pit:"era",fld:"tc"}, sortDir={bat:-1,pit:1,fld:-1};
function pRow(pid){const p=S.players.find(p=>p.id===pid);return p?(p.call_up_of?{...p,name:p.name+" (call-up)"}:p):{num:"",name:"(removed)"};}
// Team-level stats for everyone who isn't a coach: totals and a line per game, no player names.
function teamLines(){
  const out={};
  for(const g of S.games){const tot=S.totals&&S.totals[g.id];if(tot){out[g.id]=tot;continue;}
    const L=S.lines[g.id];if(!L)continue;const sum=o=>{const x={};for(const v of Object.values(o||{}))for(const [k,n] of Object.entries(v))x[k]=(x[k]||0)+(+n||0);return x;};
    out[g.id]={bat:sum(L.bat),pit:sum(L.pit),fld:sum(L.fld)};}
  return out;
}
function renderTeamStats(){
  const T=teamLines(),games=S.games.filter(g=>T[g.id]).sort((a,b)=>a.date.localeCompare(b.date));
  const n=x=>+x||0,rate=(a,b)=>b?fmt3(a/b):"—";
  const tot={};for(const g of games){for(const [k,v] of Object.entries(T[g.id].bat))tot["b_"+k]=(tot["b_"+k]||0)+n(v);for(const [k,v] of Object.entries(T[g.id].pit))tot["p_"+k]=(tot["p_"+k]||0)+n(v);for(const [k,v] of Object.entries(T[g.id].fld))tot["f_"+k]=(tot["f_"+k]||0)+n(v);}
  const pa=n(tot.b_ab)+n(tot.b_bb)+n(tot.b_hbp),tb=n(tot.b_h)+n(tot.b_d)+2*n(tot.b_t)+3*n(tot.b_hr),ip=n(tot.p_outs)/3;
  const r=record();
  $("#stat-table").innerHTML=games.length?`<thead><tr>${["G","Record","R","H","2B","3B","HR","BB","K","SB","AVG","OBP","SLG","Runs allowed","Team ERA","K (pitching)","E"].map(x=>`<th style="cursor:default">${x}</th>`).join("")}</tr></thead><tbody><tr>
    <td>${games.length}</td><td>${r.w}–${r.l}${r.t?"–"+r.t:""}</td><td>${r.rs}</td><td>${n(tot.b_h)}</td><td>${n(tot.b_d)}</td><td>${n(tot.b_t)}</td><td>${n(tot.b_hr)}</td><td>${n(tot.b_bb)}</td><td>${n(tot.b_so)}</td><td>${n(tot.b_sb)}</td>
    <td>${rate(n(tot.b_h),n(tot.b_ab))}</td><td>${rate(n(tot.b_h)+n(tot.b_bb)+n(tot.b_hbp),pa)}</td><td>${rate(tb,n(tot.b_ab))}</td><td>${r.ra}</td><td>${ip?fmt2(n(tot.p_er)*inn()/ip):"—"}</td><td>${n(tot.p_so)}</td><td>${n(tot.f_e)}</td></tr></tbody>`:"";
  $("#team-games-wrap").hidden=!games.length;
  $("#team-games").innerHTML=games.length?`<thead><tr><th class="l" style="cursor:default">Game</th>${["Result","AB","H","2B","3B","HR","BB","K","SB","AVG"].map(x=>`<th style="cursor:default">${x}</th>`).join("")}</tr></thead><tbody>${games.slice().reverse().map(g=>{const b=T[g.id].bat;return `<tr><td class="l">${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${esc(g.opp)}</td><td>${g.us!=null?`${g.us>g.them?"W":g.us<g.them?"L":"T"} ${g.us}–${g.them}`:""}</td><td>${n(b.ab)}</td><td>${n(b.h)}</td><td>${n(b.d)}</td><td>${n(b.t)}</td><td>${n(b.hr)}</td><td>${n(b.bb)}</td><td>${n(b.so)}</td><td>${n(b.sb)}</td><td>${rate(n(b.h),n(b.ab))}</td></tr>`}).join("")}</tbody>`:"";
  const k=$("#stat-kpis");k.hidden=!games.length;
  const ng=S.games.filter(g=>g.status==="final"&&g.us!=null).length||games.length;
  k.innerHTML=games.length?[["Record",`${r.w}–${r.l}${r.t?"–"+r.t:""}`],["Team AVG",rate(n(tot.b_h),n(tot.b_ab))],["OBP",rate(n(tot.b_h)+n(tot.b_bb)+n(tot.b_hbp),pa)],["Runs / game",(r.rs/ng).toFixed(1)],["Allowed / game",(r.ra/ng).toFixed(1)],["Team ERA",ip?fmt2(n(tot.p_er)*inn()/ip):"—"]].map(([l,v])=>`<div><b>${v}</b><span>${l}</span></div>`).join(""):"";
  $("#stat-note").textContent=games.length?"Team totals. Player stats are shared with the coaching staff.":"No stats entered yet.";
}
function renderStats(){
  if(!isCoach){renderTeamStats();return;}
  $("#team-games-wrap").hidden=true;$("#stat-kpis").hidden=true;
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
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${p.id?plink(p):esc(p.name)}</td>${cols.map(([c])=>{const v=x[c];const L=lead[c]!==undefined&&v===lead[c]&&(!isRate(c)||qualified.some(q=>q.pid===pid));return `<td class="${L?"lead":""}">${isRate(c)?fmt3(v):v}</td>`}).join("")}</tr>`}).join("")+
      (rows.length?`<tr class="total"><td></td><td class="l">Team</td><td></td><td>${tpa}</td>${BAT.map(([c])=>`<td>${tot[c]}</td>`).join("")}<td>${fmt3(ta)}</td><td>${fmt3(to)}</td><td>${fmt3(ts)}</td><td>${fmt3(to+ts)}</td></tr>`:"")+`</tbody>`;
    $("#stat-note").textContent=rows.length?"Red marks the team leader. Rate leaders need at least one plate appearance per game played. Tap a column to sort.":"No stats entered yet.";
  }else if(statType==="fld"){
    const t={};for(const [g,L] of Object.entries(S.lines)){if(gid&&g!==gid)continue;for(const [pid,f] of Object.entries(L.fld||{})){const x=t[pid]||(t[pid]={g:0,po:0,a:0,e:0});x.g++;for(const [k] of FLD)x[k]+=+f[k]||0;}}
    for(const x of Object.values(t)){x.tc=x.po+x.a+x.e;x.pct=x.tc?(x.po+x.a)/x.tc:NaN;}
    const cols=[["g","G"],["po","PO"],["a","A"],["e","E"],["tc","TC"],["pct","FLD%"]],rows=Object.entries(t).map(([pid,x])=>({pid,x})),k=sortKey.fld,dir=sortDir.fld;
    rows.sort((a,b)=>((isNaN(a.x[k])?-1:a.x[k])-(isNaN(b.x[k])?-1:b.x[k]))*dir);
    tbl.innerHTML=`<thead><tr><th class="l">#</th><th class="l">Player</th>${cols.map(([c,l])=>`<th data-k="${c}" ${k===c?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${l}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${p.id?plink(p):esc(p.name)}</td>${cols.map(([c])=>`<td>${c==="pct"?fmt3(x[c]):x[c]}</td>`).join("")}</tr>`}).join("")+`</tbody>`;
    $("#stat-note").textContent=rows.length?"PO is putouts, A is assists, E is errors, TC is total chances.":"No fielding entered yet. Live scoring records it automatically.";
  }else{
    const T=pitTotals(gid),cols=[["g","G"],["ip","IP"],["pc","Pitches"],["h","H"],["r","R"],["er","ER"],["bb","BB"],["so","K"],["era","ERA"],["whip","WHIP"],["k6","K/"+inn()]];
    const rows=Object.entries(T).map(([pid,x])=>({pid,x})),k=sortKey.pit,dir=sortDir.pit,val=(x,c)=>c==="ip"?x.outs:x[c];
    rows.sort((a,b)=>{const va=val(a.x,k),vb=val(b.x,k);return ((isNaN(va)?1e9*dir:va)-(isNaN(vb)?1e9*dir:vb))*dir});
    tbl.innerHTML=`<thead><tr><th class="l">#</th><th class="l">Pitcher</th>${cols.map(([c,l])=>`<th data-k="${c}" ${k===c?`aria-sort="${dir<0?"descending":"ascending"}"`:""}>${l}</th>`).join("")}</tr></thead><tbody>`+
      rows.map(({pid,x})=>{const p=pRow(pid);return `<tr><td class="num l">${p.num}</td><td class="l">${p.id?plink(p):esc(p.name)}</td>${cols.map(([c])=>`<td>${c==="ip"?outsToIp(x.outs):["era","whip","k6"].includes(c)?fmt2(x[c]):x[c]}</td>`).join("")}</tr>`}).join("")+`</tbody>`;
    $("#stat-note").textContent=rows.length?`ERA and strikeouts are scaled to a ${inn()}-inning game. Tap a column to sort.`:"No pitching entered yet.";
  }
  renderAvail();
}
function restDays(pc){for(const [p,d] of restTiers())if(pc>=p)return d;return 0;}
function renderAvail(){
  $("#rest-note").textContent=restNote();
  const last={};for(const p of S.players){const l=lastOuting(p.id);if(l)last[p.id]=l;}
  const t=new Date(today()+"T12:00");
  $("#avail").innerHTML=sortedPlayers().filter(p=>last[p.id]).map(p=>{const l=last[p.id],need=restDays(l.pc),d=new Date(l.date+"T12:00"),free=new Date(d);free.setDate(d.getDate()+need+1);const ok=t>=free;
    return `<div class="av"><div><b>#${p.num} ${plink(p)}</b><div class="s">${l.pc} pitches on ${dParts(l.date).m} ${dParts(l.date).d}${l.outside?" (outside game)":""}</div></div><span class="chip ${ok?"ok":"rest"}">${ok?"Available":"Rest until "+MON[free.getMonth()]+" "+free.getDate()}</span></div>`}).join("")||`<p class="note">No pitching outings yet.</p>`;
}

// ---------- roster ----------
let editingPlayer=null;
// ---------- positions (kids can have several primary and backup spots) ----------
const posP=p=>Array.isArray(p&&p.pos_primary)?p.pos_primary:[], posB=p=>Array.isArray(p&&p.pos_backup)?p.pos_backup:[];
const posSort=a=>[...a].sort((x,y)=>POS.indexOf(x)-POS.indexOf(y));
function posLine(p){const a=posSort(posP(p)),b=posSort(posB(p));if(!a.length&&!b.length)return "";
  return `<div class="posline">${a.map(x=>`<span class="pos pri">${x}</span>`).join("")}${b.map(x=>`<span class="pos bak">${x}</span>`).join("")}</div>`;}
let pfPos={};
function renderPosChips(){$("#pf-pos").innerHTML=POS.map(x=>{const v=pfPos[x]||"";return `<button type="button" data-pp="${x}" class="${v}" aria-label="${x}: ${v==="pri"?"primary":v==="bak"?"backup":"not set"}">${x}<small>${v==="pri"?"Primary":v==="bak"?"Backup":"&nbsp;"}</small></button>`}).join("");}
$("#pf-pos").onclick=e=>{const b=e.target.closest("[data-pp]");if(!b)return;const x=b.dataset.pp;pfPos[x]=!pfPos[x]?"pri":pfPos[x]==="pri"?"bak":"";renderPosChips();};
function setPosForm(p){pfPos={};posP(p).forEach(x=>pfPos[x]="pri");posB(p).forEach(x=>{if(!pfPos[x])pfPos[x]="bak";});renderPosChips();}
function renderDepth(){
  const t=$("#depth");if(!t)return;const ps=S.players.filter(p=>p.active!==false&&!p.call_up_of);
  const nm=p=>`#${p.num} ${esc(p.name)}`;
  t.innerHTML=`<thead><tr><th class="l" style="cursor:default">Pos</th><th class="l" style="cursor:default">Primary</th><th class="l" style="cursor:default">Backup</th></tr></thead><tbody>${POS.map(x=>{
    const a=ps.filter(p=>posP(p).includes(x)),b=ps.filter(p=>posB(p).includes(x)&&!posP(p).includes(x));
    return `<tr><td class="l"><b>${x}</b></td><td class="l ${a.length?"":"gap"}">${a.map(nm).join(", ")||"No one"}</td><td class="l ${a.length||b.length?"":"gap"}">${b.map(nm).join(", ")||"—"}</td></tr>`}).join("")}</tbody>`;
  const none=ps.filter(p=>!posP(p).length&&!posB(p).length);
  $("#depth-box").querySelector(".note").innerHTML=`Who plays where, from each player's primary and backup positions. Red means a position has no one listed.${none.length?` <b>No positions yet:</b> ${none.map(nm).join(", ")}.`:""}`;
}
function renderRoster(){
  const T=batTotals(""),P=pitTotals("");
  const hidden=rosterHidden();
  $("#roster-hidden").hidden=!hidden;
  if(hidden)$("#roster-hidden").textContent=canEdit?`This roster is hidden from the public until ${fmtWhen(TEAM.roster_reveal_at)}. You can see it because you're staff.`:`The roster will be posted ${fmtWhen(TEAM.roster_reveal_at)}.`;
  if(TEAM.roster_reveal_at){const d=new Date(TEAM.roster_reveal_at);$("#rv-at").value=new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,16);}else $("#rv-at").value="";
  $("#roster").innerHTML=sortedPlayers().map(p=>{const b=T[p.id],q=P[p.id];
    return `<div class="card"><div class="jersey">${p.num}</div><div style="min-width:0;flex:1"><div class="nm">${plink(p)}</div>${posLine(p)}${isCoach?`<div class="ln">${b?`${fmt3(b.avg)} AVG · ${b.h} H · ${b.rbi} RBI`:"No at-bats yet"}</div>${q?`<div class="ln">${outsToIp(q.outs)} IP · ${fmt2(q.era)} ERA</div>`:""}`:""}${canEdit?`<button class="linkbtn" data-pedit="${p.id}">Edit</button>`:""}</div></div>`}).join("")||`<p class="note">No players yet.</p>`;
  if(hidden&&!canEdit)$("#roster").innerHTML="";
  renderDepth();
  $("#ts-school").value=TEAM.school||"";$("#ts-name").value=TEAM.name||"";$("#ts-announce").value=TEAM.announcement||"";
  $("#ts-season").value=S.team.season||"";$("#ts-league").value=S.team.league||"";$("#ts-inn").value=inn();$("#ts-pmax").value=S.team.pitchMax||85;
  $("#ts-prest").value=fmtRest(restTiers());$("#ts-prules").value=presetFor(S.team.pitchMax,TEAM.pitch_rest&&TEAM.pitch_rest.length?TEAM.pitch_rest:null);
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
// ---------- Spond RSVPs fill the lineup for upcoming games ----------
const rsvps={};
const dot=t=>String(t).replace(/\.$/,"")+".";
const fromSpond=g=>!!(g&&g.spond_id&&!String(g.spond_id).startsWith("ics:")&&TEAM.spond_group);
async function loadRsvp(force,addMembers){
  const g=curGame(),box=$("#lu-rsvp");if(!box)return;
  $("#lu-spond").hidden=!(canEdit&&fromSpond(g));
  if(!canEdit||!fromSpond(g)||g.status==="final"){box.innerHTML="";return;}
  box.innerHTML=`<p class="note">Checking who's coming in Spond…</p>`;
  let r;try{r=await api("/api/spond",{action:"rsvp",team_id:TEAM.id,game_id:g.id,...(addMembers?{add_members:addMembers}:{})});}catch(e){box.innerHTML=`<p class="note">${esc(e.message)}</p>`;return;}
  if(curGame()!==g)return;
  if(r.error){box.innerHTML=`<p class="note">${esc(r.error)}</p>`;return;}
  // Kids Spond just added to the roster.
  for(const u of r.renamed||[]){const p=S.players.find(x=>x.id===u.id);if(p){p.name=u.name;p.num=u.num;}}
  for(const p of r.added||[])if(!S.players.some(x=>x.id===p.id)){S.players.push({...p,pos_primary:[],pos_backup:[]});curLineup.order.push(p.id);}
  rsvps[g.id]={going:new Set(r.going),no:new Set(r.not_going),maybe:new Set([...(r.no_answer||[]),...(r.waiting||[])])};
  const going=rsvps[g.id].going,changes=[];
  if(force||!Array.isArray(g.lineup)){
    // No saved lineup yet (or asked to start over): everyone going, in roster order.
    curLineup.order=[...curLineup.order.filter(id=>going.has(id)),...curLineup.order.filter(id=>!going.has(id))];curLineup.on=new Set(curLineup.order.filter(id=>going.has(id)));
  }else{
    // Saved lineup: keep the coach's order, add kids who said going since, take out kids who now can't make it.
    for(const id of curLineup.order){if(going.has(id)&&!curLineup.on.has(id)){curLineup.on.add(id);changes.push("+"+id);}else if(rsvps[g.id].no.has(id)&&curLineup.on.has(id)){curLineup.on.delete(id);changes.push("-"+id);}}
    const on=curLineup.order.filter(id=>curLineup.on.has(id)&&!changes.includes("+"+id)),added=changes.filter(c=>c[0]==="+").map(c=>c.slice(1));
    curLineup.order=[...on,...added,...curLineup.order.filter(id=>!curLineup.on.has(id))];
  }
  renderLineup();rebuildTables();
  const nm=ids=>ids.map(id=>(S.players.find(p=>p.id===id)||{}).name).filter(Boolean).map(esc).join(", ");
  const ins=changes.filter(c=>c[0]==="+").map(c=>c.slice(1)),outs=changes.filter(c=>c[0]==="-").map(c=>c.slice(1));
  box.innerHTML=`<p class="note"><b>Spond:</b> ${r.going.length} going, ${r.not_going.length} can't make it, ${(r.no_answer||[]).length} haven't answered.${(r.added||[]).length?` <br><b>New on the roster from Spond:</b> ${dot((r.added||[]).map(p=>esc(p.name)+(+p.num?` #${p.num}`:"")).join(", "))}${(r.added||[]).some(p=>!+p.num)?" Spond didn't have a jersey number for "+dot((r.added||[]).filter(p=>!+p.num).map(p=>esc(p.name)).join(", "))+" Add it on the Roster tab.":""}`:""}${force||!Array.isArray(g.lineup)?" <br>The lineup below is filled in from Spond; drag to set the order, then Save lineup.":ins.length||outs.length?` <br><b>Changed since you saved:</b> ${ins.length?`added ${nm(ins)} (said going)`:""}${ins.length&&outs.length?"; ":""}${outs.length?`took out ${nm(outs)} (can't make it)`:""}. Press Save lineup to keep it.`:" <br>Your saved lineup matches Spond."}${r.not_going.length?` <br>Out: ${dot(nm(r.not_going))}`:""}</p>${(r.unmatched||[]).length?`<div class="banner sp-unm"><div><b>In Spond, not on this roster yet:</b> kids are added on their own when they say going. To add them now, tap Add.
    ${(r.unmatched||[]).map(u=>`<div class="sp-unm-row"><span>${esc(u.name)} <span class="note">(${esc(u.answer)})</span></span><button type="button" data-spadd="${esc(u.id)}">Add to roster</button></div>`).join("")}
    ${(r.unmatched||[]).length>1?`<button type="button" class="primary" data-spadd="all">Add all ${(r.unmatched||[]).length}</button>`:""}
    <div class="note">Already on the roster under another name? Give them the same jersey number as in Spond and they'll match.</div></div></div>`:""}`;
  box.querySelectorAll("[data-spadd]").forEach(b=>b.onclick=()=>{b.disabled=true;b.textContent="Adding…";loadRsvp(false,b.dataset.spadd==="all"?(r.unmatched||[]).map(u=>u.id):[b.dataset.spadd]);});
}
function renderLineup(){
  let n=0;const rv=rsvps[(curGame()||{}).id];
  const badge=id=>!rv?"":rv.going.has(id)?`<span class="rsvp yes" title="Going in Spond">Going</span>`:rv.no.has(id)?`<span class="rsvp no" title="Can't make it in Spond">Out</span>`:rv.maybe.has(id)?`<span class="rsvp maybe" title="No answer in Spond">?</span>`:"";
  $("#lineup").innerHTML=curLineup.order.map(id=>{const p=S.players.find(p=>p.id===id);if(!p)return "";const on=curLineup.on.has(id);
    return `<li class="${on?"":"out"}" data-li="${id}"><span class="drag" data-drag="${id}" aria-hidden="true" title="Drag to reorder">⠿</span><span class="ord">${on?++n:"–"}</span><input type="checkbox" id="lu-${id}" data-lu-on="${id}" ${on?"checked":""} aria-label="${esc(p.name)} is playing"><span class="jersey" style="font-size:20px;min-width:0">${p.num}</span><label for="lu-${id}">${esc(p.name)}${p.call_up_of?' <span class="note">(call-up)</span>':""} ${badge(id)}</label><span class="arr"><button type="button" data-lu-up="${id}" aria-label="Move ${esc(p.name)} up">↑</button><button type="button" data-lu-dn="${id}" aria-label="Move ${esc(p.name)} down">↓</button></span></li>`}).join("")||`<li class="note">Add players on the Roster tab first.</li>`;
}
function rebuildTables(){
  const snap={};$$("#eb-table input,#ep-table input,#ef-table input").forEach(i=>snap[i.id]=i.value);
  const g=curGame();buildTables(S.lines[g&&g.id]||{bat:{},pit:{}},null);
  $$("#eb-table input,#ep-table input,#ef-table input").forEach(i=>{if(i.id in snap)i.value=snap[i.id];});
}
function fillEntry(data){
  const g=curGame();
  $("#eg-us").value=data&&data.us!=null?data.us:(g&&g.us!=null?g.us:"");$("#eg-them").value=data&&data.them!=null?data.them:(g&&g.them!=null?g.them:"");
  if(!data){loadLineup();renderLineup();loadCallups();loadRsvp(false);}
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
// Media rows: kind photo|video, path (stored file) or url (YouTube), players[] tags, team_tag, game_id, caption.
const gname=id=>{const g=S.games.find(x=>x.id===id);return g?`${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${g.opp}`:"";};
let upTags=new Set();
function chipsHtml(sel){
  return `<button type="button" class="team" data-tag="team" aria-pressed="${sel.has("team")}">Team</button>`+sortedPlayers().map(p=>`<button type="button" data-tag="${p.id}" aria-pressed="${sel.has(p.id)}">#${p.num} ${esc(p.name)}</button>`).join("");
}
function chipToggle(e,sel,box){const b=e.target.closest("[data-tag]");if(!b)return;const t=b.dataset.tag;sel.has(t)?sel.delete(t):sel.add(t);b.setAttribute("aria-pressed",sel.has(t));}
$("#ph-tags").addEventListener("click",e=>chipToggle(e,upTags));
const tagFields=sel=>({players:[...sel].filter(t=>t!=="team"),team_tag:sel.has("team")});
async function signedUrls(rows){
  const paths=rows.filter(m=>m.path).map(m=>m.path),urls={};
  for(let i=0;i<paths.length;i+=100){const {data}=await sb.storage.from("media").createSignedUrls(paths.slice(i,i+100),3600);(data||[]).forEach(d=>{if(d.signedUrl)urls[d.path]=d.signedUrl;});}
  return urls;
}
function tileHtml(m,urls){
  const canEdit_=isCoach, del=isCoach?` · <button class="linkbtn" data-mdel="${m.id}">Delete</button>`:"";
  const edit=canEdit_?`<button class="linkbtn" data-mtag="${m.id}">Tag</button>${aiEnabled&&m.path&&(m.players||[]).length?` · <button class="linkbtn" data-mai="${m.id}">AI review</button>`:""}`:"";
  const cap=[m.caption,gname(m.game_id)].filter(Boolean).join(" · ");
  const tags=!isCoach?"":[m.team_tag?`<span>Team</span>`:"",...(m.players||[]).map(id=>{const p=S.players.find(x=>x.id===id);return p?`<a href="#player-${p.id}">#${p.num} ${esc(p.name)}</a>`:""})].join("")||(canEdit_?`<span>Not tagged</span>`:"");
  const foot=`<div class="cap"><span>${esc(cap)}</span><span>${edit}${del}</span></div>${tags?`<div class="tags">${tags}</div>`:""}`;
  if(m.kind==="video"&&m.url){const id=ytId(m.url);return id?`<div class="tile video" id="tile-${m.id}"><div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${esc(m.caption||"Team video")}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>${foot}</div>`:"";}
  const u=urls[m.path];if(!u)return "";
  if(m.kind==="video")return `<div class="tile video" id="tile-${m.id}"><video src="${u}" controls preload="metadata" playsinline></video>${foot}</div>`;
  return `<div class="tile" id="tile-${m.id}"><img src="${u}" alt="${esc(m.caption||"Team photo")}" loading="lazy" data-full="${u}">${foot}</div>`;
}
async function renderMedia(el,filter){
  el.innerHTML=`<p class="note">Loading…</p>`;
  try{
    let qy=sb.from("media").select("*").eq("team_id",TEAM.id).order("created_at",{ascending:false}).limit(300);
    if(filter==="team")qy=qy.eq("team_tag",true);
    else if(filter==="untagged")qy=qy.eq("team_tag",false).eq("players","{}");
    else if(filter)qy=qy.contains("players",[filter]);
    const rows=await q(qy);rows.forEach(r=>{mediaById[r.id]=r;});
    const urls=await signedUrls(rows);
    el.innerHTML=rows.map(m=>tileHtml(m,urls)).join("")||`<p class="note">${filter?"Nothing tagged here yet.":"No photos or videos yet. Add the first ones above."}</p>`;
  }catch(e){el.innerHTML=`<p class="status err">${esc(/players|team_tag/.test(e.message||"")?"Photo tags aren't set up yet. Run supabase/005_players_media.sql in Supabase.":errText(e))}</p>`;}
}
const mediaById={};
async function renderPhotos(){
  const note=$("#ph-note"),gal=$("#gallery");
  $("#ph-game").innerHTML=`<option value="">None</option>`+[...S.games].sort((a,b)=>b.date.localeCompare(a.date)).map(g=>`<option value="${g.id}">${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${esc(g.opp)}</option>`).join("");
  $("#ph-tags").innerHTML=chipsHtml(upTags);
  const f=$("#ph-filter"),cur=f.value;
  f.innerHTML=`<option value="">Everything</option><option value="team">Team photos</option><option value="untagged">Not tagged yet</option>`+sortedPlayers().map(p=>`<option value="${p.id}">#${p.num} ${esc(p.name)}</option>`).join("");f.value=cur;
  if(!isCoach){note.textContent="Team photos. Photos of individual players and video are shared with the coaching staff only.";renderMedia(gal,"team");return;}
  note.textContent="Photos tagged Team are public. Everything else, including video, is visible to coaches and admins only.";
  renderMedia(gal,f.value);
}
$("#ph-filter").addEventListener("change",()=>renderMedia($("#gallery"),$("#ph-filter").value));
$("#ph-upload").onclick=async()=>{
  const files=[...$("#ph-files").files],st=$("#ph-status");
  if(!files.length){setStatus(st,"Choose one or more photos or clips first.","err");return;}
  if(!upTags.size){setStatus(st,"Tap who's in it, or Team, so it shows up on the right player pages.","err");return;}
  const big=files.find(f=>f.type.startsWith("video/")&&f.size>50*1024*1024);
  if(big){setStatus(st,`${big.name} is over 50 MB. Trim it to the play, record at 720p, or use a YouTube link.`,"err");return;}
  $("#ph-upload").disabled=true;let ok=0;const added=[];
  try{
    for(const f of files){
      setStatus(st,`Uploading ${ok+1} of ${files.length}…`);
      const isVid=f.type.startsWith("video/");
      const blob=isVid?f:await resizeImage(f,2048,.85);
      const ext=isVid?((f.name.match(/\.(mp4|mov|webm|m4v)$/i)||[,"mp4"])[1].toLowerCase()):"jpg";
      const path=`${TEAM.id}/${uuid()}.${ext}`,mime=isVid?(f.type||"video/mp4"):"image/jpeg";
      const up=await sb.storage.from("media").upload(path,blob,{contentType:mime});if(up.error)throw up.error;
      const row=await q(sb.from("media").insert({team_id:TEAM.id,kind:isVid?"video":"photo",path,mime,caption:$("#ph-cap").value.trim(),game_id:$("#ph-game").value||null,...tagFields(upTags)}).select());
      added.push(row[0]);ok++;
    }
    setStatus(st,`Added ${ok}.`,"ok");$("#ph-files").value="";$("#ph-cap").value="";upTags=new Set();$("#ph-tags").innerHTML=chipsHtml(upTags);renderMedia($("#gallery"),$("#ph-filter").value);
    if($("#ph-ai").checked&&aiEnabled)autoReview(added,$("#ph-ai-focus").value,st);
  }catch(e){setStatus(st,(ok?`Added ${ok}, then stopped: `:"")+(/players|team_tag|mime/.test(e.message||"")?"Photo tags aren't set up yet. Run supabase/005_players_media.sql in Supabase.":errText(e)),"err");}
  finally{$("#ph-upload").disabled=false;}
};
$("#vd-add").onclick=async()=>{
  const u=$("#vd-url").value.trim(),st=$("#ph-status");
  if(!ytId(u)){setStatus(st,"That doesn't look like a YouTube link. Copy it from YouTube's Share button.","err");return;}
  if(!upTags.size){setStatus(st,"Tap who's in it, or Team, first.","err");return;}
  try{await q(sb.from("media").insert({team_id:TEAM.id,kind:"video",url:u,caption:$("#ph-cap").value.trim(),game_id:$("#ph-game").value||null,...tagFields(upTags)}));
    setStatus(st,"Video added.","ok");$("#vd-url").value="";$("#ph-cap").value="";upTags=new Set();$("#ph-tags").innerHTML=chipsHtml(upTags);renderMedia($("#gallery"),$("#ph-filter").value);}
  catch(e){setStatus(st,errText(e),"err");}
};
let pendingDel=null,tagSel=null,tagId=null;
async function onMediaClick(e){
  const img=e.target.closest("img[data-full]");
  if(img){$("#lb-img").src=img.dataset.full;$("#lb-img").alt=img.alt;$("#lightbox").hidden=false;return;}
  const t=e.target.closest("[data-mtag]");
  if(t){const m=mediaById[t.dataset.mtag];tagId=m.id;tagSel=new Set([...(m.players||[]),...(m.team_tag?["team"]:[])]);$("#tag-chips").innerHTML=chipsHtml(tagSel);$("#tag-cap").value=m.caption||"";setStatus($("#tag-status"),"");$("#tag-sheet").hidden=false;$("#tag-save").focus();return;}
  const d=e.target.closest("[data-mdel]");if(!d)return;
  if(pendingDel!==d.dataset.mdel){pendingDel=d.dataset.mdel;d.textContent="Tap again to delete";setTimeout(()=>{if(pendingDel===d.dataset.mdel){pendingDel=null;d.textContent="Delete";}},4000);return;}
  pendingDel=null;const m=mediaById[d.dataset.mdel];
  try{if(m.path)await sb.storage.from("media").remove([m.path]);await q(sb.from("media").delete().eq("id",m.id));d.closest(".tile").remove();}
  catch(err){setStatus($("#ph-status"),errText(err),"err");}
}
$("#gallery").addEventListener("click",onMediaClick);
$("#pl-gallery").addEventListener("click",onMediaClick);
$("#pl-mine").addEventListener("click",e=>{if(e.target.closest("img[data-full]"))onMediaClick(e);});
$("#tag-chips").addEventListener("click",e=>chipToggle(e,tagSel));
$("#tag-cancel").onclick=()=>{$("#tag-sheet").hidden=true;};
$("#tag-sheet").addEventListener("click",e=>{if(e.target.id==="tag-sheet")$("#tag-sheet").hidden=true;});
$("#tag-save").onclick=async()=>{
  const st=$("#tag-status");
  try{const f={...tagFields(tagSel),caption:$("#tag-cap").value.trim()};await q(sb.from("media").update(f).eq("id",tagId));Object.assign(mediaById[tagId],f);$("#tag-sheet").hidden=true;
    if(curView==="player")renderPlayer(curPlayer);else renderMedia($("#gallery"),$("#ph-filter").value);}
  catch(e){setStatus(st,errText(e),"err");}
};

// ---------- player pages ----------
let curPlayer=null,curView=null;
const TOPICS={general:"General",hitting:"Hitting",pitching:"Pitching",fielding:"Fielding",baserunning:"Baserunning",effort:"Effort and attitude"};
const plink=p=>isCoach?`<a class="pl" href="#player-${p.id}">${esc(p.name)}</a>`:esc(p.name);
// Every game line for one player: team games plus games played outside the team.
function playerLines(pid,incOut){
  const out=[];
  for(const g of S.games){const L=S.lines[g.id];if(!L)continue;const b=(L.bat||{})[pid],q_=(L.pit||{})[pid],f=(L.fld||{})[pid];
    if(b||q_||f)out.push({kind:"team",date:g.date,label:`${g.home?"vs":"at"} ${g.opp}`,res:g.us!=null?`${g.us>g.them?"W":g.us<g.them?"L":"T"} ${g.us}–${g.them}`:"",bat:b,pit:q_,fld:f});}
  if(incOut)for(const o of S.outside||[])if(o.player_id===pid)out.push({kind:"outside",id:o.id,date:o.date,label:o.event,res:"",bat:o.bat,pit:o.pit,fld:o.fld});
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
function lastOuting(pid){let l=null;for(const r of playerLines(pid,true))if(r.pit&&(+r.pit.pc||0)>0&&(!l||r.date>=l.date))l={date:r.date,pc:+r.pit.pc||0,outside:r.kind==="outside"};return l;}
function aggBat(rows){const x={g:0};for(const r of rows)if(r.bat){x.g++;for(const [k] of BAT)x[k]=(x[k]||0)+(+r.bat[k]||0);}if(!x.g)return null;const tb=x.h+x.d+2*x.t+3*x.hr,pa=x.ab+x.bb+x.hbp;Object.assign(x,{pa,avg:x.ab?x.h/x.ab:NaN,obp:pa?(x.h+x.bb+x.hbp)/pa:NaN,slg:x.ab?tb/x.ab:NaN});x.ops=x.obp+x.slg;return x;}
function aggPit(rows){const x={g:0,outs:0,pc:0,h:0,r:0,er:0,bb:0,so:0};for(const r of rows)if(r.pit){x.g++;x.outs+=+r.pit.outs||0;for(const k of ["pc","h","r","er","bb","so"])x[k]+=+r.pit[k]||0;}if(!x.g)return null;const ip=x.outs/3;Object.assign(x,{era:ip?x.er*inn()/ip:NaN,whip:ip?(x.bb+x.h)/ip:NaN});return x;}
function aggFld(rows){const x={g:0,po:0,a:0,e:0};for(const r of rows)if(r.fld){x.g++;for(const k of ["po","a","e"])x[k]+=+r.fld[k]||0;}if(!x.g)return null;x.tc=x.po+x.a+x.e;x.pct=x.tc?(x.po+x.a)/x.tc:NaN;return x;}

// ---- small trend charts (single series; hollow marks = outside games) ----
const fmtDay=d=>{const [y,m,dd]=d.split("-");return `${MON[+m-1]} ${+dd}`;};
function niceTicks(lo,hi,n=3){if(lo===hi){lo-=1;hi+=1;}const span=hi-lo,raw=span/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),step=[1,2,2.5,5,10].map(s=>s*mag).find(s=>span/s<=n)||raw;const a=Math.floor(lo/step)*step,b=Math.ceil(hi/step)*step,t=[];for(let v=a;v<=b+step/2;v+=step)t.push(+v.toFixed(6));return t;}
function trendCard({title,big,sub,pts,yfmt,bars,refY,refLabel,yMin,foot}){
  const W=320,H=130,L=36,R=10,T=10,B=22,iw=W-L-R,ih=H-T-B;
  const ys=pts.map(p=>p.y).concat(refY!=null?[refY]:[]);let lo=yMin!=null?yMin:Math.min(...ys),hi=Math.max(...ys);
  if(yMin==null){const pad=(hi-lo)*.15||Math.abs(hi)*.05||1;lo-=pad;hi+=pad;}
  const ticks=niceTicks(lo,hi);lo=ticks[0];hi=ticks[ticks.length-1];
  const sy=v=>T+ih-(v-lo)/(hi-lo)*ih;
  const ts=pts.map(p=>new Date(p.date+"T12:00").getTime()),t0=Math.min(...ts),t1=Math.max(...ts);
  const n=pts.length,band=iw/Math.max(n,1),bw=Math.min(24,band*.6);
  const sx=bars?(i=>L+band*i+band/2):(i=>t1===t0?L+iw/2:L+(ts[i]-t0)/(t1-t0)*iw);
  let g=ticks.map(v=>`<line class="grid" x1="${L}" x2="${W-R}" y1="${sy(v)}" y2="${sy(v)}"/><text x="${L-6}" y="${sy(v)+4}" text-anchor="end">${yfmt(v,true)}</text>`).join("");
  if(refY!=null)g+=`<line class="ref" x1="${L}" x2="${W-R}" y1="${sy(refY)}" y2="${sy(refY)}"/><text x="${W-R}" y="${sy(refY)-4}" text-anchor="end">${esc(refLabel||"")}</text>`;
  g+=`<text x="${L}" y="${H-4}">${fmtDay(pts[0].date)}</text>${n>1?`<text x="${W-R}" y="${H-4}" text-anchor="end">${fmtDay(pts[n-1].date)}</text>`:""}`;
  let m="";
  if(bars){m=pts.map((p,i)=>{const x=sx(i)-bw/2,y=sy(p.y),h=Math.max(0,sy(lo)-y),r=Math.min(4,h,bw/2);return `<path class="bar${p.hollow?" hollow":""}" d="M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+bw-r}Q${x+bw},${y} ${x+bw},${y+r}V${y+h}Z"/>`;}).join("");}
  else{const d=pts.map((p,i)=>`${i?"L":"M"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
    if(n>1)m+=`<path class="area" d="${d}L${sx(n-1)},${sy(lo)}L${sx(0)},${sy(lo)}Z"/><path class="ln" d="${d}"/>`;
    m+=pts.map((p,i)=>`<circle class="dot${p.hollow?" hollow":""}" cx="${sx(i)}" cy="${sy(p.y)}" r="${n>12&&!p.hollow?3:4}"/>`).join("");}
  const id="tr"+Math.random().toString(36).slice(2,8);
  trendData[id]={pts,xs:pts.map((_,i)=>sx(i)),ys:pts.map(p=>sy(p.y)),W};
  return `<div class="trend" data-trend="${id}"><h4>${esc(title)}</h4><div class="big">${big}${sub?`<small>${sub}</small>`:""}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} over time">${g}${m}</svg><div class="tip" hidden></div>${foot?`<div class="key">${foot}</div>`:""}</div>`;
}
const trendData={};
function onTrendMove(e){
  const card=e.target.closest(".trend");if(!card)return;const d=trendData[card.dataset.trend];if(!d)return;
  const svg=card.querySelector("svg"),r=svg.getBoundingClientRect(),k=r.width/d.W,x=(e.clientX-r.left)/k;
  let best=0;d.xs.forEach((v,i)=>{if(Math.abs(v-x)<Math.abs(d.xs[best]-x))best=i;});
  const tip=card.querySelector(".tip"),cr=card.getBoundingClientRect();tip.hidden=false;tip.textContent=d.pts[best].tip;
  tip.style.left=(r.left-cr.left+d.xs[best]*k)+"px";tip.style.top=(r.top-cr.top+d.ys[best]*k)+"px";
}
for(const id of ["#pl-trends","#pl-metrics"]){$(id).addEventListener("pointermove",onTrendMove);$(id).addEventListener("pointerleave",()=>$$(id+" .tip").forEach(t=>t.hidden=true));}

function renderPlayer(pid){
  const p=S.players.find(x=>x.id===pid);
  if(!p){$("#pl-name").textContent="Player not found";$("#pl-num").textContent="";$("#pl-stats").innerHTML="";$("#pl-log").innerHTML="";$("#pl-trends").innerHTML="";return;}
  document.title=`${p.name} · ${S.team.name}`;
  $("#pl-num").textContent=p.num;$("#pl-name").textContent=p.name;
  const hasOut=(S.outside||[]).some(o=>o.player_id===pid);
  $("#pl-scope").hidden=!hasOut;
  const inc=!hasOut||$("#pl-outside").checked, rows=playerLines(pid,inc);
  const B=aggBat(rows),P=aggPit(rows),F=aggFld(rows),last=lastOuting(pid);
  let rest="";if(last){const need=restDays(last.pc),d=new Date(last.date+"T12:00"),free=new Date(d);free.setDate(d.getDate()+need+1);const ok=new Date(today()+"T12:00")>=free;rest=`<span class="chip ${ok?"ok":"rest"}">${ok?"Available to pitch":"Rest until "+MON[free.getMonth()]+" "+free.getDate()}</span>`;}
  $("#pl-sub").innerHTML=[S.team.name,S.team.season].filter(Boolean).map(esc).join(" · ")+(rest?" "+rest:"")+posLine(p);
  const tbl=(cols,row)=>`<div class="tbl-wrap"><table><thead><tr>${cols.map(([,l])=>`<th style="cursor:default">${l}</th>`).join("")}</tr></thead><tbody><tr>${cols.map(([k,,f])=>`<td>${f?f(row[k],row):row[k]}</td>`).join("")}</tr></tbody></table></div>`;
  let html="";
  html+=B?`<div><h3 style="margin-bottom:6px">Batting</h3>${tbl([["g","G"],["pa","PA"],...BAT,["avg","AVG",fmt3],["obp","OBP",fmt3],["slg","SLG",fmt3],["ops","OPS",fmt3]],B)}</div>`:`<p class="note">No at-bats yet.</p>`;
  if(P)html+=`<div><h3 style="margin-bottom:6px">Pitching</h3>${tbl([["g","G"],["outs","IP",v=>outsToIp(v)],["pc","Pitches"],["h","H"],["r","R"],["er","ER"],["bb","BB"],["so","K"],["era","ERA",fmt2],["whip","WHIP",fmt2]],P)}</div>`;
  if(F)html+=`<div><h3 style="margin-bottom:6px">Fielding</h3>${tbl([["g","G"],["po","PO"],["a","A"],["e","E"],["tc","TC"],["pct","FLD%",fmt3]],F)}</div>`;
  $("#pl-stats").innerHTML=html;
  // trends
  const outKey=rows.some(r=>r.kind==="outside")?"Hollow marks are games outside the team.":"";
  const cards=[];let h=0,ab=0,ob=0,pa=0;const avgPts=[],obpPts=[];
  for(const r of rows){if(!r.bat)continue;h+=+r.bat.h||0;ab+=+r.bat.ab||0;ob+=(+r.bat.h||0)+(+r.bat.bb||0)+(+r.bat.hbp||0);pa+=(+r.bat.ab||0)+(+r.bat.bb||0)+(+r.bat.hbp||0);
    const tip=`${fmtDay(r.date)} ${r.label}: ${r.bat.h||0}-${r.bat.ab||0}`;
    if(ab)avgPts.push({date:r.date,y:h/ab,hollow:r.kind==="outside",tip:`${tip} · AVG ${fmt3(h/ab)}`});
    if(pa)obpPts.push({date:r.date,y:ob/pa,hollow:r.kind==="outside",tip:`${tip} · OBP ${fmt3(ob/pa)}`});}
  const r3=(v,t)=>t?(v===0?"0":fmt3(v)):fmt3(v);
  if(avgPts.length>=2)cards.push(trendCard({title:"Batting average",big:fmt3(avgPts.at(-1).y),sub:`after ${avgPts.length} games`,pts:avgPts,yfmt:r3,yMin:0,foot:outKey}));
  if(obpPts.length>=2)cards.push(trendCard({title:"On-base percentage",big:fmt3(obpPts.at(-1).y),sub:`after ${obpPts.length} games`,pts:obpPts,yfmt:r3,yMin:0,foot:outKey}));
  const pcPts=rows.filter(r=>r.pit&&+r.pit.pc).map(r=>({date:r.date,y:+r.pit.pc,hollow:r.kind==="outside",tip:`${fmtDay(r.date)} ${r.label}: ${r.pit.pc} pitches, ${outsToIp(+r.pit.outs||0)} IP, ${r.pit.so||0} K`})).slice(-12);
  if(pcPts.length)cards.push(trendCard({title:"Pitches per outing",big:String(pcPts.at(-1).y),sub:"last outing",pts:pcPts,yfmt:v=>String(Math.round(v)),bars:true,yMin:0,refY:S.team.pitchMax,refLabel:`${S.team.pitchMax} limit`,foot:outKey}));
  $("#pl-trends").innerHTML=cards.join("")||`<p class="note">Trends appear after two games with at-bats, or after the first pitching outing.</p>`;
  // game log
  const canDel=isCoach;
  $("#pl-log").innerHTML=rows.length?`<thead><tr><th class="l" style="cursor:default">Game</th><th style="cursor:default">Result</th><th style="cursor:default">Batting</th><th style="cursor:default">Pitching</th><th style="cursor:default">Fielding</th>${canDel?"<th></th>":""}</tr></thead><tbody>`+[...rows].reverse().map(r=>{
    const b=r.bat,q_=r.pit,f=r.fld;
    const bs=b?[`${b.h||0}-${b.ab||0}`,b.d?`${b.d} 2B`:"",b.t?`${b.t} 3B`:"",b.hr?`${b.hr} HR`:"",b.rbi?`${b.rbi} RBI`:"",b.r?`${b.r} R`:"",b.bb?`${b.bb} BB`:"",b.so?`${b.so} K`:"",b.sb?`${b.sb} SB`:""].filter(Boolean).join(", "):"";
    const ps=q_?`${outsToIp(q_.outs||0)} IP, ${q_.pc||0} P, ${q_.so||0} K, ${q_.er||0} ER`:"";
    const fs=f?`${f.po||0} PO, ${f.a||0} A${f.e?`, ${f.e} E`:""}`:"";
    return `<tr class="${r.kind}"><td class="l">${fmtDay(r.date)} ${esc(r.label)}</td><td>${r.res}</td><td>${bs}</td><td>${ps}</td><td>${fs}</td>${canDel?`<td>${r.kind==="outside"?`<button class="linkbtn" data-ogdel="${r.id}">Delete</button>`:""}</td>`:""}</tr>`;}).join("")+`</tbody>`:`<tbody><tr><td class="l note">No games yet.</td></tr></tbody>`;
  $("#pl-edit").hidden=!canEdit;
  if(!isCoach){if(pid===myPlayer){renderMetrics(pid);renderMine(pid);}return;}
  renderMedia($("#pl-gallery"),pid);renderMetrics(pid);renderNotes(pid);prepAddForms();
  $("#pl-aiok").checked=!!p.ai_ok;renderWriteup(pid);renderRecruit(pid);renderShowcases(pid);
}
$("#pl-outside").addEventListener("change",()=>renderPlayer(curPlayer));

// ---- outside games ----
function prepAddForms(){
  if(!$("#og-bat").children.length){
    $("#og-bat").innerHTML=BAT.map(([k,l])=>`<label>${l}<input type="number" min="0" inputmode="numeric" id="og-b-${k}"></label>`).join("");
    $("#og-pit").innerHTML=PIT.map(([k,l])=>`<label>${l}<input ${k==="ip"?'type="text" inputmode="decimal" placeholder="2.1"':'type="number" min="0" inputmode="numeric"'} id="og-p-${k}"></label>`).join("");
    $("#og-fld").innerHTML=FLD.map(([k,l])=>`<label>${l}<input type="number" min="0" inputmode="numeric" id="og-f-${k}"></label>`).join("");
    $("#mt-metric").innerHTML=METRICS.map(([n,u],i)=>`<option value="${i}">${esc(n)}${u?` (${u})`:""}</option>`).join("");
  }
  if(!$("#og-date").value)$("#og-date").value=today();
  if(!$("#mt-date").value)$("#mt-date").value=today();
}
$("#og-form").addEventListener("submit",async e=>{
  e.preventDefault();const st=$("#og-status");
  const val=id=>$(id).value.trim(),any=ids=>ids.some(id=>val(id)!=="");
  const bIds=BAT.map(([k])=>"#og-b-"+k),pIds=PIT.map(([k])=>"#og-p-"+k),fIds=FLD.map(([k])=>"#og-f-"+k);
  if(!any(bIds)&&!any(pIds)&&!any(fIds)){setStatus(st,"Enter at least one stat.","err");return;}
  let bat=null,pit=null,fld=null;
  if(any(bIds)){bat={};for(const [k] of BAT)bat[k]=Math.max(0,+val("#og-b-"+k)||0);if(bat.h>bat.ab){setStatus(st,"Hits can't be more than at-bats.","err");return;}if(bat.d+bat.t+bat.hr>bat.h){setStatus(st,"Extra-base hits can't be more than hits.","err");return;}}
  if(any(pIds)){const ip=val("#og-p-ip");if(ip&&!/^\d+(\.[0-2])?$/.test(ip)){setStatus(st,"Innings should look like 2 or 2.1.","err");return;}pit={outs:ipToOuts(ip)};for(const [k] of PIT.slice(1))pit[k]=Math.max(0,+val("#og-p-"+k)||0);if(pit.er>pit.r){setStatus(st,"Earned runs can't be more than runs.","err");return;}}
  if(any(fIds)){fld={};for(const [k] of FLD)fld[k]=Math.max(0,+val("#og-f-"+k)||0);}
  const row={team_id:TEAM.id,player_id:curPlayer,date:$("#og-date").value,event:val("#og-event"),bat,pit,fld};
  try{const r=await q(sb.from("player_games").insert(row).select());S.outside.push(r[0]);
    [...bIds,...pIds,...fIds,"#og-event"].forEach(id=>$(id).value="");setStatus(st,"Saved.","ok");logAct(`Added an outside game for ${(S.players.find(x=>x.id===curPlayer)||{}).name}`);renderPlayer(curPlayer);renderAvail();}
  catch(err){setStatus(st,/player_games/.test(err.message||"")?"Outside games aren't set up yet. Run supabase/006_player_extras.sql in Supabase.":errText(err),"err");}
});
let pendingOg=null;
$("#pl-log").addEventListener("click",async e=>{
  const d=e.target.closest("[data-ogdel]");if(!d)return;
  if(pendingOg!==d.dataset.ogdel){pendingOg=d.dataset.ogdel;d.textContent="Tap again to delete";return;}
  pendingOg=null;try{await q(sb.from("player_games").delete().eq("id",d.dataset.ogdel));S.outside=S.outside.filter(o=>o.id!==d.dataset.ogdel);renderPlayer(curPlayer);renderAvail();}
  catch(err){setStatus($("#pl-log-status"),errText(err),"err");}
});

// ---- measurements ----
const METRICS=[["Exit velocity","mph"],["Bat speed","mph"],["Pitch velocity","mph"],["Throwing velocity","mph"],["60-yard dash","sec"],["Home to first","sec"],["Pop time","sec"],["Other",""]];
$("#mt-metric").addEventListener("change",()=>{const other=METRICS[+$("#mt-metric").value][0]==="Other";$("#mt-custom-wrap").hidden=!other;$("#mt-unit-wrap").hidden=!other;});
let metricRows=[];
async function renderMetrics(pid){
  const box=$("#pl-metrics");
  const {data,error}=await sb.from("player_metrics").select("*").eq("player_id",pid).order("date");
  if(error){box.innerHTML=`<p class="note">${/player_metrics/.test(error.message||"")?"Measurements aren't set up yet.":esc(errText(error))}</p>`;return;}
  metricRows=data;const by={};for(const m of data)(by[m.metric]=by[m.metric]||[]).push(m);
  box.innerHTML=Object.entries(by).map(([name,ms])=>{
    const u=ms[0].unit||"",num=v=>(+v).toLocaleString(undefined,{maximumFractionDigits:2}),lastV=+ms.at(-1).value,first=+ms[0].value,diff=lastV-first;
    const sub=ms.length>1?`${diff>=0?"+":"−"}${num(Math.abs(diff))} ${u} since ${fmtDay(ms[0].date)}`:fmtDay(ms[0].date);
    const pts=ms.map(m=>({date:m.date,y:+m.value,tip:`${fmtDay(m.date)}: ${num(m.value)} ${u}${m.note?" · "+m.note:""}`}));
    const list=isCoach?`<details><summary class="note">Entries</summary>${ms.slice().reverse().map(m=>`<div class="note">${fmtDay(m.date)}: ${num(m.value)} ${esc(u)}${m.note?" · "+esc(m.note):""} <button class="linkbtn" data-mtdel="${m.id}">Delete</button></div>`).join("")}</details>`:"";
    return ms.length>1?trendCard({title:name+(u?` (${u})`:""),big:`${num(lastV)} ${esc(u)}`,sub,pts,yfmt:v=>num(v),foot:list}):`<div class="trend"><h4>${esc(name)}${u?` (${esc(u)})`:""}</h4><div class="big">${num(lastV)} ${esc(u)}<small>${sub}</small></div><div class="key">Add another to see the trend.</div>${list}</div>`;
  }).join("")||`<p class="note">No measurements yet. Add one below.</p>`;
}
$("#mt-form").addEventListener("submit",async e=>{
  e.preventDefault();const st=$("#mt-status"),[n,u]=METRICS[+$("#mt-metric").value],other=n==="Other";
  const metric=other?$("#mt-custom").value.trim():n,unit=other?$("#mt-unit").value.trim():u,value=$("#mt-value").value;
  if(!metric||value===""){setStatus(st,"Enter a name and a value.","err");return;}
  try{await q(sb.from("player_metrics").insert({team_id:TEAM.id,player_id:curPlayer,metric,unit,value:+value,date:$("#mt-date").value,note:$("#mt-note").value.trim()}));
    $("#mt-value").value="";$("#mt-note").value="";setStatus(st,"Saved.","ok");renderMetrics(curPlayer);}
  catch(err){setStatus(st,/player_metrics/.test(err.message||"")?"Measurements aren't set up yet. Run supabase/006_player_extras.sql in Supabase.":errText(err),"err");}
});
let pendingMt=null;
$("#pl-metrics").addEventListener("click",async e=>{
  const d=e.target.closest("[data-mtdel]");if(!d)return;
  if(pendingMt!==d.dataset.mtdel){pendingMt=d.dataset.mtdel;d.textContent="Tap again to delete";return;}
  pendingMt=null;try{await q(sb.from("player_metrics").delete().eq("id",d.dataset.mtdel));renderMetrics(curPlayer);}catch(err){}
});
// What a player (or their linked parent) sees from the coaches: tryout result, reviewed write-up, shared notes.
async function renderMine(pid){
  const box=$("#pl-mine");box.innerHTML=`<p class="note">Loading…</p>`;
  const [ty,wu,nt]=await Promise.all([
    sb.from("tryout_players").select("status,placed_team_id,created_at").eq("placed_player_id",pid).order("created_at",{ascending:false}).limit(3),
    sb.from("ai_reports").select("*").eq("player_id",pid).eq("kind","player").eq("status","reviewed").order("created_at",{ascending:false}).limit(1),
    sb.from("player_notes").select("*").eq("player_id",pid).eq("shared",true).order("created_at",{ascending:false}).limit(50)]);
  let html="";
  const placed=(ty.data||[]).filter(x=>x.status==="placed");
  if(placed.length)html+=`<div class="panel mine-ty"><h3>Tryout result</h3>${placed.map(x=>`<p><b>You made ${esc((teams.find(t=>t.id===x.placed_team_id)||{}).name||"the team")}.</b> Welcome to the team.</p>`).join("")}</div>`;
  const r=(wu.data||[])[0];
  if(r){const o=r.output||{},fx=Array.isArray(o.focus)?o.focus:[];
    html+=`<div class="panel"><h3>Your development plan</h3><p class="note">Reviewed by your coaches ${esc(dateStr(r.reviewed_at||r.created_at))}.</p>${o.summary?`<p>${esc(o.summary)}</p>`:""}
      ${Array.isArray(o.strengths)&&o.strengths.length?`<h5>Doing well</h5><ul>${o.strengths.map(x=>`<li>${typeof x==="string"?esc(x):`<b>${esc(x.title||"")}</b>${x.detail?`. ${esc(x.detail)}`:""}`}</li>`).join("")}</ul>`:""}
      ${fx.length?`<h5>Working on</h5><ul>${fx.map(f=>`<li><b>${esc(f.title||"")}</b>${f.drill?`: ${esc(f.drill)}`:f.why?`: ${esc(f.why)}`:""}</li>`).join("")}</ul>`:""}</div>`;}
  const notes=nt.data||[];
  html+=`<div class="panel"><h3>Notes from your coaches</h3>${notes.map(n=>`<div class="note-item"><div class="meta"><span class="topic">${TOPICS[n.topic]||"General"}</span><span>${esc(n.by_name||"Coach")}</span><span>${esc(new Date(n.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}))}</span></div><div class="body">${esc(n.body)}</div></div>`).join("")||`<p class="note">No notes shared with you yet.</p>`}</div>`;
  html+=`<div class="panel"><h3>Your photos and videos</h3><div class="gallery" id="pl-mine-gallery"><p class="note">Loading…</p></div></div>`;
  box.innerHTML=html;
  try{const r=await api("/api/mine",{team_id:TEAM.id});(r.media||[]).forEach(m=>{mediaById[m.id]=m;});
    $("#pl-mine-gallery").innerHTML=(r.media||[]).map(m=>tileHtml(m,r.urls||{})).join("")||`<p class="note">No photos or videos of you yet.</p>`;}
  catch(e){$("#pl-mine-gallery").innerHTML=`<p class="note">${esc(e.message)}</p>`;}
}
async function renderNotes(pid){
  const box=$("#pl-notes");
  try{
    const rows=await q(sb.from("player_notes").select("*").eq("player_id",pid).order("created_at",{ascending:false}).limit(200));
    box.innerHTML=rows.map(n=>`<div class="note-item" data-nid="${n.id}"><div class="meta"><span class="topic">${TOPICS[n.topic]||"General"}</span><span>${esc(n.by_name||"Coach")}</span><span>${esc(new Date(n.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}))}</span>${n.shared?`<span class="chip ok">Shared with player</span>`:""}<button class="linkbtn" data-nshare="${n.id}" data-on="${n.shared?1:0}">${n.shared?"Stop sharing":"Share with player"}</button><button class="linkbtn" data-ndel="${n.id}">Delete</button></div><div class="body">${esc(n.body)}</div></div>`).join("")||`<p class="note">No notes yet.</p>`;
  }catch(e){box.innerHTML=`<p class="status err">${esc(/player_notes/.test(e.message||"")?"Coach notes aren't set up yet. Run supabase/005_players_media.sql in Supabase.":errText(e))}</p>`;}
}
$("#pl-note-form").addEventListener("submit",async e=>{
  e.preventDefault();const st=$("#pl-note-status"),body=$("#pl-note-body").value.trim();
  if(!body){setStatus(st,"Write a note first.","err");return;}
  const row={team_id:TEAM.id,player_id:curPlayer,topic:$("#pl-note-topic").value,body,by_name:me.name||me.email};if($("#pl-note-share").checked)row.shared=true;
  try{await q(sb.from("player_notes").insert(row));$("#pl-note-share").checked=false;
    $("#pl-note-body").value="";setStatus(st,"Saved.","ok");renderNotes(curPlayer);}
  catch(err){setStatus(st,/player_notes/.test(err.message||"")?"Coach notes aren't set up yet. Run supabase/005_players_media.sql in Supabase.":errText(err),"err");}
});
let pendingNoteDel=null;
$("#pl-notes").addEventListener("click",async e=>{
  const sh=e.target.closest("[data-nshare]");
  if(sh){try{await q(sb.from("player_notes").update({shared:sh.dataset.on!=="1"}).eq("id",sh.dataset.nshare));renderNotes(curPlayer);}
    catch(err){setStatus($("#pl-note-status"),/shared/.test(err.message||"")?"Sharing notes needs supabase/013_player_logins.sql run in Supabase first.":errText(err),"err");}return;}
  const d=e.target.closest("[data-ndel]");if(!d)return;
  if(pendingNoteDel!==d.dataset.ndel){pendingNoteDel=d.dataset.ndel;d.textContent="Tap again to delete";return;}
  pendingNoteDel=null;try{await q(sb.from("player_notes").delete().eq("id",d.dataset.ndel));renderNotes(curPlayer);}catch(err){setStatus($("#pl-note-status"),errText(err),"err");}
});
$("#lightbox").onclick=()=>{$("#lightbox").hidden=true;};

// ---------- admin ----------
const genPw=()=>{const w="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";const a=new Uint32Array(10);crypto.getRandomValues(a);return [...a].map(x=>w[x%w.length]).join("");};
let members=[];
const playerOpts=(sel,blank)=>`<option value="">${blank}</option>`+sortedPlayers().map(p=>`<option value="${p.id}" ${p.id===sel?"selected":""}>#${p.num} ${esc(p.name)}</option>`).join("");
// Best guess at which roster spot a request means, from the player name they typed.
function guessPlayer(name){const n=String(name||"").trim().toLowerCase();if(!n)return null;const ps=sortedPlayers();
  return (ps.find(p=>p.name.toLowerCase()===n)||ps.find(p=>p.name.toLowerCase().split(/\s+/)[0]===n.split(/\s+/)[0])||{}).id||null;}
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
      members.map(m=>`<tr><td class="l">${esc(m.display_name||"")}</td><td class="l">${esc(m.email)}</td><td class="l"><select data-role="${m.user_id}" aria-label="Role for ${esc(m.email)}">${["coach","scorekeeper","admin","parent","player"].map(r=>`<option value="${r}" ${m.role===r?"selected":""}>${ROLE_LABEL[r]}</option>`).join("")}</select>${["player","parent"].includes(m.role)?`<select data-link="${m.user_id}" aria-label="Player for ${esc(m.email)}">${playerOpts(m.player_id,m.role==="player"?"Pick the player":"Not linked")}</select>`:""}</td><td class="l"><button class="linkbtn" data-reset="${m.user_id}">Reset password</button>${m.user_id===me.id?"":` · <button class="linkbtn" data-remove="${m.user_id}">Remove</button>`}</td></tr>`).join("")+`</tbody>`;
    setStatus(st,members.length?"":"No one added yet.");
  }catch(e){setStatus(st,errText(e),"err");}
  $("#ad-teams").hidden=!siteAdmin;
  if(siteAdmin){$("#ad-teamlist").innerHTML=`<div class="tbl-wrap"><table class="members"><tbody>${teams.map(t=>`<tr><td class="l"><b>${esc(t.name)}</b>${t.id===TEAM.id?" (this team)":""}</td><td class="l"><a href="${teamLink(t.id)}">${esc(teamUrl(t.id))}</a></td></tr>`).join("")}</tbody></table></div>`;$("#nt-preview").textContent=location.origin+"/web-name";}
  const also=alsoBoxes("add");$("#ad-also").innerHTML=also;$("#ad-also").hidden=!also;adRoleChanged();
  try{
    const log=await q(sb.from("activity").select("*").eq("team_id",TEAM.id).order("at",{ascending:false}).limit(25));
    $("#ad-log").innerHTML=log.length?`<thead><tr><th class="l">When</th><th class="l">Who</th><th class="l">Change</th></tr></thead><tbody>${log.map(l=>`<tr><td class="l">${esc(new Date(l.at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}))}</td><td class="l">${esc(l.by_name||"Someone")}</td><td class="l">${esc(l.what)}</td></tr>`).join("")}</tbody>`:"";
    $("#ad-log-note").textContent=log.length?"Shows the last 25 changes.":"No changes yet.";
  }catch(e){}
}
$("#ad-members").addEventListener("change",async e=>{
  const st=$("#ad-mstatus"),lk=e.target.closest("[data-link]");
  if(lk){try{await api("/api/admin",{action:"link_player",team_id:TEAM.id,user_id:lk.dataset.link,player_id:lk.value||null});setStatus(st,lk.value?"Linked to that player.":"Unlinked.","ok");logAct("Linked a login to a player");}catch(err){setStatus(st,err.message,"err");renderAdmin();}return;}
  const s=e.target.closest("[data-role]");if(!s)return;
  try{await api("/api/admin",{action:"set_role",team_id:TEAM.id,user_id:s.dataset.role,role:s.value});setStatus(st,s.value==="player"?"Role updated. Now pick which player they are.":"Role updated.","ok");logAct("Changed a role");renderAdmin();}
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
  const st=$("#ad-astatus"),name=$("#ad-name").value.trim(),email=$("#ad-email").value.trim(),r=$("#ad-role").value,pw=genPw(),player_id=["player","parent"].includes(r)?$("#ad-player").value||null:null;
  if(!email){setStatus(st,"Enter their email.","err");return;}
  if(r==="player"&&!player_id){setStatus(st,"Pick which player on the roster they are.","err");return;}
  setStatus(st,"Adding…");
  try{const res=await api("/api/admin",{action:"add",team_id:TEAM.id,name,email,role:r,password:pw,player_id});
    const more=await addToTeams(alsoChecked("add"),{name,email,role:r,password:pw});
    setStatus(st,(res.created?`Added ${name||email}.`:`Added ${name||email}. They already had an account, so their password didn't change.`)+more,"ok");$$('[data-also="add"]').forEach(x=>x.checked=false);
    if(res.created)showPw(name||email,pw);
    $("#ad-name").value="";$("#ad-email").value="";logAct(`Added ${name||email} as ${r}`);renderAdmin();}
  catch(e){setStatus(st,e.message,"err");}
};
$("#nt-add").onclick=async()=>{
  const st=$("#nt-status");
  const lv=PITCH_PRESETS[$("#nt-level").value];
  try{const r=await api("/api/admin",{action:"create_team",school:$("#nt-school").value.trim()||null,name:$("#nt-name").value.trim(),id:$("#nt-id").value.trim(),innings:$("#nt-level").value==="ll"?6:7,pitch_max:lv.max,pitch_rest:lv.rest});setStatus(st,"Team added. Opening it…","ok");location.href=teamLink(r.team.id);}
  catch(e){setStatus(st,e.message,"err");}
};
$("#lg-up").onclick=async()=>{
  const f=$("#lg-file").files[0],st=$("#lg-status");if(!f){setStatus(st,"Choose an image first.","err");return;}
  try{setStatus(st,"Uploading…");const blob=await resizeImage(f,600,.9),path=`${TEAM.id}/logo-${Date.now()}.jpg`;
    const up=await sb.storage.from("logos").upload(path,blob,{contentType:"image/jpeg"});if(up.error)throw up.error;
    await q(sb.from("teams").update({logo_path:path}).eq("id",TEAM.id));TEAM.logo_path=path;renderHeader();setStatus(st,"Logo updated.","ok");}
  catch(e){setStatus(st,errText(e),"err");}
};

// ---------- spond ----------
$("#sp-sync").onclick=async()=>{
  const b=$("#sp-sync"),line=$("#sp-line");b.disabled=true;b.textContent="Syncing…";
  const msgs=[];
  for(const s of syncSources()){
    try{const r=await api(s.kind==="spond"?"/api/spond":"/api/calsync",{action:"sync",team_id:TEAM.id});msgs.push(syncSummary(r.result,s.kind==="spond"?"Spond":TEAM.ics_source));logAct(`Synced schedule from ${s.kind==="spond"?"Spond":TEAM.ics_source}`);}
    catch(e){msgs.push(`${s.name}: ${e.message}`);}
  }
  try{await reloadTeam();}catch(e){}
  line.hidden=false;line.textContent=msgs.join(" ");b.disabled=false;b.textContent="Sync now";
};
// ---------- TeamSnap / calendar link ----------
function renderIcsAdmin(){
  $("#ic-state").textContent=TEAM.ics_source?`Connected to ${TEAM.ics_source}. ${TEAM.ics_synced_at?"Last synced "+ago(TEAM.ics_synced_at)+".":""} Paste a new link to replace it.`:"Not connected. Paste the team's calendar link from TeamSnap (or GameChanger, SportsEngine, Google Calendar) and press Connect and sync.";
  $("#ic-off").hidden=!TEAM.ics_source;
}
$("#ic-save").onclick=async()=>{
  const st=$("#ic-status"),url=$("#ic-url").value.trim();
  if(!url){setStatus(st,"Paste the calendar link first.","err");return;}
  setStatus(st,"Reading the calendar…");$("#ic-save").disabled=true;
  try{const r=await api("/api/calsync",{action:"set",team_id:TEAM.id,url});$("#ic-url").value="";await reloadTeam();renderIcsAdmin();setStatus(st,syncSummary(r.result,r.source),"ok");logAct(`Connected ${r.source} calendar sync`);}
  catch(e){setStatus(st,e.message,"err");}
  finally{$("#ic-save").disabled=false;}
};
$("#ic-off").onclick=async()=>{
  const st=$("#ic-status"),from=TEAM.ics_source;
  try{await api("/api/calsync",{action:"set",team_id:TEAM.id,url:""});await reloadTeam();renderIcsAdmin();setStatus(st,`${from} sync is off. Games already synced stay on the schedule.`,"ok");logAct(`Turned off ${from} sync`);}
  catch(e){setStatus(st,e.message,"err");}
};
function renderSpondAdmin(){
  $("#sp-admin-state").textContent=TEAM.spond_group?`Connected to Spond group "${TEAM.spond_group_name||TEAM.spond_group}". ${TEAM.spond_synced_at?"Last synced "+ago(TEAM.spond_synced_at)+".":""}`:"Not connected. Press Show my Spond groups, pick this team's group, and press Use this group.";
  $("#sp-off").hidden=!TEAM.spond_group;
}
$("#sp-load").onclick=async()=>{
  const st=$("#sp-astatus");setStatus(st,"Signing in to Spond…");
  try{const r=await api("/api/spond",{action:"groups",team_id:TEAM.id});
    if(!r.groups.length){setStatus(st,"That Spond account isn't in any groups. Use a Spond login that belongs to the team.","err");return;}
    $("#sp-pick").innerHTML=r.groups.map(g=>`<option value="${esc(g.id)}" ${g.id===TEAM.spond_group?"selected":""}>${esc(g.name)}</option>`).join("");
    $("#sp-pick-wrap").hidden=false;$("#sp-save").hidden=false;setStatus(st,"");}
  catch(e){setStatus(st,e.message,"err");}
};
$("#sp-save").onclick=async()=>{
  const st=$("#sp-astatus"),sel=$("#sp-pick"),name=sel.options[sel.selectedIndex].text;setStatus(st,"Connecting and syncing…");
  try{const r=await api("/api/spond",{action:"set_group",team_id:TEAM.id,group_id:sel.value,group_name:name});await reloadTeam();renderSpondAdmin();setStatus(st,syncSummary(r.result),"ok");logAct(`Connected Spond group ${name}`);}
  catch(e){setStatus(st,e.message,"err");}
};
$("#sp-off").onclick=async()=>{
  const st=$("#sp-astatus");
  try{await api("/api/spond",{action:"set_group",team_id:TEAM.id,group_id:null});await reloadTeam();renderSpondAdmin();setStatus(st,"Spond sync is off. Games already synced stay on the schedule.","ok");logAct("Turned off Spond sync");}
  catch(e){setStatus(st,e.message,"err");}
};

// ---------- access requests ----------
$("#rq-form").addEventListener("submit",async e=>{
  e.preventDefault();const st=$("#rq-status");
  if($("#rq-web").value){setStatus(st,"Request sent.","ok");return;} // spam trap
  const row={team_id:TEAM.id,name:$("#rq-name").value.trim(),email:$("#rq-email").value.trim().toLowerCase(),player:$("#rq-player").value.trim(),role:$("#rq-role").value,note:$("#rq-note").value.trim()};
  if(!row.name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)){setStatus(st,"Enter your name and a valid email.","err");return;}
  $("#rq-go").disabled=true;setStatus(st,"Sending…");
  const {error}=await sb.from("access_requests").insert(row);
  $("#rq-go").disabled=false;
  if(error){setStatus(st,/relation|does not exist|schema cache/i.test(error.message)?"Requests aren't set up on this site yet. Ask the team admin directly.":"Couldn't send that. Try again in a minute.","err");return;}
  $("#rq-form").reset();setStatus(st,`Request sent. The ${S.team.name} admin will send you a login.`,"ok");
});
let requests=[];
// Other teams this admin can add people to, grouped by school so squads sit together.
const otherAdminTeams=()=>teams.filter(t=>t.id!==TEAM.id&&myAdminTeams.includes(t.id)).sort((a,b)=>String(a.school||"~").localeCompare(String(b.school||"~"))||a.name.localeCompare(b.name));
const alsoBoxes=(key,checked=[])=>{const ts=otherAdminTeams();return ts.length?`<div class="also"><span class="f-label">Also add to</span>${ts.map(t=>`<label><input type="checkbox" data-also="${key}" value="${t.id}" ${checked.includes(t.id)?"checked":""}>${esc(t.name)}</label>`).join("")}</div>`:"";};
const alsoChecked=key=>$$(`[data-also="${key}"]:checked`).map(x=>x.value);
async function addToTeams(ids,person){if(person.role==="player")return "";const done=[],failed=[];for(const id of ids){try{await api("/api/admin",{action:"add",team_id:id,...person});done.push(id);}catch(e){failed.push(id);}}
  if(done.length)try{await sb.from("access_requests").update({status:"approved"}).eq("email",person.email.toLowerCase()).eq("status","pending").in("team_id",done);}catch(e){}
  const nm=id=>(teams.find(t=>t.id===id)||{}).name||id;
  return (done.length?` Also added to ${done.map(nm).join(", ")}.`:"")+(failed.length?` Couldn't add to ${failed.map(nm).join(", ")} (you need to be an admin there).`:"");}
async function loadRequests(){
  if(!isAdmin)return;
  const {data,error}=await sb.from("access_requests").select("*").eq("team_id",TEAM.id).eq("status","pending").order("created_at");
  requests=error?[]:data;
  const a=$('nav.tabs a[data-v="admin"]');if(a)a.textContent=requests.length?`Admin (${requests.length})`:"Admin";
  const list=$("#rq-list");if(!list)return;
  if(error){list.innerHTML=`<p class="note">Requests aren't set up yet. Run supabase/003_access_requests.sql in Supabase.</p>`;return;}
  let elsewhere={};
  if(requests.length&&otherAdminTeams().length){const r2=await sb.from("access_requests").select("email,team_id").in("email",requests.map(r=>r.email)).eq("status","pending").neq("team_id",TEAM.id);
    for(const x of r2.data||[])(elsewhere[x.email]=elsewhere[x.email]||[]).push(x.team_id);}
  list.innerHTML=requests.length?`<div class="tbl-wrap"><table class="members"><thead><tr><th class="l">Name</th><th class="l">Email</th><th class="l">Player</th><th class="l">Role</th><th class="l"></th></tr></thead><tbody>${requests.map(r=>`<tr><td class="l">${esc(r.name)}${r.note?`<div class="note">${esc(r.note)}</div>`:""}</td><td class="l">${esc(r.email)}</td><td class="l">${esc(r.player)}<select data-rqplayer="${r.id}" aria-label="Roster spot for ${esc(r.name)}">${playerOpts(guessPlayer(r.player),"Not linked")}</select></td><td class="l"><select data-rqrole="${r.id}" aria-label="Role for ${esc(r.name)}">${["coach","scorekeeper","admin","parent","player"].map(x=>`<option value="${x}" ${r.role===x?"selected":""}>${ROLE_LABEL[x]}</option>`).join("")}</select>${alsoBoxes("rq-"+r.id,elsewhere[r.email]||[])}${(elsewhere[r.email]||[]).length?`<div class="note">Also asked to join the checked team${elsewhere[r.email].length>1?"s":""}.</div>`:""}</td><td class="l"><button class="linkbtn" data-rqok="${r.id}">Approve</button> · <button class="linkbtn" data-rqno="${r.id}">Decline</button></td></tr>`).join("")}</tbody></table></div>`:`<p class="note">No requests waiting. Visitors can ask for a login from the Sign in page.</p>`;
}
$("#rq-list").addEventListener("click",async e=>{
  const b=e.target.closest("[data-rqok],[data-rqno]");if(!b)return;const st=$("#rq-astatus");
  const r=requests.find(x=>x.id===(b.dataset.rqok||b.dataset.rqno));if(!r)return;
  try{
    if(b.dataset.rqok){
      const role=$(`[data-rqrole="${r.id}"]`).value,pw=genPw(),player_id=["player","parent"].includes(role)?$(`[data-rqplayer="${r.id}"]`).value||null:null;
      if(role==="player"&&!player_id){setStatus(st,"Pick which player on the roster they are, in the Player column.","err");return;}
      setStatus(st,"Creating their login…");
      const res=await api("/api/admin",{action:"add",team_id:TEAM.id,name:r.name,email:r.email,role,password:pw,player_id});
      await q(sb.from("access_requests").update({status:"approved"}).eq("id",r.id));
      const more=await addToTeams(alsoChecked("rq-"+r.id),{name:r.name,email:r.email,role,password:pw});
      setStatus(st,(res.created?`Approved ${r.name}.`:`Approved ${r.name}. They already had a login, so their password didn't change.`)+more,"ok");
      if(res.created)showPw(`${r.name} (${r.email})`,pw);
      logAct(`Approved access for ${r.name} as ${role}`);renderAdmin();
    }else{
      await q(sb.from("access_requests").update({status:"declined"}).eq("id",r.id));
      setStatus(st,`Declined ${r.name}.`,"ok");logAct(`Declined access request from ${r.name}`);
    }
    loadRequests();
  }catch(err){setStatus(st,err.message||errText(err),"err");}
});

const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
$("#nt-name").addEventListener("input",()=>{if(!$("#nt-id").dataset.touched)$("#nt-id").value=slug($("#nt-name").value);$("#nt-preview").textContent=location.origin+"/"+(slug($("#nt-id").value)||"web-name");});
$("#nt-id").addEventListener("input",()=>{$("#nt-id").dataset.touched="1";$("#nt-preview").textContent=location.origin+"/"+(slug($("#nt-id").value)||"web-name");});

// ================= AI (coaches and admins only) =================
const AI_OFF="AI is turned off for this site. Check that the Worker has the Workers AI binding (wrangler.jsonc) or an ANTHROPIC_API_KEY.";
const notSetUp=e=>/ai_reports|ai_ok|live/.test((e&&e.message)||"")?"The AI tools aren't set up yet. Run supabase/007_coach_ai.sql in Supabase.":errText(e);
const r3=x=>typeof x==="number"&&isFinite(x)&&!Number.isInteger(x)?+x.toFixed(3):x;
const pickNums=(o,ks)=>o?Object.fromEntries(ks.filter(k=>o[k]!=null).map(k=>[k,r3(o[k])])):null;
function availOn(pid,dateStr){const l=lastOuting(pid);if(!l)return {available:true,last_outing:null};const d=new Date(l.date+"T12:00"),free=new Date(d);free.setDate(d.getDate()+restDays(l.pc)+1);
  return {available:new Date(dateStr+"T12:00")>=free,last_outing:{date:l.date,pitches:l.pc,outside_team:l.outside},rested_from:free.toISOString().slice(0,10)};}
function teamContext(){return {team:S.team.name,league:S.team.league||"",season:S.team.season||"",innings_per_game:inn(),daily_pitch_limit:S.team.pitchMax,rest_rules:restTiers().map(([a,b])=>`${a}+ pitches: ${b} days rest`)};}
async function playerContext(pid){
  const p=S.players.find(x=>x.id===pid),all=playerLines(pid,true),team=playerLines(pid,false);
  const BK=["g","pa","ab","r","h","d","t","hr","rbi","bb","so","hbp","sb","avg","obp","slg","ops"],PK=["g","outs","pc","h","r","er","bb","so","era","whip"];
  const [notes,metrics,prev]=await Promise.all([
    sb.from("player_notes").select("topic,body,created_at").eq("player_id",pid).order("created_at",{ascending:false}).limit(25),
    sb.from("player_metrics").select("metric,unit,value,date,note").eq("player_id",pid).order("date"),
    sb.from("ai_reports").select("output,created_at").eq("player_id",pid).eq("kind","player").order("created_at",{ascending:false}).limit(1)]);
  return {
    ...teamContext(),today:today(),
    player:{first_name:p.name,jersey:p.num,primary_positions:posSort(posP(p)),backup_positions:posSort(posB(p))},
    batting_team_games:pickNums(aggBat(team),BK),batting_all_games:pickNums(aggBat(all),BK),
    pitching_all_games:pickNums(aggPit(all),PK),fielding_all_games:pickNums(aggFld(all),["g","po","a","e","pct"]),
    pitching_status_today:availOn(pid,today()),
    game_log:all.slice(-20).map(r=>({date:r.date,game:r.label,outside_team:r.kind==="outside",result:r.res||null,batting:r.bat||null,pitching:r.pit?{...r.pit,ip:outsToIp(+r.pit.outs||0)}:null,fielding:r.fld||null})),
    measurements:(metrics.data||[]).map(m=>({metric:m.metric,unit:m.unit,value:+m.value,date:m.date,note:m.note||undefined})),
    coach_notes:(notes.data||[]).map(n=>({date:n.created_at.slice(0,10),topic:n.topic,note:n.body})),
    previous_report:prev.data&&prev.data[0]?{date:prev.data[0].created_at.slice(0,10),summary:prev.data[0].output.summary,focus:(prev.data[0].output.focus||[]).map(f=>f.title)}:null};
}
const COACH_RULES=`Rules: Base every point on the data or images provided and cite numbers where you can. Say plainly when there is too little data to judge. This is a young athlete, so be specific, encouraging, and constructive. Never comment on body shape, weight, or appearance, and make no medical or injury claims. Respect the team's pitch-count limits and rest rules; never suggest exceeding them. Drills must be safe, age-appropriate, and doable at a normal practice.`;
async function saveReport(row){return (await q(sb.from("ai_reports").insert({team_id:TEAM.id,by_name:me.name||me.email,...row}).select()))[0];}
const li=a=>(a||[]).filter(Boolean);
const dateStr=t=>t?new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"";
const pill=s=>`<span class="st ${esc(s)}">${esc({new:"New",improving:"Improving",still:"Still working",resolved:"Resolved",improved:"Improved",steady:"Steady",worse:"Slipping"}[s]||s)}</span>`;
function commentsHtml(r){const c=r.comments||[];return c.length?`<div class="cmts">${c.map(x=>`<div><b>${esc(x.by||"Coach")}</b> <span class="note">${esc(dateStr(x.at))}</span>: ${esc(x.text)}</div>`).join("")}</div>`:"";}
function basisLine(b){if(!b)return "";const parts=[[b.team_games,"team game"],[b.outside_games,"outside game"],[b.clip_reviews,"clip review"],[b.notes,"coach note"],[b.measurements,"measurement"]].filter(([n])=>n).map(([n,l])=>`${n} ${l}${n>1?"s":""}`);return parts.length?`Based on ${parts.join(", ")}${b.data_through?`, through ${fmtDay(b.data_through)}`:""}.`:"";}
function reportHtml(r,actions=""){
  const o=r.output||{},when=dateStr(r.created_at);
  const kind={player:"Write-up",clip:"Clip review",gameday:"Game plan",deepdive:"Season review",team:"Team review"}[r.kind]||"AI";
  const who=r.source==="nightly"?"Nightly update":r.source==="upload"?"After upload":esc(r.by_name||"Coach");
  const status=r.kind==="player"?(r.status==="reviewed"?`<span>Reviewed by ${esc(r.reviewed_by_name||"a coach")} ${esc(dateStr(r.reviewed_at))}</span>`:`<span class="flag">Draft, not reviewed</span>`)+(r.edited?"<span>Edited by a coach</span>":""):"";
  const meta=`<div class="meta"><span class="ai-kind">${kind}</span><span>${who}</span><span>${esc(when)}</span>${status}</div>`;
  let body="";
  if(r.kind==="clip"){
    const focus=li(o.focus).length?`<h5>Work on</h5><ul>${li(o.focus).map(f=>`<li><b>${esc(f.title)}</b>. ${esc(f.why||"")}${f.drill?`<br><span class="note">Drill: ${esc(f.drill)}</span>`:""}</li>`).join("")}</ul>`:"";
    body=`<div class="sum">${esc(o.what_it_shows||"")}${o.focus_area?` <span class="note">(${esc(o.focus_area)})</span>`:""}${r.media_id?` <button class="linkbtn" data-goclip="${r.media_id}">See it</button>`:""}</div>
      ${li(o.positives).length?`<h5>Doing well</h5><ul>${li(o.positives).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${li(o.observations).length?`<h5>What the frames show</h5><ul>${li(o.observations).map(x=>`<li>Frame ${esc(x.frame)}: ${esc(x.note)}</li>`).join("")}</ul>`:""}
      ${focus}<div class="note">Confidence: ${esc(o.confidence||"unknown")}${o.caveats?`. ${esc(o.caveats)}`:""}</div>`;
  }else if(r.kind==="deepdive"){
    body=`<div class="sum">${esc(o.headline||"")}</div>
      ${li(o.progress).length?`<h5>Focus areas over time</h5><ul>${li(o.progress).map(x=>`<li>${pill(x.trajectory)}<b>${esc(x.title)}</b>. ${esc(x.detail||"")}</li>`).join("")}</ul>`:""}
      ${li(o.what_worked).length?`<h5>What worked</h5><ul>${li(o.what_worked).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${li(o.not_moving).length?`<h5>Not moving yet</h5><ul>${li(o.not_moving).map(x=>`<li><b>${esc(x.title)}</b>. Try instead: ${esc(x.try_instead||"")}</li>`).join("")}</ul>`:""}
      ${li(o.next_month).length?`<h5>Next month</h5><ul>${li(o.next_month).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${o.data_note?`<div class="note">${esc(o.data_note)}</div>`:""}`;
  }else if(r.kind==="team"){
    body=`<div class="sum">${esc(o.headline||"")}</div>
      ${li(o.strengths).length?`<h5>Team strengths</h5><ul>${li(o.strengths).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${li(o.weaknesses).length?`<h5>Work on as a team</h5><ul>${li(o.weaknesses).map(x=>`<li><b>${esc(x.title)}</b>. ${esc(x.why||"")}${x.drill?`<br><span class="note">Drill: ${esc(x.drill)}</span>`:""}</li>`).join("")}</ul>`:""}
      ${li(o.practice_plan).length?`<h5>Practice plan</h5><ul>${li(o.practice_plan).map(x=>`<li><b>${esc(x.block)}</b>${x.minutes?` (${esc(x.minutes)} min)`:""}: ${esc(x.what||"")}</li>`).join("")}</ul>`:""}
      ${li(o.spotlights).length?`<h5>Player spotlights</h5><ul>${li(o.spotlights).map(x=>`<li><b>${esc(x.first_name)}</b>: ${esc(x.note||"")}</li>`).join("")}</ul>`:""}
      ${o.data_note?`<div class="note">${esc(o.data_note)}</div>`:""}`;
  }else{
    const ev=f=>li(f.evidence).length?`<div class="evid">Evidence: ${li(f.evidence).map(e=>`${esc(e.note||"")}${e.date?` (${esc(fmtDay(e.date))})`:""}${e.clip_id?` <button class="linkbtn" data-goclip="${e.clip_id}">see clip</button>`:""}`).join("; ")}</div>`:"";
    body=`<div class="sum">${esc(o.summary||"")}</div>
      ${li(o.strengths).length?`<h5>Strengths</h5><ul>${li(o.strengths).map(s=>`<li><b>${esc(s.title)}</b>. ${esc(s.detail||"")}</li>`).join("")}</ul>`:""}
      ${li(o.focus).length?`<h5>Work on</h5><ul>${li(o.focus).map(f=>`<li>${f.status?pill(f.status):""}<b>${esc(f.title)}</b>. ${esc(f.why||"")}${f.drill?`<br><span class="note">Drill: ${esc(f.drill)}</span>`:""}${ev(f)}</li>`).join("")}</ul>`:""}
      ${li(o.resolved).length?`<h5>Resolved</h5><ul>${li(o.resolved).map(x=>`<li>${pill("resolved")}<b>${esc(x.title)}</b>${x.note?`. ${esc(x.note)}`:""}</li>`).join("")}</ul>`:""}
      ${li(o.watch).length?`<h5>Keep an eye on</h5><ul>${li(o.watch).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      ${o.changes?`<h5>Since last version</h5><div>${esc(o.changes)}</div>`:""}
      <div class="note">${esc([o.data_note,basisLine(r.basis)].filter(Boolean).join(" "))}</div>`;
  }
  return `<div class="ai-card" data-rid="${r.id}">${meta}${body}${commentsHtml(r)}${actions}</div>`;
}
const wuById={};
function wuActions(r,kind){
  const b=[];
  if(kind==="draft")b.push(`<button class="primary" data-wu="review" data-id="${r.id}">Mark reviewed</button>`);
  if(kind!=="past")b.push(`<button data-wu="edit" data-id="${r.id}">Edit</button>`);
  b.push(`<button data-wu="comment" data-id="${r.id}">Comment</button>`);
  if(r.status==="draft")b.push(`<button data-wu="discard" data-id="${r.id}">Discard</button>`);
  return `<div class="row">${b.join("")}</div><div class="wu-cbox" hidden><textarea maxlength="1000" placeholder="Add a correction or context. The AI treats coach comments as fact next time."></textarea><div class="row"><button class="primary" data-wu="addc" data-id="${r.id}">Add comment</button><button data-wu="cancelc">Cancel</button></div></div>`;
}
async function renderWriteup(pid){
  const cur=$("#wu-current"),state=$("#wu-state");
  const [{data,error},pl]=await Promise.all([
    sb.from("ai_reports").select("*").eq("player_id",pid).in("kind",["player","clip","deepdive"]).neq("status","discarded").order("created_at",{ascending:false}).limit(80),
    sb.from("players").select("data_changed_at,ai_ok").eq("id",pid)]);
  if(error){cur.innerHTML=`<p class="note">${esc(/status|comments|basis|source/.test(error.message||"")?"Write-ups need one more database step. Run supabase/008_living_writeups.sql in Supabase.":notSetUp(error))}</p>`;return;}
  if(curPlayer!==pid)return;
  data.forEach(r=>wuById[r.id]=r);
  const versions=data.filter(r=>r.kind==="player"),clips=data.filter(r=>r.kind==="clip"),dd=data.find(r=>r.kind==="deepdive");
  const reviewed=versions.find(v=>v.status==="reviewed"),latest=versions[0];
  const draft=latest&&latest.status==="draft"&&(!reviewed||latest.created_at>reviewed.created_at)?latest:null;
  const changed=pl.data&&pl.data[0]&&pl.data[0].data_changed_at;
  const stale=changed&&(!latest||new Date(changed)>new Date(latest.created_at));
  state.textContent=!versions.length?"No write-up yet. Press Update now to make the first one. After that it updates overnight whenever this player gets new stats, notes, measurements, or clips.":
    stale?`New data since the last version (${ago(changed)}). It will update overnight, or press Update now.`:"Up to date. It updates overnight when new data comes in.";
  let html="";
  if(draft)html+=`<div class="wu-banner"><span><b>New draft</b> from ${esc(dateStr(draft.created_at))} needs a coach's review. Mark it reviewed, edit it, or add a comment to correct it.</span></div>${reportHtml(draft,wuActions(draft,"draft"))}`;
  if(reviewed)html+=draft?`<details><summary>Current reviewed write-up (${esc(dateStr(reviewed.created_at))})</summary>${reportHtml(reviewed,wuActions(reviewed,"current"))}</details>`:reportHtml(reviewed,wuActions(reviewed,"current"));
  cur.innerHTML=html;
  const shown=new Set([draft&&draft.id,reviewed&&reviewed.id]);
  const past=versions.filter(v=>!shown.has(v.id));
  $("#wu-history").hidden=!past.length;$("#wu-history summary").textContent=`Past versions (${past.length})`;
  $("#wu-past").innerHTML=past.map(v=>reportHtml(v,wuActions(v,"past"))).join("");
  $("#wu-clips").hidden=!clips.length;$("#wu-clips summary").textContent=`Clip and photo reviews (${clips.length})`;
  $("#wu-cliplist").innerHTML=clips.map(c=>reportHtml(c,wuActions(c,"past"))).join("");
  $("#wu-deepdive").innerHTML=dd?`<details${draft?"":" open"}><summary>Season review from ${esc(dateStr(dd.created_at))}</summary>${reportHtml(dd)}</details>`:"";
  $("#wu-deep").disabled=!versions.length;
  $("#wu-refresh").textContent=versions.length?"Update now":"Write the first one";
}
function editForm(r){
  const o=r.output||{};
  return `<form class="wu-edit" data-eid="${r.id}">
    <label class="f">Summary<textarea name="summary">${esc(o.summary||"")}</textarea></label>
    <label class="f">Strengths (one per line, "Title: detail")<textarea name="strengths">${esc(li(o.strengths).map(s=>`${s.title}: ${s.detail||""}`).join("\n"))}</textarea></label>
    ${li(o.focus).map((f,i)=>`<fieldset><legend class="f-label">Work on ${i+1}</legend>
      <div class="row"><label class="f" style="flex:1">Title<input name="f${i}title" value="${esc(f.title)}"></label><label class="f">Status<select name="f${i}status">${["new","improving","still","resolved"].map(s=>`<option value="${s}" ${f.status===s?"selected":""}>${{new:"New",improving:"Improving",still:"Still working",resolved:"Resolved"}[s]}</option>`).join("")}</select></label></div>
      <label class="f">Why<textarea name="f${i}why">${esc(f.why||"")}</textarea></label>
      <label class="f">Drill<input name="f${i}drill" value="${esc(f.drill||"")}"></label></fieldset>`).join("")}
    <label class="f">Keep an eye on (one per line)<textarea name="watch">${esc(li(o.watch).join("\n"))}</textarea></label>
    <div class="row"><button class="primary" type="submit">Save changes</button><button type="button" data-wu="canceledit">Cancel</button></div>
  </form>`;
}
const wuStatus=t=>setStatus($("#ai-status"),t.text||t,t.kind||"");
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-wu],[data-goclip]");if(!b)return;
  if(b.dataset.goclip){e.preventDefault();const t=document.getElementById("tile-"+b.dataset.goclip);
    if(t){t.scrollIntoView({behavior:"smooth",block:"center"});t.style.outline="3px solid var(--red)";setTimeout(()=>t.style.outline="",2500);}
    else{const m=(await sb.from("media").select("*").eq("id",b.dataset.goclip)).data;if(m&&m[0]){mediaById[m[0].id]=m[0];const urls=await signedUrls(m);const box=document.createElement("div");box.className="gallery";box.innerHTML=tileHtml(m[0],urls);b.closest(".ai-card").appendChild(box);}}
    return;}
  const a=b.dataset.wu,r=wuById[b.dataset.id],card=b.closest(".ai-card");
  try{
    if(a==="review"){await q(sb.from("ai_reports").update({status:"reviewed",reviewed_by_name:me.name||me.email,reviewed_at:new Date().toISOString()}).eq("id",r.id));logAct(`Reviewed a write-up`);renderWriteup(curPlayer);}
    else if(a==="discard"){if(b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent="Tap again to discard";return;}await q(sb.from("ai_reports").update({status:"discarded"}).eq("id",r.id));renderWriteup(curPlayer);}
    else if(a==="comment"){const box=card.querySelector(".wu-cbox");box.hidden=false;box.querySelector("textarea").focus();}
    else if(a==="cancelc"){card.querySelector(".wu-cbox").hidden=true;}
    else if(a==="addc"){const t=card.querySelector(".wu-cbox textarea").value.trim();if(!t)return;
      const comments=[...(r.comments||[]),{by:me.name||me.email,at:new Date().toISOString(),text:t}];
      await q(sb.from("ai_reports").update({comments}).eq("id",r.id));r.comments=comments;renderWriteup(curPlayer);}
    else if(a==="edit"){card.outerHTML=editForm(r);}
    else if(a==="canceledit"){renderWriteup(curPlayer);}
  }catch(err){wuStatus({text:notSetUp(err),kind:"err"});}
});
document.addEventListener("submit",async e=>{
  const f=e.target.closest(".wu-edit");if(!f)return;e.preventDefault();
  const r=wuById[f.dataset.eid],o=r.output||{},v=n=>(f.elements[n]?f.elements[n].value:"").trim();
  const lines=s=>s.split("\n").map(x=>x.trim()).filter(Boolean);
  const focus=[],resolved=[...li(o.resolved)];
  li(o.focus).forEach((x,i)=>{const it={...x,title:v(`f${i}title`),status:v(`f${i}status`),why:v(`f${i}why`),drill:v(`f${i}drill`)};if(!it.title)return;if(it.status==="resolved")resolved.push({id:it.id,title:it.title,note:"Marked resolved by a coach."});else focus.push(it);});
  const out={...o,summary:v("summary"),strengths:lines(v("strengths")).map(l=>{const k=l.indexOf(":");return k>0?{title:l.slice(0,k).trim(),detail:l.slice(k+1).trim()}:{title:l,detail:""};}),focus,resolved,watch:lines(v("watch"))};
  try{await q(sb.from("ai_reports").update({output:out,edited:true,ai_output:r.ai_output||r.output}).eq("id",r.id));logAct("Edited a write-up");renderWriteup(curPlayer);}
  catch(err){wuStatus({text:notSetUp(err),kind:"err"});}
});
async function wuRun(action,btn){
  const st=$("#ai-status");if(!aiEnabled){setStatus(st,AI_OFF,"err");return;}
  btn.disabled=true;setStatus(st,action==="refresh"?"Writing the update. This usually takes 20–60 seconds.":"Looking back over every version. This usually takes 30–60 seconds.");
  try{await api("/api/report",{action,team_id:TEAM.id,player_id:curPlayer});setStatus(st,action==="refresh"?"New draft ready below. Review it when you can.":"Season review ready below.","ok");renderWriteup(curPlayer);}
  catch(e){setStatus(st,e.message,"err");}
  finally{btn.disabled=false;}
}
$("#wu-refresh").onclick=e=>wuRun("refresh",e.currentTarget);
$("#wu-deep").onclick=e=>wuRun("deep_dive",e.currentTarget);
async function loadTeamReview(){
  const {data,error}=await sb.from("ai_reports").select("*").eq("team_id",TEAM.id).eq("kind","team").order("created_at",{ascending:false}).limit(1);
  $("#tr-out").innerHTML=error?"":data[0]?reportHtml(data[0]):`<p class="note">No team review yet.</p>`;
}
$("#tr-run").onclick=async()=>{
  const st=$("#tr-status"),btn=$("#tr-run");if(!aiEnabled){setStatus(st,AI_OFF,"err");return;}
  btn.disabled=true;setStatus(st,"Reading every player's write-up. This usually takes 30–60 seconds.");
  try{const r=await api("/api/report",{action:"team",team_id:TEAM.id});setStatus(st,"");$("#tr-out").innerHTML=reportHtml(r.report);logAct("Ran a team review");}
  catch(e){setStatus(st,e.message,"err");}
  finally{btn.disabled=false;}
};
$("#pl-aiok").addEventListener("change",async e=>{
  const p=S.players.find(x=>x.id===curPlayer),v=e.target.checked;
  try{await q(sb.from("players").update({ai_ok:v}).eq("id",p.id));p.ai_ok=v;setStatus($("#ai-status"),v?`AI review of ${p.name}'s photos and video is on.`:`AI review of ${p.name}'s photos and video is off.`,"ok");}
  catch(err){e.target.checked=!v;setStatus($("#ai-status"),notSetUp(err),"err");}
});

// ---- clip and photo review ----
const aiSheet=document.createElement("div");aiSheet.className="sheet-ov";aiSheet.hidden=true;
aiSheet.innerHTML=`<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="air-title"><h2 id="air-title">AI review</h2><div id="air-body"></div></div>`;
document.body.appendChild(aiSheet);
aiSheet.addEventListener("click",e=>{if(e.target===aiSheet&&!aiBusy)aiSheet.hidden=true;});
let aiBusy=false,aiMedia=null;
function openAiReview(m){
  aiMedia=m;const tagged=(m.players||[]).map(id=>S.players.find(p=>p.id===id)).filter(Boolean);
  const missing=tagged.filter(p=>!p.ai_ok);
  $("#air-body").innerHTML=missing.length?`<p>Before AI can look at this ${m.kind}, turn on <b>Family has OK'd AI review</b> on ${missing.map(p=>`<a href="#player-${p.id}">${esc(p.name)}'s page</a>`).join(", ")}. Everyone tagged in it needs it.</p><div class="row"><button type="button" data-air="close">Close</button></div>`:
   `<div class="row"><label class="f">Player<select id="air-player">${tagged.map(p=>`<option value="${p.id}" ${p.id===curPlayer?"selected":""}>#${p.num} ${esc(p.name)}</option>`).join("")}</select></label>
    <label class="f">Look at<select id="air-focus"><option>Hitting</option><option>Pitching</option><option>Fielding</option><option>Baserunning</option><option>General</option></select></label></div>
    <p class="note">${m.kind==="video"?`The site takes ${aiMulti?"about 10":"6"} still frames from the clip and sends them, with this player's recent stats and notes, for review.`:"The photo is sent with this player's recent stats and notes for review."} Treat the result as a second set of eyes, not a verdict.</p>
    <span class="status" id="air-status"></span><div id="air-result"></div>
    <div class="row"><button class="primary big" type="button" data-air="run" style="flex:1">Review it</button><button type="button" data-air="close">Close</button></div>`;
  aiSheet.hidden=false;const b=aiSheet.querySelector("button");if(b)b.focus();
}
async function mediaBlob(m){const {data,error}=await sb.storage.from("media").download(m.path);if(error)throw new Error("Couldn't load that file.");return data;}
async function videoFrames(blob,count=10,maxW=768){
  const url=URL.createObjectURL(blob),v=document.createElement("video");v.muted=true;v.playsInline=true;v.preload="auto";v.src=url;
  await new Promise((res,rej)=>{v.onloadedmetadata=res;v.onerror=()=>rej(new Error("This browser can't open that video. Try a phone or Chrome."));setTimeout(()=>rej(new Error("The video took too long to open.")),30000);});
  const dur=v.duration;if(!isFinite(dur)||dur<=0)throw new Error("Couldn't read the video's length.");
  const n=Math.max(3,Math.min(count,Math.round(dur*4))),times=Array.from({length:n},(_,i)=>dur*(0.03+0.94*i/(n-1)));
  const s=Math.min(1,maxW/(v.videoWidth||maxW)),c=document.createElement("canvas");c.width=Math.round((v.videoWidth||maxW)*s);c.height=Math.round((v.videoHeight||maxW*.56)*s);const cx=c.getContext("2d");
  const out=[];
  for(const t of times){v.currentTime=t;await new Promise((res,rej)=>{const to=setTimeout(()=>rej(new Error("The video wouldn't skip to a frame.")),10000);v.onseeked=()=>{clearTimeout(to);res();};});
    cx.drawImage(v,0,0,c.width,c.height);const b=await new Promise(r=>c.toBlob(r,"image/jpeg",.8));out.push({t,b64:await blobToB64(b),url:URL.createObjectURL(b)});}
  URL.revokeObjectURL(url);return out;
}
// Free vision model takes one image, so clip frames go in as one numbered contact sheet.
async function contactSheet(frames,cols=3,cellW=420){
  const imgs=await Promise.all(frames.map(f=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=f.url;})));
  const cellH=Math.round(cellW*imgs[0].height/imgs[0].width),rows=Math.ceil(imgs.length/cols),gap=6;
  const c=document.createElement("canvas");c.width=cols*cellW+(cols-1)*gap;c.height=rows*cellH+(rows-1)*gap;const x=c.getContext("2d");
  x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);
  imgs.forEach((im,i)=>{const cx=(i%cols)*(cellW+gap),cy=Math.floor(i/cols)*(cellH+gap);x.drawImage(im,cx,cy,cellW,cellH);
    x.fillStyle="rgba(0,0,0,.75)";x.fillRect(cx,cy,44,34);x.fillStyle="#fff";x.font="bold 24px sans-serif";x.fillText(String(i+1),cx+(i+1>9?6:14),cy+26);});
  const b=await new Promise(r=>c.toBlob(r,"image/jpeg",.85));return blobToB64(b);
}
async function reviewMedia(m,pid,focus,say){
  const p=S.players.find(x=>x.id===pid);
  say(m.kind==="video"?`Pulling frames from the clip for ${p.name}…`:`Loading the photo for ${p.name}…`);
  const blob=await mediaBlob(m);
  const frames=m.kind==="video"?await videoFrames(blob,aiMulti?10:6):await (async()=>{const b=await resizeImage(blob,1280,.85);return [{t:null,b64:await blobToB64(b),url:URL.createObjectURL(b)}];})();
  say(`Reviewing ${p.name}. This usually takes 20–60 seconds.`);
  const ctx=await playerContext(pid);
  const brief={...teamContext(),player:ctx.player,batting:ctx.batting_all_games,pitching:ctx.pitching_all_games,recent_games:ctx.game_log.slice(-5),
    coach_notes_on_topic:ctx.coach_notes.filter(n=>n.topic===focus.toLowerCase()||n.topic==="general").slice(0,6),caption:m.caption||""};
  const sheet=m.kind==="video"&&!aiMulti;
  const imgs=sheet?[{data:await contactSheet(frames),media_type:"image/jpeg",label:`This one image is a contact sheet of ${frames.length} frames from the video, in time order, numbered 1 to ${frames.length} left to right, top to bottom.`}]
    :frames.map((f,i)=>({data:f.b64,media_type:"image/jpeg",label:m.kind==="video"?`Frame ${i+1} (${f.t.toFixed(1)}s)`:"Frame 1"}));
  const out=await aiImages(`You are an experienced youth baseball coach reviewing ${m.kind==="video"?`${frames.length} still frames taken in order from a short video`:"a photo"} of one player, #${p.num} ${p.name}. Focus area: ${focus}. Other people may appear; comment only on this player.
Only describe what is actually visible. If the images don't show the motion clearly (camera angle, blur, player too small, a different activity), say so and set confidence to low.
${COACH_RULES}
Return ONLY JSON with this shape: {"what_it_shows":"one sentence","positives":[""],"observations":[{"frame":1,"note":""}],"focus":[{"title":"","why":"","drill":""}],"confidence":"low|medium|high","caveats":"one sentence"}. At most 3 positives, 6 observations, and 2 focus items.${m.kind==="video"?"":" Use frame 1 for the photo."}

PLAYER CONTEXT:
${JSON.stringify(brief)}`,imgs);
  if(!out||!out.what_it_shows)throw new Error("The AI's answer was incomplete. Try again.");
  out.focus_area=focus;
  const saved=await saveReport({kind:"clip",player_id:pid,media_id:m.id,output:out,status:"reviewed"});
  logAct(`AI clip review for ${p.name}`);
  return {saved,frames};
}
async function runAiReview(){
  const st=$("#air-status"),m=aiMedia,pid=$("#air-player").value,focus=$("#air-focus").value,p=S.players.find(x=>x.id===pid);
  if(!aiEnabled){setStatus(st,AI_OFF,"err");return;}
  aiBusy=true;aiSheet.querySelectorAll("button").forEach(b=>b.disabled=true);
  try{
    const {saved,frames}=await reviewMedia(m,pid,focus,t=>setStatus(st,t));
    setStatus(st,`Saved to ${p.name}'s write-up. It'll be used the next time the write-up updates.`,"ok");
    $("#air-result").innerHTML=`${frames.length>1?`<div class="frames">${frames.map((f,i)=>`<figure><img src="${f.url}" alt="Frame ${i+1}"><figcaption>Frame ${i+1}</figcaption></figure>`).join("")}</div>`:""}${reportHtml(saved)}`;
    if(curView==="player"&&curPlayer===pid)renderWriteup(pid);
  }catch(e){setStatus(st,notSetUp(e),"err");}
  finally{aiBusy=false;aiSheet.querySelectorAll("button").forEach(b=>b.disabled=false);}
}
async function autoReview(rows,focus,st){
  let done=0,skipped=[];
  for(const m of rows){
    if(!m||!m.path||!(m.players||[]).length)continue;
    const tagged=m.players.map(id=>S.players.find(p=>p.id===id)).filter(Boolean);
    const missing=tagged.filter(p=>!p.ai_ok);
    if(missing.length){skipped.push(...missing.map(p=>p.name));continue;}
    for(const p of tagged.slice(0,3)){
      try{await reviewMedia(m,p.id,focus,t=>setStatus(st,t));done++;}
      catch(e){setStatus(st,`AI review stopped: ${notSetUp(e)}`,"err");return;}
    }
  }
  const sk=[...new Set(skipped)];
  setStatus(st,`${done?`AI reviewed ${done} upload${done>1?"s":""}; the results feed each player's write-up.`:"Upload done."}${sk.length?` Skipped AI for ${sk.join(", ")} (family OK not checked on their page).`:""}`,done||!sk.length?"ok":"");
}
aiSheet.addEventListener("click",e=>{const b=e.target.closest("[data-air]");if(!b)return;if(b.dataset.air==="close"){if(!aiBusy)aiSheet.hidden=true;}else runAiReview();});
document.addEventListener("click",e=>{const b=e.target.closest("[data-mai]");if(!b)return;const m=mediaById[b.dataset.mai];if(m)openAiReview(m);});

// ---- game-day helper ----
let gdPlan=null;
$("#gd-run").onclick=async()=>{
  const out=$("#gd-out"),g=curGame();
  if(!aiEnabled){out.innerHTML=`<p class="status err">${esc(AI_OFF)}</p>`;return;}
  const ps=activeLineup();if(!g||ps.length<2){out.innerHTML=`<p class="status err">Pick the game and check at least two players first.</p>`;return;}
  $("#gd-run").disabled=true;out.innerHTML=`<p class="status">Planning the lineup and pitching. This usually takes 20–40 seconds.</p>`;
  try{
    const players=ps.map(p=>{const all=playerLines(p.id,true),team=playerLines(p.id,false),last5=team.slice(-5);
      return {jersey:p.num,first_name:p.name,
        batting_season:pickNums(aggBat(team),["g","pa","ab","h","d","t","hr","bb","so","hbp","sb","avg","obp","slg"]),
        batting_last5:pickNums(aggBat(last5),["g","pa","ab","h","bb","so","avg","obp"]),
        pitching_season:pickNums(aggPit(all),["g","outs","pc","bb","so","era","whip"]),
        fielding_errors:(aggFld(team)||{}).e||0,
        pitching_on_game_day:availOn(p.id,g.date)};});
    const past=S.games.filter(x=>x.id!==g.id&&x.opp===g.opp&&x.us!=null).map(x=>({date:x.date,us:x.us,them:x.them}));
    const res=await ai(`You are helping a youth baseball coach plan an upcoming game. Suggest a batting order using every player listed (continuous batting order), and a pitching plan.
For pitching, use only players whose pitching_on_game_day.available is true, give each a pitch budget at or under the daily limit, and think about rest days for the next few games. Explain each choice briefly from the numbers; say when samples are small.
${COACH_RULES}
Return ONLY JSON with this shape: {"batting_order":[{"jersey":0,"reason":""}],"pitching":[{"jersey":0,"role":"starter|relief","pitch_budget":0,"reason":""}],"notes":[""]}. At most 3 notes.

GAME: ${JSON.stringify({date:g.date,opponent:g.opp,home:g.home,earlier_games_vs_opponent:past})}
TEAM: ${JSON.stringify(teamContext())}
PLAYERS: ${JSON.stringify(players)}`);
    const byNum=n=>ps.find(p=>p.num===+n);
    const order=[],seen=new Set();for(const b of res.batting_order||[]){const p=byNum(b.jersey);if(p&&!seen.has(p.id)){seen.add(p.id);order.push({p,reason:b.reason||""});}}
    for(const p of ps)if(!seen.has(p.id))order.push({p,reason:"Not placed by the AI; added at the end."});
    const pitching=(res.pitching||[]).map(x=>{const p=byNum(x.jersey);if(!p)return null;const a=availOn(p.id,g.date);return {p,role:x.role,budget:Math.min(+x.pitch_budget||0,S.team.pitchMax),reason:x.reason||"",ok:a.available,rested:a.rested_from};}).filter(Boolean);
    gdPlan={order:order.map(o=>o.p.id)};
    out.innerHTML=`<div class="ai-card"><div class="meta"><span class="ai-kind">Game plan</span><span>${dParts(g.date).m} ${dParts(g.date).d} ${g.home?"vs":"at"} ${esc(g.opp)}</span></div>
      <h5>Batting order</h5><ol class="gd-list">${order.map(o=>`<li><b>#${o.p.num} ${esc(o.p.name)}</b>. <span class="note">${esc(o.reason)}</span></li>`).join("")}</ol>
      <h5>Pitching</h5><ul>${pitching.map(x=>`<li>${x.ok?"":`<span class="flag">Not rested until ${esc(fmtDay(x.rested))}, so don't use. </span>`}<b>#${x.p.num} ${esc(x.p.name)}</b>, ${esc(x.role||"")}, up to ${x.budget} pitches. <span class="note">${esc(x.reason)}</span></li>`).join("")||"<li>No pitching suggestion.</li>"}</ul>
      ${li(res.notes).length?`<h5>Notes</h5><ul>${li(res.notes).map(n=>`<li>${esc(n)}</li>`).join("")}</ul>`:""}
      <div class="row"><button class="primary" type="button" id="gd-use">Use this batting order</button><button type="button" id="gd-close">Dismiss</button></div></div>`;
    saveReport({kind:"gameday",game_id:g.id,output:res}).catch(()=>{});
  }catch(e){out.innerHTML=`<p class="status err">${esc(notSetUp(e))}</p>`;}
  finally{$("#gd-run").disabled=false;}
};
$("#gd-out").addEventListener("click",e=>{
  if(e.target.id==="gd-close"){$("#gd-out").innerHTML="";gdPlan=null;}
  if(e.target.id==="gd-use"&&gdPlan){const rest=curLineup.order.filter(id=>!gdPlan.order.includes(id));curLineup.order=[...gdPlan.order,...rest];renderLineup();rebuildTables();$("#gd-out").innerHTML=`<p class="status ok">Batting order updated. Press Save lineup to keep it.</p>`;gdPlan=null;}
});

// ---------- announcements and roster reveal ----------
const rosterHidden=()=>!!(TEAM&&TEAM.roster_reveal_at&&new Date(TEAM.roster_reveal_at)>new Date());
const fmtWhen=t=>new Date(t).toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
function countdown(t){let s=Math.max(0,Math.round((new Date(t)-new Date())/1000));const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);
  return d?`${d} day${d>1?"s":""}, ${h} hr`:h?`${h} hr ${m} min`:`${m} min ${s%60} sec`;}
let bannerTimer=null;
function renderBanner(){
  const b=$("#team-banner");if(!TEAM){b.hidden=true;return;}
  const parts=[];
  if(rosterHidden())parts.push(`<b>Rosters post ${esc(fmtWhen(TEAM.roster_reveal_at))}</b><span class="cd" id="cd">${countdown(TEAM.roster_reveal_at)}</span>`);
  else if(TEAM.roster_reveal_at&&new Date()-new Date(TEAM.roster_reveal_at)<14*864e5)parts.push(`<b>The roster is posted.</b><a href="#roster">See who made the team</a>`);
  if(TEAM.announcement)parts.push(`<span>${esc(TEAM.announcement)}</span>`);
  b.hidden=!parts.length;b.innerHTML=parts.join("");
  clearInterval(bannerTimer);
  if(rosterHidden())bannerTimer=setInterval(async()=>{const el=$("#cd");if(el)el.textContent=countdown(TEAM.roster_reveal_at);
    if(!rosterHidden()){clearInterval(bannerTimer);await loadTeamData();render();route();}},1000);
}
async function saveReveal(at,msg){
  const st=$("#rv-status");
  try{await q(sb.from("teams").update({roster_reveal_at:at}).eq("id",TEAM.id));TEAM.roster_reveal_at=at;setStatus(st,msg,"ok");logAct(msg);render();}
  catch(e){setStatus(st,/roster_reveal_at/.test(e.message||"")?"Roster posting isn't set up yet. Run supabase/009_school_events_reveal.sql in Supabase.":errText(e),"err");}
}
$("#rv-save").onclick=()=>{const v=$("#rv-at").value;if(!v){setStatus($("#rv-status"),"Pick a date and time.","err");return;}const at=new Date(v);
  if(at<=new Date()){setStatus($("#rv-status"),"That time has passed. Pick a future time, or use Post now.","err");return;}
  saveReveal(at.toISOString(),`Roster will post ${fmtWhen(at)}`);};
$("#rv-now").onclick=()=>saveReveal(new Date().toISOString(),"Roster posted");

// ================= TRYOUTS =================
let tryouts=[],curTryout=null,tyPlayers=[],tyScores=[],tyFilter="all";
const TOOLS=[["arm","Arm"],["speed","Speed"],["fielding","Fielding"],["hitting","Hitting"],["pitching","Pitching"],["makeup","Makeup"]];
const squads=()=>teams.filter(t=>t.id===TEAM.id||(TEAM.school&&t.school===TEAM.school)).sort((a,b)=>a.name.localeCompare(b.name));
const tyName=x=>`${x.first_name} ${x.last_name}`;
function sheet(html){let s=$("#gen-sheet");if(!s){s=document.createElement("div");s.id="gen-sheet";s.className="sheet-ov";s.innerHTML=`<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="gen-title"></div>`;document.body.appendChild(s);
  s.addEventListener("click",e=>{if(e.target===s||e.target.closest("[data-close]"))s.hidden=true;});}
  s.querySelector(".sheet-card").innerHTML=html;s.hidden=false;const f=s.querySelector("button,input,textarea");if(f)f.focus();return s;}
const closeSheetGen=()=>{const s=$("#gen-sheet");if(s)s.hidden=true;};
async function updateTryoutNav(){
  const r=await sb.from("tryouts").select("*").eq("team_id",TEAM.id).order("created_at",{ascending:false});
  tryouts=r.error?[]:r.data;
  $("#nav-tryouts").hidden=!(isCoach||tryouts.some(t=>t.signups_open));
}
function signupForm(open){
  return `<form class="panel stack" id="ty-form" style="gap:10px;max-width:640px">
    <h3>Sign up for ${esc(open.length===1?open[0].title:"tryouts")}</h3>
    ${open.length>1?`<label class="f">Which tryout<select id="tyf-tryout">${open.map(t=>`<option value="${t.id}">${esc(t.title)}${t.date?" · "+esc(fmtDay(t.date)):""}</option>`).join("")}</select></label>`:`<p class="note">${open[0].date?esc(new Date(open[0].date+"T12:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})):""}${open[0].location?" · "+esc(open[0].location):""}</p>`}
    <div class="row"><label class="f">Player first name<input id="tyf-first" maxlength="40" required></label><label class="f">Last name<input id="tyf-last" maxlength="40" required></label>
      <label class="f">Grade<select id="tyf-grade"><option>9</option><option>10</option><option>11</option><option>12</option><option value="">Other</option></select></label></div>
    <div class="row"><label class="f" style="flex:1;min-width:160px">Positions<input id="tyf-pos" maxlength="60" placeholder="SS, 2B, RHP"></label>
      <label class="f">Bats<select id="tyf-bats"><option>R</option><option>L</option><option>S</option></select></label><label class="f">Throws<select id="tyf-throws"><option>R</option><option>L</option></select></label></div>
    <div class="row"><label class="f">Parent or guardian name<input id="tyf-pname" maxlength="80" required></label><label class="f">Parent email<input type="email" id="tyf-pemail" maxlength="200" required></label><label class="f">Phone (optional)<input type="tel" id="tyf-pphone" maxlength="30"></label></div>
    <label class="f">Anything the coaches should know (optional)<input id="tyf-note" maxlength="300"></label>
    <label class="f" style="position:absolute;left:-9999px" aria-hidden="true">Website<input id="tyf-web" tabindex="-1" autocomplete="off"></label>
    <p class="note">Only the coaching staff sees this information. It's used for tryouts and to let you know the results.</p>
    <div class="row"><button class="primary" type="submit">Sign up</button><span class="status" id="tyf-status"></span></div>
  </form>`;
}
document.addEventListener("submit",async e=>{
  if(e.target.id!=="ty-form")return;e.preventDefault();const st=$("#tyf-status");
  if($("#tyf-web").value){setStatus(st,"You're signed up.","ok");return;}
  const open=tryouts.filter(t=>t.signups_open),tid=$("#tyf-tryout")?$("#tyf-tryout").value:open[0].id;
  const row={tryout_id:tid,team_id:TEAM.id,first_name:$("#tyf-first").value.trim(),last_name:$("#tyf-last").value.trim(),grade:$("#tyf-grade").value,positions:$("#tyf-pos").value.trim(),
    bats:$("#tyf-bats").value,throws:$("#tyf-throws").value,parent_name:$("#tyf-pname").value.trim(),parent_email:$("#tyf-pemail").value.trim(),parent_phone:$("#tyf-pphone").value.trim(),family_note:$("#tyf-note").value.trim()};
  if(!row.first_name||!row.last_name||!row.parent_name||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.parent_email)){setStatus(st,"Fill in the player's name, a parent's name, and a valid email.","err");return;}
  const {error}=await sb.from("tryout_players").insert(row);
  if(error){setStatus(st,"Couldn't sign up. Sign-ups may have closed; check with the coach.","err");return;}
  e.target.reset();setStatus(st,`${row.first_name} is signed up. See you at tryouts!`,"ok");
});
async function renderTryouts(){
  await updateTryoutNav();
  const open=tryouts.filter(t=>t.signups_open);
  if(!isCoach){$("#ty-public").innerHTML=open.length?signupForm(open):`<p class="note">Tryout sign-ups aren't open right now.</p>`;return;}
  $("#ty-public").innerHTML=open.length?`<p class="note">Sign-ups are open. Families sign up on this page: <span style="user-select:all">${esc(location.origin+location.pathname)}#tryouts</span></p>`:"";
  $("#ty-list").innerHTML=tryouts.map(t=>`<div class="ty-row"><div><b>${esc(t.title)}</b> <span class="note">${t.date?esc(fmtDay(t.date)):""}${t.location?" · "+esc(t.location):""}</span>${t.signups_open?` <span class="chip ok">Sign-ups open</span>`:""}</div>
    <div class="row"><button data-ty="board" data-id="${t.id}" class="${curTryout===t.id?"primary":""}">Open board</button><button data-ty="toggle" data-id="${t.id}">${t.signups_open?"Close sign-ups":"Open sign-ups"}</button><button data-ty="del" data-id="${t.id}">Delete</button></div></div>`).join("")||`<p class="note">No tryouts yet. Create one below; open sign-ups when you're ready for families to register.</p>`;
  if(!curTryout&&tryouts[0])curTryout=tryouts[0].id;
  $("#ty-new").open=!tryouts.length;
  renderBoard();
}
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
function tyStats(x){
  const sc=tyScores.filter(s=>s.tryout_player_id===x.id),o={n:sc.length,coaches:new Set(sc.map(s=>s.coach_id)).size};
  for(const [k] of TOOLS)o[k]=avg(sc.map(s=>s[k]).filter(v=>v!=null));
  const t=TOOLS.map(([k])=>o[k]).filter(v=>v!=null);o.overall=t.length?avg(t):null;
  const nums=k=>sc.map(s=>s[k]).filter(v=>v!=null).map(Number);
  o.sixty=nums("sixty").length?Math.min(...nums("sixty")):null;o.velo=nums("velo").length?Math.max(...nums("velo")):null;o.pop=nums("pop").length?Math.min(...nums("pop")):null;o.h2f=nums("h2f").length?Math.min(...nums("h2f")):null;
  o.notes=sc.filter(s=>s.note).map(s=>`${s.coach_name||"Coach"}: ${s.note}`);
  return o;
}
// ---------- tryout day: check-in, stations, stopwatch, board, setup ----------
const TY_DEFAULT_GUIDE={
  arm:["Loops it, can't reach the base on a line","Accurate, average carry for the position","Plus carry and accuracy, throws on a line from deep"],
  speed:["Well below average, 60 over 7.8","Average, 60 around 7.3","Plus runner, 60 under 6.9"],
  fielding:["Stiff hands, poor footwork, misses routine plays","Makes the routine play, sound footwork","Smooth, range both ways, makes hard plays look easy"],
  hitting:["Late, long swing, rarely squares it up","Consistent contact, some gap power","Barrels it consistently, hard contact to all fields"],
  pitching:["Struggles to throw strikes","Fastball for strikes plus a second pitch","Commands 2 or 3 pitches, velo above team average"],
  makeup:["Low effort, doesn't take coaching","Works hard, listens, adjusts","Leader, hustles every rep, adjusts right away"]};
const TY_NUMS={sixty:{l:"60 yd",u:"s",low:true,step:"0.01"},h2f:{l:"Home to 1st",u:"s",low:true,step:"0.01"},pop:{l:"Pop time",u:"s",low:true,step:"0.01"},velo:{l:"Velo",u:"mph",low:false,step:"0.1"}};
const STATIONS=[
  {id:"hitting",name:"Hitting",tools:["hitting"]},
  {id:"fielding",name:"Infield / outfield",tools:["fielding","arm"]},
  {id:"pitching",name:"Pitching",tools:["pitching"],nums:["velo"]},
  {id:"catching",name:"Catching",tools:["arm"],nums:["pop"],timer:["pop"]},
  {id:"running",name:"Running",tools:["speed"],nums:["sixty","h2f"],timer:["sixty","h2f"]},
  {id:"makeup",name:"Makeup",tools:["makeup"]}];
const toolLabel=k=>(TOOLS.find(t=>t[0]===k)||[k,k])[1];
let tyMode=lsGet("ty-mode")||"checkin",tyStation=lsGet("ty-station")||"hitting",tyRange={from:"",to:""},tySearch="";
const curTy=()=>tryouts.find(x=>x.id===curTryout);
const tyGuide=t=>({...TY_DEFAULT_GUIDE,...((t&&t.rubric)||{})});
const tyNo=x=>x.tryout_no!=null?x.tryout_no:"—";
const hereToday=x=>(x.checked_in_days||[]).includes(today());

// Scores save on the phone first and upload when there's signal, so nothing is lost at a far field.
let tyPending=(()=>{try{return JSON.parse(localStorage.getItem("ty-pending")||"{}");}catch(e){return {};}})();
const tySavePending=()=>lsSet("ty-pending",JSON.stringify(tyPending));
let tyFlushing=false,tyErr="",tyFlushTimer=null;
function myRow(xid){return tyScores.find(s=>s.tryout_player_id===xid&&s.coach_id===me.id&&s.day===today());}
function tyScore(xid,fields){
  const base={tryout_player_id:xid,team_id:TEAM.id,coach_id:me.id,coach_name:me.name||me.email,day:today()};
  let r=myRow(xid);if(!r){r={...base};tyScores.push(r);}Object.assign(r,fields);
  const k=`${xid}|${me.id}|${base.day}`;
  tyPending[k]={...(tyPending[k]||base),...fields,updated_at:new Date().toISOString()};tySavePending();tySyncLine();
  clearTimeout(tyFlushTimer);tyFlushTimer=setTimeout(tyFlush,250);
}
async function tyFlush(){
  if(tyFlushing||!session)return;const keys=Object.keys(tyPending);if(!keys.length){tySyncLine();return;}
  tyFlushing=true;
  try{for(const k of keys){const row=tyPending[k];
      const {error}=await sb.from("tryout_scores").upsert(row,{onConflict:"tryout_player_id,coach_id,day"});
      if(error){tyErr=/day|makeup|h2f|column|constraint|conflict/i.test(error.message||"")?"Scores are saved on this phone but can't upload until supabase/014_tryout_days.sql is run in Supabase.":"";break;}
      tyErr="";if(tyPending[k]===row)delete tyPending[k];}}
  catch(e){}
  finally{tyFlushing=false;tySavePending();tySyncLine();}
}
function tySyncLine(){const el=$("#ty-sync");if(!el)return;const n=Object.keys(tyPending).length;
  el.className="ty-sync "+(tyErr?"err":n?"wait":"ok");
  el.textContent=tyErr||(n?`${n} score${n>1?"s":""} saved on this phone, uploading when there's signal…`:"All scores saved.");}
addEventListener("online",tyFlush);setInterval(()=>{if(Object.keys(tyPending).length)tyFlush();},15000);

async function renderBoard(){
  const box=$("#ty-board");const t=curTy();if(!t){box.innerHTML="";return;}
  const a=await sb.from("tryout_players").select("*").eq("tryout_id",t.id).order("last_name");
  if(a.error){box.innerHTML=`<p class="status err">${esc(/tryout/.test(a.error.message)?"Tryouts aren't set up yet. Run supabase/010_hs_tools.sql in Supabase.":errText(a.error))}</p>`;return;}
  tyPlayers=a.data;const ids=new Set(tyPlayers.map(x=>x.id));
  const b=await sb.from("tryout_scores").select("*").eq("team_id",TEAM.id);
  tyScores=(b.data||[]).filter(s=>ids.has(s.tryout_player_id)).map(s=>({...s,day:s.day||today()}));
  // Keep scores still waiting to upload on screen.
  for(const p of Object.values(tyPending)){if(!ids.has(p.tryout_player_id))continue;let r=tyScores.find(s=>s.tryout_player_id===p.tryout_player_id&&s.coach_id===p.coach_id&&s.day===p.day);if(!r){r={};tyScores.push(r);}Object.assign(r,p);}
  renderTyBody();tyFlush();
}
function renderTyBody(){
  const box=$("#ty-board"),t=curTy();if(!t)return;
  const modes=[["checkin","Check-in"],["stations","Stations"],["board","Board"],["setup","Setup"]];
  const here=tyPlayers.filter(hereToday).length;
  let body="";
  if(tyMode==="checkin")body=tyCheckinHtml();else if(tyMode==="stations")body=tyStationHtml(t);else if(tyMode==="setup")body=tySetupHtml(t);else body=tyBoardHtml(t);
  box.innerHTML=`<div class="panel stack" style="gap:12px">
    <div class="sec-head" style="margin:0"><h3>${esc(t.title)} · ${tyPlayers.length} signed up · ${here} here today</h3>
      <div class="seg ty-modes" role="group" aria-label="Tryout tools">${modes.map(([k,l])=>`<button type="button" data-tymode="${k}" aria-pressed="${tyMode===k}">${l}</button>`).join("")}</div></div>
    <div id="ty-sync" class="ty-sync"></div>
    ${body}</div>`;
  tySyncLine();
  if(tyMode==="stations")tyTimerWire();
}

// Check-in: hand out numbers kids pin on their shirts; each day they arrive counts as a day attended.
function tyCheckinHtml(){
  const s=tySearch.trim().toLowerCase();
  const list=tyPlayers.filter(x=>!s||tyName(x).toLowerCase().includes(s)||String(x.tryout_no)===s).sort((a,b)=>a.last_name.localeCompare(b.last_name));
  return `<p class="note">Check kids in as they arrive. The first time, each one gets a tryout number to pin on their shirt; they keep it every day. Coaches score by number.</p>
    <label class="f">Find a player<input type="search" id="ty-find" value="${esc(tySearch)}" placeholder="Name or number" autocomplete="off"></label>
    <div class="ci-list">${list.map(x=>`<div class="ci-row ${hereToday(x)?"here":""}"><b class="st-no">${tyNo(x)}</b><div><b>${esc(x.last_name)}, ${esc(x.first_name)}</b><small>${esc([x.grade?"Grade "+x.grade:"",x.positions].filter(Boolean).join(" · "))}${(x.checked_in_days||[]).length?` · day ${(x.checked_in_days||[]).length}`:""}</small></div>
      ${hereToday(x)?`<span class="chip ok">Here today</span><button type="button" class="linkbtn" data-ci-undo="${x.id}">Undo</button>`:`<button type="button" class="primary" data-ci="${x.id}">Check in</button>`}</div>`).join("")||`<p class="note">${s?"No one matches.":"No one signed up yet. Add walk-ups below."}</p>`}</div>
    <form class="row" id="ty-walk"><label class="f">First name<input id="tyw-first" maxlength="40"></label><label class="f">Last name<input id="tyw-last" maxlength="40"></label><label class="f">Grade<input id="tyw-grade" maxlength="5" style="width:60px"></label><label class="f">Positions<input id="tyw-pos" maxlength="60"></label><button type="submit">Add walk-up and check in</button><span class="status" id="tyw-status"></span></form>`;
}
const nextNo=()=>tyPlayers.reduce((m,x)=>Math.max(m,+x.tryout_no||0),0)+1;
async function tyCheckIn(x,undo){
  const days=new Set(x.checked_in_days||[]);undo?days.delete(today()):days.add(today());
  const upd={checked_in_days:[...days].sort()};if(!undo&&x.tryout_no==null)upd.tryout_no=nextNo();
  const {error}=await sb.from("tryout_players").update(upd).eq("id",x.id);
  if(error){alertBoard(/tryout_no|checked_in/.test(error.message||"")?"Check-in needs supabase/014_tryout_days.sql run in Supabase first.":errText(error));return;}
  Object.assign(x,upd);renderTyBody();
}

// Stations: a coach picks their station and taps 1 to 5 for each kid going through.
function stationKids(){
  const anyHere=tyPlayers.some(hereToday),f=+tyRange.from||0,to=+tyRange.to||Infinity;
  return tyPlayers.filter(x=>(!anyHere||hereToday(x))&&(x.tryout_no==null?!f&&to===Infinity:x.tryout_no>=f&&x.tryout_no<=to))
    .sort((a,b)=>(a.tryout_no??1e9)-(b.tryout_no??1e9)||a.last_name.localeCompare(b.last_name));
}
function tyStationHtml(t){
  const st=STATIONS.find(s=>s.id===tyStation)||STATIONS[0],g=tyGuide(t),kids=stationKids();
  const guide=`<details class="ty-guide"><summary>Scoring guide</summary>${st.tools.map(k=>`<div><b>${toolLabel(k)}</b><ol class="g135"><li value="1">${esc(g[k][0])}</li><li value="3">${esc(g[k][1])}</li><li value="5">${esc(g[k][2])}</li></ol></div>`).join("")}</details>`;
  const timer=st.timer?`<div class="tyw">
      ${st.timer.length>1?`<div class="seg" role="group">${st.timer.map(k=>`<button type="button" data-twev="${k}" aria-pressed="${tyT.ev===k}">${TY_NUMS[k].l}</button>`).join("")}</div>`:""}
      <label class="f">${st.id==="catching"?"Catcher":"Runner"}<select id="tyw-who">${kids.map(x=>`<option value="${x.id}" ${tyT.who===x.id?"selected":""}>#${tyNo(x)} ${esc(x.first_name)} ${esc(x.last_name.charAt(0))}.</option>`).join("")}</select></label>
      <div class="tyw-clock" id="tyw-clock">${tyT.run?"…":"0.00"}</div>
      <button type="button" class="primary tyw-go ${tyT.run?"stop":""}" id="tyw-go">${tyT.run?"Stop":"Start"}</button>
      <div id="tyw-last" class="note">${tyT.lastHtml||"Tap Start when they go, Stop when they finish. The best time counts. It moves to the next player after each time."}</div></div>`:"";
  return `<div class="row st-pick"><label class="f">My station<select id="ty-station">${STATIONS.map(s=>`<option value="${s.id}" ${s.id===st.id?"selected":""}>${s.name}</option>`).join("")}</select></label>
      <div class="f">Numbers (optional)<span class="row" style="gap:6px;flex-wrap:nowrap"><input type="number" id="ty-from" value="${esc(tyRange.from)}" style="width:70px" inputmode="numeric" aria-label="From number" placeholder="From"><span>to</span><input type="number" id="ty-to" value="${esc(tyRange.to)}" style="width:70px" inputmode="numeric" aria-label="To number" placeholder="To"></span></div></div>
    ${guide}${timer}
    <p class="note">${tyPlayers.some(hereToday)?"Showing kids checked in today.":"No one is checked in today, so everyone is listed."} Your scores are for today (${esc(fmtDay(today()))}); other coaches can't change them.</p>
    <div class="st-list">${kids.map(x=>stRow(x,st)).join("")||`<p class="note">No kids in that number range.</p>`}</div>`;
}
function stRow(x,st){
  const m=myRow(x.id)||{};
  return `<div class="st-row"><div class="st-who"><b class="st-no">${tyNo(x)}</b><span>${esc(x.first_name)} ${esc(x.last_name)}<small>${esc([x.positions,x.grade?"Gr "+x.grade:""].filter(Boolean).join(" · "))}</small></span></div>
    <div class="st-in">${st.tools.map(k=>`<div class="st-tool">${st.tools.length>1?`<span>${toolLabel(k)}</span>`:""}<div class="seg st-seg" role="group" aria-label="${toolLabel(k)} for number ${tyNo(x)}">${[1,2,3,4,5].map(v=>`<button type="button" data-st-x="${x.id}" data-st-k="${k}" data-v="${v}" aria-pressed="${m[k]===v}">${v}</button>`).join("")}</div></div>`).join("")}
      ${(st.nums||[]).map(k=>`<label class="st-num">${TY_NUMS[k].l}<input type="number" step="${TY_NUMS[k].step}" inputmode="decimal" data-num-x="${x.id}" data-num-k="${k}" value="${m[k]??""}"></label>`).join("")}
      <button type="button" class="linkbtn" data-stnote="${x.id}">${m.note?"Note ✓":"Note"}</button></div></div>`;
}
// Stopwatch
const tyT={run:false,t0:0,raf:0,ev:"sixty",who:null,lastHtml:"",undo:null};
function tyTimerWire(){
  const go=$("#tyw-go");if(!go)return;const st=STATIONS.find(s=>s.id===tyStation);
  if(!st.timer.includes(tyT.ev))tyT.ev=st.timer[0];
  const who=$("#tyw-who");if(who&&!tyT.who)tyT.who=who.value;
  go.addEventListener("pointerdown",e=>{e.preventDefault();tyTimerTap();});
  go.addEventListener("keydown",e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();tyTimerTap();}});
}
function tyTimerTap(){
  const clock=$("#tyw-clock"),go=$("#tyw-go");
  if(!tyT.run){tyT.run=true;tyT.t0=performance.now();go.textContent="Stop";go.classList.add("stop");
    const tick=()=>{if(!tyT.run)return;clock.textContent=((performance.now()-tyT.t0)/1000).toFixed(2);tyT.raf=requestAnimationFrame(tick);};tick();return;}
  tyT.run=false;cancelAnimationFrame(tyT.raf);const secs=+((performance.now()-tyT.t0)/1000).toFixed(2);clock.textContent=secs.toFixed(2);
  go.textContent="Start";go.classList.remove("stop");
  const who=$("#tyw-who"),xid=who&&who.value;if(!xid)return;const x=tyPlayers.find(p=>p.id===xid),k=tyT.ev,prev=(myRow(xid)||{})[k];
  const best=prev==null?secs:Math.min(+prev,secs);tyScore(xid,{[k]:best});tyT.undo={xid,k,prev:prev??null};
  tyT.lastHtml=`#${tyNo(x)} ${esc(x.first_name)}: <b>${secs.toFixed(2)} s</b>${best!==secs?` (best ${(+best).toFixed(2)})`:""} <button type="button" class="linkbtn" id="tyw-undo">Undo</button>`;
  const opts=[...who.options],i=opts.findIndex(o=>o.value===xid);if(i>=0&&i<opts.length-1){who.value=opts[i+1].value;}tyT.who=who.value;
  $("#tyw-last").innerHTML=tyT.lastHtml;
  const inp=document.querySelector(`[data-num-x="${xid}"][data-num-k="${k}"]`);if(inp)inp.value=best;
}

// Board: rankings, hidden until the head coach reveals them so coaches don't anchor on each other.
function tyBoardHtml(t){
  const f1=v=>v==null?"—":v.toFixed(1),sq=id=>(teams.find(x=>x.id===id)||{}).name||"";
  const hide=t.blind!==false&&!t.revealed;
  let rows=tyPlayers.map(x=>({x,s:tyStats(x)}));
  if(tyFilter==="open")rows=rows.filter(r=>r.x.status==="registered");
  const coaches=new Set(tyScores.map(s=>s.coach_id)).size;
  if(hide){
    rows.sort((p,q)=>(p.x.tryout_no??1e9)-(q.x.tryout_no??1e9));
    return `<div class="banner"><span>Scores stay hidden until the head coach reveals them, so coaches score what they see instead of matching each other. ${coaches} coach${coaches===1?"":"es"} scoring so far.</span>${isAdmin?`<button type="button" class="primary" data-tyreveal="1">Reveal scores</button>`:""}</div>
      <div class="tbl-wrap"><table class="ty-board"><thead><tr><th>#</th><th class="l">Player</th><th>Gr</th><th class="l">Pos</th><th>Days here</th><th>Coaches scored</th><th>My scores today</th><th></th></tr></thead><tbody>
      ${rows.map(({x,s})=>{const m=myRow(x.id)||{};const mine=TOOLS.filter(([k])=>m[k]!=null).map(([k,l])=>`${l} ${m[k]}`).join(", ");return `<tr><td>${tyNo(x)}</td><td class="l"><b>${esc(tyName(x))}</b></td><td>${esc(x.grade)}</td><td class="l">${esc(x.positions)}</td><td>${(x.checked_in_days||[]).length}</td><td>${new Set(tyScores.filter(z=>z.tryout_player_id===x.id).map(z=>z.coach_id)).size}</td><td class="l">${esc(mine)||"—"}</td><td><button class="linkbtn" data-ty="score" data-id="${x.id}">Score</button></td></tr>`;}).join("")}</tbody></table></div>`;
  }
  rows.sort((p,q)=>(q.s.overall??-1)-(p.s.overall??-1));
  const placed=tyPlayers.filter(x=>x.status==="placed").length,cut=tyPlayers.filter(x=>x.status==="not_placed").length;
  const bias=coachBias().filter(c=>Math.abs(c.bias)>=0.5);
  return `<div class="row" style="justify-content:space-between"><div class="seg" role="group"><button data-tyf="all" aria-pressed="${tyFilter==="all"}">Everyone</button><button data-tyf="open" aria-pressed="${tyFilter==="open"}">Not decided</button></div>${isAdmin&&t.blind!==false?`<button type="button" data-tyreveal="0">Hide scores again</button>`:""}</div>
    <p class="note">${placed} placed, ${cut} not placed, ${tyPlayers.length-placed-cut} to decide. Scores are 1 to 5, averaged across every coach and every day. Times are each player's best.</p>
    ${bias.length?`<div class="banner"><span>${bias.map(c=>`<b>${esc(c.name||"A coach")}</b> scores about ${Math.abs(c.bias).toFixed(1)} ${c.bias>0?"higher":"lower"} than the other coaches on the same players.`).join(" ")} Worth a quick talk about the scoring guide.</span></div>`:""}
    <div class="tbl-wrap"><table class="ty-board"><thead><tr><th>#</th><th class="l">Player</th><th>Gr</th><th class="l">Pos</th>${TOOLS.map(([,l])=>`<th>${l}</th>`).join("")}<th>60 yd</th><th>H-1B</th><th>Velo</th><th>Pop</th><th>Overall</th><th>Days</th><th>Coaches</th><th class="l">Result</th><th></th></tr></thead><tbody>
    ${rows.map(({x,s})=>`<tr><td>${tyNo(x)}</td><td class="l"><b>${esc(tyName(x))}</b>${x.ai_summary?`<div class="note" style="max-width:340px">${esc(x.ai_summary)}</div>`:""}</td><td>${esc(x.grade)}</td><td class="l">${esc(x.positions)}</td>
      ${TOOLS.map(([k])=>`<td>${f1(s[k])}</td>`).join("")}<td>${s.sixty??"—"}</td><td>${s.h2f??"—"}</td><td>${s.velo??"—"}</td><td>${s.pop??"—"}</td><td><b>${f1(s.overall)}</b></td><td>${(x.checked_in_days||[]).length}</td><td>${s.coaches}</td>
      <td class="l">${x.status==="placed"?`<span class="chip ok">${esc(sq(x.placed_team_id))}</span>`:x.status==="not_placed"?`<span class="chip rest">Not placed</span>`:""}</td>
      <td class="l"><button class="linkbtn" data-ty="score" data-id="${x.id}">Score</button> · <button class="linkbtn" data-ty="place" data-id="${x.id}">Place</button> · <button class="linkbtn" data-ty="ai" data-id="${x.id}">AI summary</button>${x.status!=="registered"?` · <button class="linkbtn" data-ty="msg" data-id="${x.id}">Message family</button>`:""}</td></tr>`).join("")||`<tr><td class="l note" colspan="22">No one signed up yet.</td></tr>`}
    </tbody></table></div>`;
}
// How far each coach's scores sit from the other coaches' scores on the same players and skills.
function coachBias(){
  const by={};
  for(const s of tyScores)for(const [k] of TOOLS){if(s[k]==null)continue;
    const others=tyScores.filter(o=>o.tryout_player_id===s.tryout_player_id&&o.coach_id!==s.coach_id&&o[k]!=null).map(o=>o[k]);if(!others.length)continue;
    (by[s.coach_id]||(by[s.coach_id]={name:s.coach_name,d:[]})).d.push(s[k]-avg(others));}
  return Object.values(by).filter(c=>c.d.length>=8).map(c=>({name:c.name,bias:avg(c.d)}));
}
function tySetupHtml(t){
  const g=tyGuide(t);
  return `<label class="row" style="gap:8px;font-weight:600"><input type="checkbox" id="ty-blind" ${t.blind!==false?"checked":""} style="width:18px;height:18px;accent-color:var(--red)"> Hide everyone's scores until an admin reveals them</label>
    <p class="note">Coaches still see their own scores. Reveal on the Board when scoring is done.</p>
    <h3>Scoring guide</h3><p class="note">What a 1, a 3, and a 5 look like for this tryout. Coaches see it at their station.</p>
    <div class="stack" style="gap:10px">${TOOLS.map(([k,l])=>`<div><b>${l}</b><div class="g-edit">${[0,1,2].map(i=>`<label class="f">${[1,3,5][i]}<input type="text" data-guide="${k}" data-gi="${i}" maxlength="120" value="${esc(g[k][i])}"></label>`).join("")}</div></div>`).join("")}</div>
    <div class="row"><button type="button" class="primary" id="ty-setup-save">Save setup</button><button type="button" id="ty-guide-reset">Use the default guide</button><span class="status" id="ty-setup-status"></span></div>`;
}
async function tySaveSetup(reset){
  const t=curTy(),st=$("#ty-setup-status"),rubric={};
  if(!reset)$$("[data-guide]").forEach(i=>{(rubric[i.dataset.guide]||(rubric[i.dataset.guide]=["","",""]))[+i.dataset.gi]=i.value.trim();});
  const upd={blind:$("#ty-blind").checked,rubric:reset?null:rubric};
  const {error}=await sb.from("tryouts").update(upd).eq("id",t.id);
  if(error){setStatus(st,/rubric|blind/.test(error.message||"")?"Setup needs supabase/014_tryout_days.sql run in Supabase first.":errText(error),"err");return;}
  Object.assign(t,upd);renderTyBody();setStatus($("#ty-setup-status"),"Saved.","ok");
}
document.addEventListener("click",async e=>{
  if(!e.target.closest("#ty-board"))return;
  const m=e.target.closest("[data-tymode]");if(m){tyMode=m.dataset.tymode;lsSet("ty-mode",tyMode);renderTyBody();return;}
  const ci=e.target.closest("[data-ci],[data-ci-undo]");if(ci){const x=tyPlayers.find(p=>p.id===(ci.dataset.ci||ci.dataset.ciUndo));if(x)tyCheckIn(x,!!ci.dataset.ciUndo);return;}
  const sb_=e.target.closest("[data-st-x]");if(sb_){const on=sb_.getAttribute("aria-pressed")==="true",v=on?null:+sb_.dataset.v;
    sb_.parentElement.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed","false"));if(!on)sb_.setAttribute("aria-pressed","true");
    tyScore(sb_.dataset.stX,{[sb_.dataset.stK]:v});return;}
  const n=e.target.closest("[data-stnote]");if(n){const x=tyPlayers.find(p=>p.id===n.dataset.stnote),cur=(myRow(x.id)||{}).note||"";
    const s=sheet(`<h2 id="gen-title">Note on #${tyNo(x)} ${esc(tyName(x))}</h2><label class="f">Note<textarea id="stn-body" maxlength="500">${esc(cur)}</textarea></label><div class="row"><button class="primary big" type="button" id="stn-save" style="flex:1">Save note</button><button type="button" data-close>Cancel</button></div>`);
    s.querySelector("#stn-save").onclick=()=>{tyScore(x.id,{note:$("#stn-body").value.trim()});closeSheetGen();renderTyBody();};return;}
  const ev=e.target.closest("[data-twev]");if(ev){tyT.ev=ev.dataset.twev;renderTyBody();return;}
  if(e.target.closest("#tyw-undo")&&tyT.undo){const u=tyT.undo;tyScore(u.xid,{[u.k]:u.prev});tyT.undo=null;tyT.lastHtml="Last time removed.";renderTyBody();return;}
  const rv=e.target.closest("[data-tyreveal]");if(rv){const t=curTy(),revealed=rv.dataset.tyreveal==="1";const {error}=await sb.from("tryouts").update({revealed}).eq("id",t.id);
    if(error){alertBoard(/revealed/.test(error.message||"")?"Needs supabase/014_tryout_days.sql run in Supabase first.":errText(error));return;}t.revealed=revealed;logAct(revealed?"Revealed tryout scores":"Hid tryout scores");renderTyBody();return;}
  if(e.target.closest("#ty-setup-save"))tySaveSetup(false);else if(e.target.closest("#ty-guide-reset"))tySaveSetup(true);
});
document.addEventListener("change",e=>{
  if(!e.target.closest("#ty-board"))return;const el=e.target;
  if(el.id==="ty-station"){tyStation=el.value;lsSet("ty-station",tyStation);tyT.who=null;renderTyBody();}
  else if(el.id==="ty-from"||el.id==="ty-to"){tyRange[el.id==="ty-from"?"from":"to"]=el.value;tyT.who=null;renderTyBody();}
  else if(el.id==="tyw-who")tyT.who=el.value;
  else if(el.dataset.numX){const v=el.value===""?null:+el.value;tyScore(el.dataset.numX,{[el.dataset.numK]:v});}
});
document.addEventListener("input",e=>{if(e.target.id!=="ty-find")return;tySearch=e.target.value;const pos=e.target.selectionStart;renderTyBody();const f=$("#ty-find");if(f){f.focus();try{f.setSelectionRange(pos,pos);}catch(err){}}});
document.addEventListener("submit",async e=>{
  if(e.target.id!=="ty-walk")return;e.preventDefault();const st=$("#tyw-status");
  const row={tryout_id:curTryout,team_id:TEAM.id,first_name:$("#tyw-first").value.trim(),last_name:$("#tyw-last").value.trim(),grade:$("#tyw-grade").value.trim(),positions:$("#tyw-pos").value.trim()};
  if(!row.first_name||!row.last_name){setStatus(st,"Enter a first and last name.","err");return;}
  try{const r=await q(sb.from("tryout_players").insert(row).select());await tyCheckIn(r[0],false);await renderBoard();}catch(err){setStatus(st,errText(err),"err");}
});
$("#ty-add").onclick=async()=>{
  const st=$("#ty-status"),title=$("#ty-title").value.trim();if(!title){setStatus(st,"Give the tryout a title.","err");return;}
  try{const r=await q(sb.from("tryouts").insert({team_id:TEAM.id,title,date:$("#ty-date").value||null,location:$("#ty-loc").value.trim()}).select());curTryout=r[0].id;$("#ty-title").value="";setStatus(st,"Tryout created. Open sign-ups when families can register.","ok");renderTryouts();}
  catch(err){setStatus(st,/tryouts/.test(err.message||"")?"Tryouts aren't set up yet. Run supabase/010_hs_tools.sql in Supabase.":errText(err),"err");}
};
function scoreSheet(x){
  const mine=myRow(x.id)||{};
  const s=sheet(`<h2 id="gen-title">#${tyNo(x)} ${esc(tyName(x))}</h2><p class="note">${esc([x.grade?`Grade ${x.grade}`:"",x.positions,[x.bats,x.throws].filter(Boolean).join("/")].filter(Boolean).join(" · "))}${x.family_note?`<br>Family note: ${esc(x.family_note)}`:""}<br>Your scores for today.</p>
    <div class="score-grid">${TOOLS.map(([k,l])=>`<span class="f-label">${l}</span><div class="seg" role="group" data-tool="${k}">${[1,2,3,4,5].map(v=>`<button type="button" data-v="${v}" aria-pressed="${mine[k]===v}">${v}</button>`).join("")}</div>`).join("")}</div>
    <div class="row">${Object.entries(TY_NUMS).map(([k,n])=>`<label class="f">${n.l} (${n.u})<input type="number" step="${n.step}" id="sc-${k}" value="${mine[k]??""}" style="width:90px"></label>`).join("")}</div>
    <label class="f">Note<textarea id="sc-note" maxlength="500">${esc(mine.note||"")}</textarea></label>
    <div class="row"><button class="primary big" type="button" id="sc-save" style="flex:1">Save score</button><button type="button" data-close>Cancel</button></div>`);
  s.querySelectorAll("[data-tool]").forEach(g=>g.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const on=b.getAttribute("aria-pressed")==="true";g.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed","false"));if(!on)b.setAttribute("aria-pressed","true");}));
  s.querySelector("#sc-save").onclick=()=>{
    const f={note:$("#sc-note").value.trim()};
    s.querySelectorAll("[data-tool]").forEach(g=>{const b=g.querySelector('[aria-pressed="true"]');f[g.dataset.tool]=b?+b.dataset.v:null;});
    for(const k of Object.keys(TY_NUMS)){const v=$("#sc-"+k).value;f[k]=v===""?null:+v;}
    tyScore(x.id,f);closeSheetGen();renderTyBody();
  };
}
function placeSheet(x){
  const sqs=squads();
  const s=sheet(`<h2 id="gen-title">Place ${esc(tyName(x))}</h2>
    <p class="note">Placing adds ${esc(x.first_name)} to that squad's roster as "${esc(x.first_name)} ${esc(x.last_name.charAt(0))}." You can change the name and jersey number on the roster later.</p>
    <div class="stack" style="gap:8px">${sqs.map(t=>{const hidden=t.roster_reveal_at&&new Date(t.roster_reveal_at)>new Date();return `<button type="button" class="${x.placed_team_id===t.id?"primary":""}" data-sq="${t.id}">${esc(t.name)}</button><span class="note">${hidden?`Roster posts ${esc(fmtWhen(t.roster_reveal_at))}; stays private until then.`:`<span class="flag">This roster is public right now.</span> Set a posting time on its Roster tab first to keep placements private.`}</span>`;}).join("")}
      <button type="button" data-sq="none" class="${x.status==="not_placed"?"primary":""}">Not placed this season</button>
      ${x.status!=="registered"?`<button type="button" data-sq="undo">Undo decision</button>`:""}</div>
    <span class="status" id="pl-status2"></span><div class="row"><button type="button" data-close>Close</button></div>`);
  s.querySelectorAll("[data-sq]").forEach(b=>b.onclick=async()=>{
    const st=$("#pl-status2"),to=b.dataset.sq;
    try{
      if(x.placed_player_id){await sb.from("players").delete().eq("id",x.placed_player_id);}
      if(to==="undo"){await q(sb.from("tryout_players").update({status:"registered",placed_team_id:null,placed_player_id:null}).eq("id",x.id));}
      else if(to==="none"){await q(sb.from("tryout_players").update({status:"not_placed",placed_team_id:null,placed_player_id:null}).eq("id",x.id));}
      else{const pr=await q(sb.from("players").insert({team_id:to,name:`${x.first_name} ${x.last_name.charAt(0)}.`,num:0,active:true}).select());
        await q(sb.from("tryout_players").update({status:"placed",placed_team_id:to,placed_player_id:pr[0].id}).eq("id",x.id));
        if(to===TEAM.id)S.players.push(pr[0]);}
      logAct(`Tryout decision for ${tyName(x)}`);closeSheetGen();renderBoard();
    }catch(err){setStatus(st,/row-level|permission/i.test(err.message||"")?"You need coach or admin access on that squad to place players there.":errText(err),"err");}
  });
}
async function tyAi(x,btn){
  if(!aiEnabled){alertBoard(AI_OFF);return;}
  btn.disabled=true;btn.textContent="Thinking…";
  const s=tyStats(x),sc=tyScores.filter(t=>t.tryout_player_id===x.id).map(t=>({coach:t.coach_name,day:t.day,arm:t.arm,speed:t.speed,fielding:t.fielding,hitting:t.hitting,pitching:t.pitching,makeup:t.makeup,sixty:t.sixty,home_to_first:t.h2f,velo:t.velo,pop:t.pop,note:t.note}));
  const all=tyPlayers.map(y=>({o:tyStats(y).overall})).filter(y=>y.o!=null).map(y=>y.o).sort((a,b)=>b-a);
  try{const out=await ai(`You are helping high school baseball coaches review tryouts. Summarize one player's tryout from the coaches' scores (1 to 5) and notes in 2 short sentences for the coaching staff, and suggest which squad fits based on how the player ranks.
${COACH_RULES}
Return ONLY JSON: {"summary":"","suggested_squad":"one of the squad names, or 'not placed'"}.
SQUADS: ${JSON.stringify(squads().map(t=>t.name))}
PLAYER: ${JSON.stringify({grade:x.grade,positions:x.positions,bats:x.bats,throws:x.throws,averages:{arm:s.arm,speed:s.speed,fielding:s.fielding,hitting:s.hitting,pitching:s.pitching,makeup:s.makeup,overall:s.overall},best_60:s.sixty,best_home_to_first:s.h2f,top_velo:s.velo,best_pop:s.pop,days_attended:(x.checked_in_days||[]).length})}
EACH COACH: ${JSON.stringify(sc)}
OVERALL SCORES OF EVERY PLAYER AT TRYOUTS (highest first): ${JSON.stringify(all.map(v=>+v.toFixed(2)))}`);
    const txt=`${out.summary||""}${out.suggested_squad?` Suggested: ${out.suggested_squad}.`:""}`.trim();
    await q(sb.from("tryout_players").update({ai_summary:txt}).eq("id",x.id));renderBoard();
  }catch(e){btn.disabled=false;btn.textContent="AI summary";alertBoard(e.message);}
}
const alertBoard=t=>{const b=$("#ty-sync")||$("#ty-board .note");if(b){b.textContent=t;b.classList.add("flag");}};
function msgSheet(x){
  const sq=(teams.find(t=>t.id===x.placed_team_id)||{}).name||"",coach=me.name||"Coach",parent=x.parent_name?x.parent_name.split(" ")[0]:"";
  const subj=x.status==="placed"?`${x.first_name} made ${sq}`:`${x.first_name}'s tryout`;
  const body=x.status==="placed"?`Hi${parent?" "+parent:""},

Congratulations! ${x.first_name} made the ${sq} team${S.team.season?` for ${S.team.season}`:""}. We were impressed at tryouts and are excited to have ${x.first_name} with us.

We'll share the practice schedule and next steps soon. The team page has the schedule: ${teamUrl(x.placed_team_id)}

${coach}`:`Hi${parent?" "+parent:""},

Thank you for having ${x.first_name} try out. This was a tough group to choose from, and we weren't able to place ${x.first_name} on a team this season.

That isn't the end of the road. Keep working, and we'd love to see ${x.first_name} at tryouts again. If you'd like to talk about what to work on, I'm happy to set up a time.

${coach}`;
  const s=sheet(`<h2 id="gen-title">Message ${esc(x.parent_name||"the family")}</h2>
    <p class="note">${x.parent_email?`Email: <span style="user-select:all">${esc(x.parent_email)}</span>`:"No email on file."}${x.parent_phone?` · Phone: <span style="user-select:all">${esc(x.parent_phone)}</span>`:""}</p>
    <p class="note">Edit the message, then copy it or open it in your email. ${x.status==="not_placed"?"Send these privately before the rosters post, so no family finds out from the website.":""}</p>
    <div class="ty-msg"><label class="f">Subject<input id="msg-subj" value="${esc(subj)}"></label><label class="f">Message<textarea id="msg-body">${esc(body)}</textarea></label></div>
    <span class="status" id="msg-status"></span>
    <div class="row"><button class="primary" type="button" id="msg-copy">Copy message</button>${x.parent_email?`<a class="btn" id="msg-mail" href="#">Open in email</a>`:""}<button type="button" data-close>Close</button></div>`);
  s.querySelector("#msg-copy").onclick=async()=>{try{await navigator.clipboard.writeText($("#msg-body").value);setStatus($("#msg-status"),"Copied.","ok");}catch(e){$("#msg-body").select();}};
  const m=s.querySelector("#msg-mail");if(m)m.onclick=()=>{m.href=`mailto:${encodeURIComponent(x.parent_email)}?subject=${encodeURIComponent($("#msg-subj").value)}&body=${encodeURIComponent($("#msg-body").value)}`;};
}
document.addEventListener("click",async e=>{
  const f=e.target.closest("[data-tyf]");if(f){tyFilter=f.dataset.tyf;renderBoard();return;}
  const b=e.target.closest("[data-ty]");if(!b)return;const a=b.dataset.ty,id=b.dataset.id;
  try{
    if(a==="board"){curTryout=id;renderTryouts();}
    else if(a==="toggle"){const t=tryouts.find(x=>x.id===id);await q(sb.from("tryouts").update({signups_open:!t.signups_open}).eq("id",id));logAct(`${t.signups_open?"Closed":"Opened"} tryout sign-ups`);renderTryouts();}
    else if(a==="del"){if(b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent="Tap again: deletes sign-ups and scores";return;}await q(sb.from("tryouts").delete().eq("id",id));if(curTryout===id)curTryout=null;renderTryouts();}
    else{const x=tyPlayers.find(p=>p.id===id);if(!x)return;
      if(a==="score")scoreSheet(x);else if(a==="place")placeSheet(x);else if(a==="ai")tyAi(x,b);else if(a==="msg")msgSheet(x);}
  }catch(err){setStatus($("#ty-status"),errText(err),"err");}
});

// ================= RECRUITING PROFILE + SHOWCASES =================
let rcRow=null;
const RC_FIELDS=["full_name","grad_year","positions","bats","throws","height","weight","gpa","school","bio","highlight_url","contact_name","contact_email"];
const newToken=()=>{const a=new Uint8Array(18);crypto.getRandomValues(a);return btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");};
const rcUrl=t=>`${location.origin}/r/${t}`;
async function renderRecruit(pid){
  const p=S.players.find(x=>x.id===pid);
  const [r,m]=await Promise.all([sb.from("recruit_profiles").select("*").eq("player_id",pid),
    sb.from("media").select("id,kind,caption,created_at,path").eq("team_id",TEAM.id).contains("players",[pid]).not("path","is",null).order("created_at",{ascending:false}).limit(50)]);
  if(r.error){$("#rc-state").textContent="";setStatus($("#rc-status"),/recruit/.test(r.error.message)?"Recruiting profiles aren't set up yet. Run supabase/010_hs_tools.sql in Supabase.":errText(r.error),"err");return;}
  if(curPlayer!==pid)return;
  rcRow=r.data[0]||null;const v=rcRow||{full_name:p.name,school:TEAM.school||"",contact_name:me.name||"",contact_email:me.email||"",show_stats:true,show_measurements:true};
  for(const k of RC_FIELDS)$("#rc-"+k).value=v[k]??"";
  $("#rc-show_stats").checked=v.show_stats!==false;$("#rc-show_measurements").checked=v.show_measurements!==false;
  $("#rc-highlight").innerHTML=`<option value="">None</option>`+(m.data||[]).map(x=>`<option value="${x.id}" ${v.highlight_media_id===x.id?"selected":""}>${x.kind==="video"?"Clip":"Photo"} · ${esc(fmtDay(x.created_at.slice(0,10)))}${x.caption?" · "+esc(x.caption):""}</option>`).join("");
  $("#rc-on").checked=!!(rcRow&&rcRow.enabled);
  const live=rcRow&&rcRow.enabled&&rcRow.share_token;$("#rc-link").hidden=!live;
  if(live)$("#rc-open").href=rcUrl(rcRow.share_token);
  $("#rc-state").textContent=live?"Shared by link":"Off";
  $("#rc-email-out").hidden=true;setStatus($("#rc-status"),"");
}
async function saveRecruit(opts={}){
  const st=$("#rc-status"),on=$("#rc-on").checked;
  const row={player_id:curPlayer,team_id:TEAM.id,enabled:on,updated_at:new Date().toISOString(),
    show_stats:$("#rc-show_stats").checked,show_measurements:$("#rc-show_measurements").checked,highlight_media_id:$("#rc-highlight").value||null};
  for(const k of RC_FIELDS){const v=$("#rc-"+k).value.trim();row[k]=k==="grad_year"?(v?+v:null):v;}
  row.share_token=opts.newLink||(on&&!(rcRow&&rcRow.share_token))?newToken():(rcRow&&rcRow.share_token)||null;
  if(row.highlight_url&&!ytId(row.highlight_url)){setStatus(st,"That doesn't look like a YouTube link.","err");return;}
  try{await q(sb.from("recruit_profiles").upsert(row,{onConflict:"player_id"}));setStatus(st,on?"Saved. The link is live.":"Saved. The profile is off; the link doesn't work.","ok");logAct(`Updated recruiting profile`);renderRecruit(curPlayer);}
  catch(e){setStatus(st,errText(e),"err");}
}
$("#rc-save").onclick=()=>saveRecruit();
$("#rc-on").addEventListener("change",()=>saveRecruit());
$("#rc-new").onclick=()=>saveRecruit({newLink:true});
$("#rc-copy").onclick=async()=>{try{await navigator.clipboard.writeText(rcUrl(rcRow.share_token));setStatus($("#rc-status"),"Link copied.","ok");}catch(e){setStatus($("#rc-status"),rcUrl(rcRow.share_token));}};
function recruitFacts(){
  const all=playerLines(curPlayer,true),B=aggBat(all),P=aggPit(all),F=aggFld(all);
  return {name:$("#rc-full_name").value,grad_year:$("#rc-grad_year").value,positions:$("#rc-positions").value,bats:$("#rc-bats").value,throws:$("#rc-throws").value,height:$("#rc-height").value,school:$("#rc-school").value,team:S.team.name,
    batting:pickNums(B,["g","ab","h","d","t","hr","rbi","bb","so","sb","avg","obp","slg"]),pitching:pickNums(P,["g","outs","pc","so","bb","era","whip"]),fielding:pickNums(F,["g","po","a","e","pct"])};
}
async function rcAi(kind,btn){
  const st=$("#rc-status");if(!aiEnabled){setStatus(st,AI_OFF,"err");return;}
  btn.disabled=true;setStatus(st,"Drafting. This usually takes 15–40 seconds.");
  try{
    const [met,wu]=await Promise.all([sb.from("player_metrics").select("metric,unit,value,date").eq("player_id",curPlayer).order("date"),
      sb.from("ai_reports").select("output").eq("player_id",curPlayer).eq("kind","player").eq("status","reviewed").order("created_at",{ascending:false}).limit(1)]);
    const facts={...recruitFacts(),measurements:met.data||[],coach_reviewed_strengths:wu.data&&wu.data[0]?(wu.data[0].output.strengths||[]).map(s=>s.title+": "+s.detail):[]};
    if(kind==="bio"){
      const out=await ai(`Write a short recruiting bio (3 to 4 sentences, third person) for a high school baseball player, for college coaches. Use only the facts below; never invent stats, awards, or measurements, and don't exaggerate. Mention position, the most notable numbers, and one or two strengths. Plain, confident, professional.
Return ONLY JSON: {"bio":""}
FACTS: ${JSON.stringify(facts)}`);
      if(!out.bio)throw new Error("The AI's answer was incomplete. Try again.");
      $("#rc-bio").value=out.bio;setStatus(st,"Draft added to About. Edit it, then Save profile.","ok");
    }else{
      const link=rcRow&&rcRow.enabled&&rcRow.share_token?rcUrl(rcRow.share_token):"";
      const out=await ai(`Write a short first-person introduction email from a high school baseball player to a college baseball coach. Keep it under 170 words, polite and specific, using only the facts below (never invent anything). Use the placeholders [Coach's name] and [College] where needed. Include the profile link if one is given, and upcoming showcases if any. Sign with the player's name, grad year, positions, and school.
Return ONLY JSON: {"subject":"","body":""}
FACTS: ${JSON.stringify({...facts,profile_link:link})}`);
      if(!out.body)throw new Error("The AI's answer was incomplete. Try again.");
      $("#rc-email").value=`Subject: ${out.subject||""}\n\n${out.body}`;$("#rc-email-out").hidden=false;setStatus(st,"Draft below. The player should edit it and send it from their own email.","ok");
    }
  }catch(e){setStatus(st,e.message||errText(e),"err");}
  finally{btn.disabled=false;}
}
$("#rc-ai-bio").onclick=e=>rcAi("bio",e.currentTarget);
$("#rc-ai-email").onclick=e=>rcAi("email",e.currentTarget);
$("#rc-email-copy").onclick=async()=>{try{await navigator.clipboard.writeText($("#rc-email").value);setStatus($("#rc-status"),"Email copied.","ok");}catch(e){$("#rc-email").select();}};
async function renderShowcases(pid){
  const {data,error}=await sb.from("player_events").select("*").eq("player_id",pid).order("date");
  if(error){$("#sc-list").innerHTML="";return;}
  const t=today();
  $("#sc-list").innerHTML=data.length?`<ul>${data.map(e=>`<li${e.date<t?' class="note"':""}><b>${esc(fmtDay(e.date))}${e.date.slice(0,4)!==t.slice(0,4)?" "+e.date.slice(0,4):""}</b>: ${esc(e.title)}${e.location?", "+esc(e.location):""} <button class="linkbtn" data-scdel="${e.id}">Remove</button></li>`).join("")}</ul>`:`<p class="note">None yet.</p>`;
  if(!$("#sc-date").value)$("#sc-date").value=t;
}
$("#sc-add").onclick=async()=>{
  const st=$("#sc-status"),title=$("#sc-title").value.trim(),date=$("#sc-date").value;if(!title||!date){setStatus(st,"Add a date and the event name.","err");return;}
  try{await q(sb.from("player_events").insert({team_id:TEAM.id,player_id:curPlayer,date,title,location:$("#sc-loc").value.trim()}));$("#sc-title").value="";$("#sc-loc").value="";setStatus(st,"Added.","ok");renderShowcases(curPlayer);}
  catch(e){setStatus(st,/player_events/.test(e.message||"")?"Showcases aren't set up yet. Run supabase/010_hs_tools.sql in Supabase.":errText(e),"err");}
};
document.addEventListener("click",async e=>{const b=e.target.closest("[data-scdel]");if(!b)return;try{await q(sb.from("player_events").delete().eq("id",b.dataset.scdel));renderShowcases(curPlayer);}catch(err){}});

// ================= PITCH COUNT LOG =================
function pitchLogRows(){
  const from=$("#pcl-from").value||"0000",to=$("#pcl-to").value||"9999",inc=$("#pcl-out").checked,rows=[];
  for(const p of S.players)for(const r of playerLines(p.id,inc)){
    if(!r.pit||!(+r.pit.pc||+r.pit.outs)||r.date<from||r.date>to)continue;
    const pc=+r.pit.pc||0,need=restDays(pc),d=new Date(r.date+"T12:00");d.setDate(d.getDate()+need+1);
    rows.push({date:r.date,game:r.label+(r.kind==="outside"?" (outside)":""),num:p.num,name:p.name,pc,ip:outsToIp(+r.pit.outs||0),rest:need,avail:d.toISOString().slice(0,10)});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
}
function renderPitchLog(){
  if(!$("#pcl-from").value){const ds=S.games.map(g=>g.date).sort();$("#pcl-from").value=ds[0]||today();$("#pcl-to").value=today()>(ds.at(-1)||"")?today():ds.at(-1);}
  const rows=pitchLogRows();
  $("#pcl-table").innerHTML=`<thead><tr><th class="l" style="cursor:default">Date</th><th class="l" style="cursor:default">Game</th><th style="cursor:default">#</th><th class="l" style="cursor:default">Pitcher</th><th style="cursor:default">Pitches</th><th style="cursor:default">IP</th><th style="cursor:default">Rest days</th><th style="cursor:default">Can pitch again</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="l">${esc(fmtDay(r.date))}</td><td class="l">${esc(r.game)}</td><td>${r.num}</td><td class="l">${esc(r.name)}</td><td>${r.pc}</td><td>${r.ip}</td><td>${r.rest}</td><td>${esc(fmtDay(r.avail))}</td></tr>`).join("")||`<tr><td class="l note" colspan="8">No pitching outings in these dates.</td></tr>`}</tbody>`;
}
["#pcl-from","#pcl-to","#pcl-out"].forEach(id=>$(id).addEventListener("change",renderPitchLog));
$("#pl-log-box").addEventListener("toggle",()=>{if($("#pl-log-box").open)renderPitchLog();});
$("#pcl-csv").onclick=()=>{
  const rows=pitchLogRows(),q_=v=>`"${String(v).replace(/"/g,'""')}"`;
  const csv=["Date,Game,Jersey,Pitcher,Pitches,Innings,Rest days,Can pitch again",...rows.map(r=>[r.date,r.game,r.num,r.name,r.pc,r.ip,r.rest,r.avail].map(q_).join(","))].join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`${TEAM.id}-pitch-counts-${$("#pcl-from").value}-to-${$("#pcl-to").value}.csv`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);
};
$("#pcl-print").onclick=()=>{document.body.classList.add("print-pcl");window.print();setTimeout(()=>document.body.classList.remove("print-pcl"),500);};

// ================= CALL-UPS =================
let cuPool=[];
async function loadCallups(){
  const others=teams.filter(t=>t.id!==TEAM.id&&TEAM.school&&t.school===TEAM.school);
  if(!canEdit||!others.length){$("#cu-row").hidden=true;return;}
  const {data,error}=await sb.from("players").select("id,name,num,team_id").in("team_id",others.map(t=>t.id)).eq("active",true);
  cuPool=error?[]:data;$("#cu-row").hidden=!cuPool.length;
  $("#cu-pick").innerHTML=others.map(t=>{const ps=cuPool.filter(p=>p.team_id===t.id).sort((a,b)=>a.num-b.num);return ps.length?`<optgroup label="${esc(t.name)}">${ps.map(p=>`<option value="${p.id}">#${p.num} ${esc(p.name)}</option>`).join("")}</optgroup>`:"";}).join("");
}
$("#cu-add").onclick=async()=>{
  const o=cuPool.find(p=>p.id===$("#cu-pick").value);if(!o)return;
  let sh=S.players.find(p=>p.call_up_of===o.id);
  try{
    if(!sh){sh=(await q(sb.from("players").insert({team_id:TEAM.id,name:o.name,num:o.num,active:false,call_up_of:o.id}).select()))[0];S.players.push(sh);}
    if(!curLineup.order.includes(sh.id))curLineup.order.push(sh.id);curLineup.on.add(sh.id);renderLineup();rebuildTables();
    setStatus($("#lu-status"),`${o.name} added as a call-up. Stats from this game count for ${S.team.name}. Press Save lineup to keep it.`,"ok");
  }catch(e){setStatus($("#lu-status"),/call_up_of/.test(e.message||"")?"Call-ups aren't set up yet. Run supabase/010_hs_tools.sql in Supabase.":errText(e),"err");}
};

// ================= CALENDAR SUBSCRIPTION =================
function renderCalBox(){
  const https=`${location.origin}/cal/${TEAM.id}.ics`;
  $("#cal-url").textContent=https;$("#cal-sub").href=https.replace(/^https?:/,"webcal:");
}
$("#cal-copy").onclick=async()=>{try{await navigator.clipboard.writeText($("#cal-url").textContent);setStatus($("#cal-status"),"Copied.","ok");}catch(e){setStatus($("#cal-status"),"Select the link below and copy it.");}};

// ---------- routing ----------
const VIEWS=["schedule","live","stats","roster","photos","scorebook","sheet","admin","signin","account","teams","player","tryouts"];
// Show a fade at the edge of the tab bar when more tabs are off-screen.
function navFade(){const w=$("nav.tabs .wrap");if(!w)return;w.classList.toggle("more-r",w.scrollLeft+w.clientWidth<w.scrollWidth-4);w.classList.toggle("more-l",w.scrollLeft>4);}
$("nav.tabs .wrap").addEventListener("scroll",navFade,{passive:true});addEventListener("resize",navFade);
function route(){
  let v=location.hash.slice(1);
  if(v.startsWith("player-")){curPlayer=v.slice(7);v="player";}
  if(v==="me"){if(myPlayer){curPlayer=myPlayer;v="player";}else v=session?"schedule":"signin";}
  const own=!!(myPlayer&&curPlayer===myPlayer&&!isCoach);
  if(v==="player"&&TEAM&&!isCoach&&!own)v=session?"roster":"signin";
  document.body.classList.toggle("viewing-own",v==="player"&&own);
  if(!VIEWS.includes(v))v="schedule";
  if(!TEAM)v="teams";
  else{
    if(!canEdit&&["scorebook","sheet"].includes(v))v="signin";
    if(v==="roster"&&!role){v="signin";const n=$("#si-state");if(n&&!session)n.textContent="Sign in to see the roster. It's only for families and staff on the team.";}
    if(v==="admin"&&!isAdmin)v=session?"schedule":"signin";
    if(v==="account"&&!session)v="signin";
    if(v==="signin"&&session&&role)v="schedule";
  }
  for(const x of VIEWS)$("#v-"+x).hidden=x!==v;
  const navV=v==="player"?(own?"me":"roster"):v;curView=v;
  $$("nav.tabs a").forEach(a=>a.getAttribute("data-v")===navV?a.setAttribute("aria-current","page"):a.removeAttribute("aria-current"));
  const cur=$("nav.tabs a[aria-current]");if(cur&&cur.scrollIntoView)cur.scrollIntoView({block:"nearest",inline:"nearest"});navFade();
  if(v!=="player"&&TEAM)document.title=`${S.team.name} Baseball`;
  if(v==="player"){renderPlayer(curPlayer);window.scrollTo(0,0);}
  if(!TEAM)return;
  if(v==="admin"){renderAdmin();renderSpondAdmin();renderIcsAdmin();loadRequests();}
  if(v==="photos")renderPhotos();
  if(v==="stats"&&isCoach){loadTeamReview();if($("#pl-log-box").open)renderPitchLog();}
  if(v==="tryouts")renderTryouts();
  if(v==="schedule")renderCalBox();
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
  else if(t.dataset.edit)openGameForm(findItem(t.dataset.edit));
  else if(t.dataset.enter){pendingEnter=t.dataset.enter;if(location.hash==="#scorebook")route();else location.hash="#scorebook";}
  else if(t.dataset.pedit)openPlayerForm(S.players.find(p=>p.id===t.dataset.pedit));
  else if(t.dataset.st){statType=t.dataset.st;$$("[data-st]").forEach(b=>b.setAttribute("aria-pressed",b===t));renderStats();}
  else if(t.dataset.k){const k=t.dataset.k;if(sortKey[statType]===k)sortDir[statType]*=-1;else{sortKey[statType]=k;sortDir[statType]=(statType==="pit"&&["era","whip","h","r","er","bb"].includes(k))?1:-1;}renderStats();}
});
$("#stat-game").addEventListener("change",renderStats);
$("#add-game").onclick=()=>openGameForm(null,"game");
$("#add-event").onclick=()=>openGameForm(null,"event");
$("#gf-kind").addEventListener("change",e=>setFormKind(e.target.value));
$("#gf-cancel").onclick=()=>{$("#game-form").hidden=true};
$("#gf-save").onclick=async()=>{
  const ev=$("#gf-kind").value==="event";
  const d=$("#gf-date").value,o=$("#gf-opp").value.trim();if(!d||!o){setStatus($("#gf-status"),ev?"Add a date and what the event is.":"Add a date and an opponent.","err");return;}
  const g=editingGame?{...findItem(editingGame)}:{id:uuid(),status:"scheduled",us:null,them:null,lineup:null};
  Object.assign(g,{date:d,time:$("#gf-time").value.trim(),opp:o,home:ev?true:$("#gf-home").value==="1",loc:$("#gf-loc").value.trim(),kind:ev?"event":"game"});
  if(!ev&&g.status!=="final")g.status=$("#gf-st").value;
  const row=gameRow(g);if(!ev&&editingGame)row.kind="game";
  if(await run($("#gf-status"),`${editingGame?"Updated":"Added"} ${ev?`event ${o}`:`game ${g.home?"vs":"at"} ${o}`}`,()=>q(sb.from("games").upsert(row)))){
    putItem(g);render();$("#game-form").hidden=true;}
};
let pendingGameDel=false;
$("#gf-delete").onclick=async()=>{
  if(!pendingGameDel){pendingGameDel=true;$("#gf-delete").textContent="Tap again to delete";setTimeout(()=>{pendingGameDel=false;$("#gf-delete").textContent="Delete";},4000);return;}
  pendingGameDel=false;$("#gf-delete").textContent="Delete";
  if(await run($("#gf-status"),"Deleted from the schedule",()=>q(sb.from("games").delete().eq("id",editingGame)))){S.games=S.games.filter(g=>g.id!==editingGame);S.events=S.events.filter(g=>g.id!==editingGame);delete S.lines[editingGame];render();$("#game-form").hidden=true;}
};
$("#open-import").onclick=()=>{$("#import-panel").hidden=!$("#import-panel").hidden;};
let importRows=[];
$("#run-import").onclick=async()=>{
  const txt=$("#import-text").value.trim(),st=$("#import-status");if(!txt){setStatus(st,"Paste the schedule first.","err");return;}
  setStatus(st,"Reading the schedule…");$("#run-import").disabled=true;
  try{
    const out=await ai(`You are reading a baseball team's schedule that a coach copied from somewhere (an email, a spreadsheet, a school website, or the Spond app). Today is ${today()}. The team is ${S.team.name}${TEAM.school?` (${TEAM.school})`:""}.
Extract every game, and every other team event worth putting on a family calendar (tryouts, parent meetings, picture day, banquets, scrimmages that are not official games). Skip routine practices unless there are no games at all.
Return ONLY JSON: {"items":[{"type":"game","date":"YYYY-MM-DD","time":"3:30 PM","opp":"opponent team name","home":true,"loc":"field or school"},{"type":"event","date":"YYYY-MM-DD","time":"","title":"Tryouts","loc":""}]}.
Infer the year from context; if missing, use the next occurrence on or after today. If home/away is unclear, use true. Leave time empty if none is given.

TEXT:
${txt}`);
    importRows=(out&&(out.items||out.games)||[]).filter(g=>/^\d{4}-\d{2}-\d{2}$/.test(g.date)).map(g=>g.type==="event"?{...g,kind:"event",opp:g.title||g.opp||"Team event",home:true}:{...g,kind:"game"});
    const nG=importRows.filter(g=>g.kind==="game").length,nE=importRows.length-nG;
    $("#import-preview").innerHTML=importRows.length?`<div class="tbl-wrap"><table><thead><tr><th class="l">Date</th><th class="l">Time</th><th class="l">What</th><th class="l">Home</th><th class="l">Where</th></tr></thead><tbody>${importRows.map(g=>`<tr><td class="l">${g.date}</td><td class="l">${esc(g.time)}</td><td class="l">${g.kind==="event"?`<span class="pill ev">Event</span>`:""}${esc(g.opp)}</td><td class="l">${g.kind==="event"?"":g.home?"Home":"Away"}</td><td class="l">${esc(g.loc)}</td></tr>`).join("")}</tbody></table></div><div class="row" style="margin-top:10px"><button class="primary" id="import-add" type="button">Add ${[nG?`${nG} game${nG>1?"s":""}`:"",nE?`${nE} event${nE>1?"s":""}`:""].filter(Boolean).join(" and ")}</button></div>`:"";
    setStatus(st,importRows.length?"Check these before adding.":"Nothing found in that text.",importRows.length?"":"err");
  }catch(e){setStatus(st,e.message,"err");}
  finally{$("#run-import").disabled=false;}
};
document.addEventListener("click",async e=>{if(e.target.id!=="import-add")return;
  const all=[...S.games,...S.events];
  const add=importRows.filter(g=>!all.some(x=>x.date===g.date&&x.opp.toLowerCase()===String(g.opp).toLowerCase())).map(g=>({id:uuid(),date:g.date,time:g.time||"",opp:g.opp||"TBD",home:g.home!==false,loc:g.loc||"",status:"scheduled",us:null,them:null,lineup:null,kind:g.kind}));
  if(!add.length){setStatus($("#import-status"),"Everything here is already on the schedule.","ok");return;}
  if(await run($("#import-status"),`Added ${add.length} schedule item${add.length>1?"s":""}`,()=>q(sb.from("games").insert(add.map(g=>({...gameRow(g),kind:g.kind}))))))
    {add.forEach(putItem);render();$("#import-preview").innerHTML="";$("#import-text").value="";}
});
function openPlayerForm(p){
  if(location.hash!=="#roster"){location.hash="#roster";setTimeout(()=>openPlayerForm(p),50);return;}
  editingPlayer=p?p.id:null;$("#player-form").hidden=false;$("#pf-title").textContent=p?`Edit ${p.name}`:"Add player";
  $("#pf-name").value=p?p.name:"";$("#pf-num").value=p?p.num:"";$("#pf-delete").hidden=!p;setPosForm(p);setStatus($("#pf-status"),"");
  $("#player-form").scrollIntoView({behavior:"smooth",block:"center"});setTimeout(()=>$("#pf-name").focus({preventScroll:true}),300);
}
$("#add-player").onclick=()=>openPlayerForm(null);
function adRoleChanged(){const r=$("#ad-role").value,show=["player","parent"].includes(r);$("#ad-player-wrap").hidden=!show;
  $("#ad-player-label").textContent=r==="player"?"Which player":"Their player (optional)";$("#ad-player").innerHTML=playerOpts("",r==="player"?"Pick the player":"Not linked");
  const also=$("#ad-also");if(also)also.hidden=r==="player"||!also.innerHTML;}
$("#ad-role").addEventListener("change",adRoleChanged);
$("#rq-role").addEventListener("change",()=>{$("#rq-player-label").textContent=$("#rq-role").value==="player"?"Your first and last name, as on the roster":"Your player's first and last name";});
$("#pl-edit").onclick=()=>openPlayerForm(S.players.find(p=>p.id===curPlayer));
$("#pf-cancel").onclick=()=>{$("#player-form").hidden=true};
$("#pf-save").onclick=async()=>{const n=$("#pf-name").value.trim(),num=+$("#pf-num").value;if(!n){setStatus($("#pf-status"),"Enter a first name.","err");return;}
  const pri=POS.filter(x=>pfPos[x]==="pri"),bak=POS.filter(x=>pfPos[x]==="bak");
  const p=editingPlayer?{...S.players.find(x=>x.id===editingPlayer),name:n,num,pos_primary:pri,pos_backup:bak}:{id:uuid(),name:n,num,active:true,pos_primary:pri,pos_backup:bak};
  const row={id:p.id,team_id:TEAM.id,name:p.name,num:p.num,active:p.active!==false,pos_primary:pri,pos_backup:bak};
  if(await run($("#pf-status"),`Saved player ${n}`,async()=>{try{return await q(sb.from("players").upsert(row));}
      catch(e){if(!/pos_primary|pos_backup|column/i.test(e.message||""))throw e;delete row.pos_primary;delete row.pos_backup;await q(sb.from("players").upsert(row));
        throw new Error("Saved the name and number. To save positions, run supabase/012_roster_positions.sql in Supabase first.");}})){
    const i=S.players.findIndex(x=>x.id===p.id);if(i>=0)S.players[i]=p;else S.players.push(p);render();$("#player-form").hidden=true;}
};
$("#pf-delete").onclick=async()=>{ // keep stats history: mark inactive instead of deleting
  const p=S.players.find(x=>x.id===editingPlayer);
  if(await run($("#pf-status"),`Removed ${p.name} from the roster`,()=>q(sb.from("players").update({active:false}).eq("id",p.id)))){p.active=false;render();$("#player-form").hidden=true;}
};
$("#ts-save").onclick=async()=>{
  const rest=parseRest($("#ts-prest").value);
  if(!rest||!rest.length){setStatus($("#ts-status"),"Write rest days like 66:4, 51:3 (pitches, then days).","err");return;}
  const v={season:$("#ts-season").value.trim(),league:$("#ts-league").value.trim(),innings:Math.min(9,Math.max(4,+$("#ts-inn").value||6)),pitch_max:Math.min(150,Math.max(20,+$("#ts-pmax").value||85)),pitch_rest:rest,
    school:$("#ts-school").value.trim()||null,announcement:$("#ts-announce").value.trim()||null,name:$("#ts-name").value.trim()||TEAM.name};
  if(await run($("#ts-status"),"Updated team settings",()=>q(sb.from("teams").update(v).eq("id",TEAM.id)))){Object.assign(TEAM,v);Object.assign(S.team,{name:v.name,season:v.season,league:v.league,innings:v.innings,pitchMax:v.pitch_max});const t=teams.find(x=>x.id===TEAM.id);if(t)Object.assign(t,v);render();}
};
$("#ts-prules").addEventListener("change",e=>{const p=PITCH_PRESETS[e.target.value];if(!p)return;$("#ts-pmax").value=p.max;$("#ts-prest").value=fmtRest(p.rest);if(e.target.value!=="ll")$("#ts-inn").value=7;});
$("#eg-game").addEventListener("change",()=>fillEntry());
$("#sh-game").addEventListener("change",()=>{$("#sheet").innerHTML=sheetHTML($("#sh-game").value);});
$("#sheet-print").onclick=()=>window.print();
$("#lineup").addEventListener("change",e=>{const id=e.target.dataset.luOn;if(!id)return;if(e.target.checked)curLineup.on.add(id);else curLineup.on.delete(id);
  const o=curLineup.order.filter(x=>x!==id),lastOn=o.reduce((m,x,i)=>curLineup.on.has(x)?i:m,-1);o.splice(e.target.checked?lastOn+1:o.length,0,id);curLineup.order=o;renderLineup();rebuildTables();$("#lu-"+id).focus();});
$("#lineup").addEventListener("click",e=>{const b=e.target.closest("[data-lu-up],[data-lu-dn]");if(!b)return;const id=b.dataset.luUp||b.dataset.luDn,o=curLineup.order,i=o.indexOf(id),j=b.dataset.luUp?i-1:i+1;if(j<0||j>=o.length)return;[o[i],o[j]]=[o[j],o[i]];renderLineup();rebuildTables();const nb=$(`[data-lu-${b.dataset.luUp?"up":"dn"}="${id}"]`);if(nb)nb.focus();});
$("#lu-spond").onclick=()=>loadRsvp(true);
// Drag to reorder (works with a finger or a mouse): grab the handle and move the row.
(function(){
  const list=$("#lineup");let drag=null;
  list.addEventListener("pointerdown",e=>{const h=e.target.closest("[data-drag]");if(!h)return;e.preventDefault();
    const li=h.closest("li");drag={li,id:h.dataset.drag,pid:e.pointerId};li.classList.add("dragging");document.body.classList.add("no-select");h.setPointerCapture(e.pointerId);});
  list.addEventListener("pointermove",e=>{if(!drag||e.pointerId!==drag.pid)return;
    if(e.clientY<70)scrollBy(0,-12);else if(e.clientY>innerHeight-70)scrollBy(0,12);
    const items=[...list.querySelectorAll("li[data-li]")].filter(x=>x!==drag.li);
    const after=items.find(x=>{const r=x.getBoundingClientRect();return e.clientY<r.top+r.height/2;});
    if(after){if(after!==drag.li.nextSibling)list.insertBefore(drag.li,after);}else if(list.lastElementChild!==drag.li)list.appendChild(drag.li);});
  const end=e=>{if(!drag||e.pointerId!==drag.pid)return;drag.li.classList.remove("dragging");document.body.classList.remove("no-select");
    const order=[...list.querySelectorAll("li[data-li]")].map(x=>x.dataset.li),id=drag.id;drag=null;
    if(order.join()!==curLineup.order.join()){curLineup.order=order;renderLineup();rebuildTables();}
    const r=$(`[data-li="${id}"]`);if(r){r.classList.add("moved");setTimeout(()=>r.classList.remove("moved"),600);}};
  list.addEventListener("pointerup",end);list.addEventListener("pointercancel",end);
})();
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
// Visitors read a small live summary saved on the game (line score, inning, outs), not the plays.
let lvLive=null,lvPoll=null;
async function fetchLive(){const gid=lvGame;const {data,error}=await sb.from("games").select("live").eq("id",gid);if(gid!==lvGame)return;if(!error){lvLive=(data[0]||{}).live||null;$("#lv-note").hidden=true;renderLive();}}
let liveTimer=null;
function pushLive(){clearTimeout(liveTimer);liveTimer=setTimeout(async()=>{const g=S.games.find(x=>x.id===lvGame);if(!g)return;const st=replay(lvEvents,g);
  const live={started:lvEvents.length>0,ended:st.ended,inning:st.inning,top:st.top,outs:st.outs,line:st.line,us:st.us,them:st.them,at:Date.now()};
  try{await sb.from("games").update({live}).eq("id",g.id);g.live=live;}catch(e){}},400);}
function subscribeGame(gid){
  if(!gid){flash("Add a game to the schedule first.");return;}
  if(!canEdit){clearInterval(lvPoll);lvGame=gid;lvLive=null;renderLive();fetchLive();lvPoll=setInterval(()=>{if(location.hash==="#live"&&!document.hidden)fetchLive();},20000);return;}
  if(gid===lvGame&&lvChan)return;
  if(lvChan){sb.removeChannel(lvChan);lvChan=null;}
  lvGame=gid;lvEvents=[];renderLive();fetchPlays();
  lvChan=sb.channel("plays-"+gid).on("postgres_changes",{event:"*",schema:"public",table:"plays",filter:`game_id=eq.${gid}`},()=>{clearTimeout(lvRefetch);lvRefetch=setTimeout(fetchPlays,150);})
    .on("postgres_changes",{event:"DELETE",schema:"public",table:"plays"},()=>{clearTimeout(lvRefetch);lvRefetch=setTimeout(fetchPlays,150);})
    .subscribe();
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&lvGame&&location.hash==="#live")(canEdit?fetchPlays:fetchLive)();});
async function addEv(o){
  if(!canEdit)return;
  const t=Date.now(),id=uuid(),local={id,t,...o};
  lvEvents=[...lvEvents,local];renderLive();
  try{await q(sb.from("plays").insert({id,game_id:lvGame,team_id:TEAM.id,t,ev:o}));pushLive();}
  catch(e){lvEvents=lvEvents.filter(x=>x.id!==id);renderLive();flash("That tap didn't save. "+errText(e)+" Tap it again.");}
}
function flash(t){const n=$("#lv-note");n.hidden=false;n.textContent=t;}
async function undo(){const last=lvEvents[lvEvents.length-1];if(!last)return;
  lvEvents=lvEvents.slice(0,-1);renderLive();
  try{await q(sb.from("plays").delete().eq("id",last.id));pushLive();}catch(e){flash("Couldn't undo. "+errText(e));fetchPlays();}}

function restInfo(pc){const max=S.team.pitchMax||85,d=restDays(pc),top=restTiers()[0][1];return {d,max,cls:pc>=max-10?"w2":d>=top-1&&d>0?"w1":""};}
function renderLive(){
  const g=S.games.find(x=>x.id===lvGame);if(!g){$("#lv-board").innerHTML="";$("#lv-ctrl").innerHTML="";$("#lv-log").innerHTML="";return;}
  const L=lvLive||{};
  const st=canEdit?(lvState=replay(lvEvents,g)):{inning:L.inning||1,top:L.top!==false,outs:L.outs||0,line:L.line||{us:[],them:[]},us:L.us||0,them:L.them||0,ended:!!L.ended,bases:[null,null,null],b:0,s:0,log:[],usBat:(L.top!==false)!==!!g.home};
  const started=canEdit?lvEvents.length>0:!!L.started;
  const n=Math.max(inn(),st.inning),awayUs=!g.home;
  const curHalf=started?(st.ended?1e9:2*(st.inning-1)+(st.top?0:1)):-1;
  const rowFor=(side,name)=>{const isAway=(side==="us")===awayUs;return `<tr><td class="l">${esc(name)}</td>${Array.from({length:n},(_,i)=>{const h=2*i+(isAway?0:1),v=st.line[side][i],isCur=h===curHalf;return `<td class="${isCur?"cur":""}">${v!=null?v:(h<=curHalf?"0":"")}</td>`}).join("")}<td>${st[side]}</td></tr>`;};
  const away=awayUs?["us",S.team.name]:["them",g.opp],home=awayUs?["them",g.opp]:["us",S.team.name],b=st.bases;
  $("#lv-board").innerHTML=`<div class="board"><div class="tbl-wrap" style="border:0"><table><thead><tr><th class="l" style="text-align:left">${started?(st.ended?"Final":"Live"):"Not started"}</th>${Array.from({length:n},(_,i)=>`<th>${i+1}</th>`).join("")}<th>R</th></tr></thead><tbody>${rowFor(...away)}${rowFor(...home)}</tbody></table></div>
   ${st.ended||!started?"":`<div class="sit"><span class="big">${st.top?"Top":"Bottom"} ${st.inning}</span><span>Outs <span class="dots">${[0,1].map(i=>`<i class="${st.outs>i?"on":""}"></i>`).join("")}</span></span>${st.usBat&&canEdit?`<span class="mini-dia" aria-label="Runners on ${["1st","2nd","3rd"].filter((_,i)=>b[i]).join(", ")||"no bases"}"><span class="b1 ${b[0]?"on":""}"></span><span class="b2 ${b[1]?"on":""}"></span><span class="b3 ${b[2]?"on":""}"></span></span><span>${esc(S.team.name)} batting</span>`:st.usBat?`<span>${esc(S.team.name)} batting</span>`:`${canEdit?`<span class="big">${st.b}-${st.s}</span>`:""}<span>${esc(g.opp)} batting</span>`}</div>`}</div>`;
  if(!canEdit){$("#lv-log").innerHTML=`<li class="note">${started?"The score updates every 20 seconds. Play-by-play is shared with the coaching staff.":"Check back at game time. The score updates here live."}</li>`;$("#lv-ctrl").innerHTML="";return;}
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
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(!$("#lv-sheet").hidden)closeSheet();$("#lightbox").hidden=true;$("#tag-sheet").hidden=true;if(!aiBusy)aiSheet.hidden=true;}});
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
// First guess at the defense from the lineup: primaries first, then backups, then whoever is left.
function autoDefense(lu){
  const ps=lu.map(id=>S.players.find(p=>p.id===id)).filter(Boolean),used=new Set(),map={};
  for(const pass of [posP,posB])for(const x of POS){if(map[x])continue;const p=ps.find(p=>!used.has(p.id)&&pass(p).includes(x));if(p){map[x]=p.id;used.add(p.id);}}
  for(const x of POS){if(map[x])continue;const p=ps.find(p=>!used.has(p.id));if(p){map[x]=p.id;used.add(p.id);}}
  return map;
}
function posSheet(){
  const st=lvState,lu=st.lu.length?st.lu:sortedPlayers().map(p=>p.id),cur={...st.pos};if(!cur.P)Object.assign(cur,autoDefense(lu));
  sheetState={type:"pos"};
  const opts=(id,x)=>{const rank=p=>posP(p).includes(x)?0:posB(p).includes(x)?1:2;const ps=sortedPlayers().slice().sort((a,b)=>rank(a)-rank(b));
    return `<option value="">—</option>`+ps.map(p=>`<option value="${p.id}" ${p.id===id?"selected":""}>#${p.num} ${esc(p.name)}${rank(p)===0?" (primary)":rank(p)===1?" (backup)":""}</option>`).join("");};
  openSheet(`<h2 id="lv-sheet-title">Positions</h2><p class="note">Change the pitcher here too. Pitches and outs count for whoever is on the mound.</p>
   <div class="posgrid">${POS.map(p=>`<label class="f">${p} (${POSNUM[p]})<select id="pos-${p}">${opts(cur[p],p)}</select></label>`).join("")}</div>
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
  if(!sb){document.body.innerHTML=`<main class="wrap" style="padding-block:40px"><h2>Almost there</h2><p>${keyRole==="service_role"?"<code>config.js</code> has the secret service_role key, which would let anyone change the database. Replace it with the <b>anon public</b> key and redeploy.":"Add the Supabase project URL and <b>anon public</b> key to <code>public/config.js</code>, then redeploy."}</p></main>`;return;}
  try{teams=await q(sb.from("teams").select("*").order("name"));
    const hs=(CFG.hostSchools||{})[location.hostname];if(hs)teams=teams.filter(t=>t.school===hs);}
  catch(e){document.body.innerHTML=`<main class="wrap" style="padding-block:40px"><h2>Can't reach the team database</h2><p>${esc(errText(e))}</p></main>`;return;}
  const params=new URLSearchParams(location.search),pick=params.has("pick");
  let tid=pick?null:teamIdFromUrl();
  if(tid&&!teams.some(t=>t.id===tid)){tid=null;}
  if(!tid&&!pick&&teams.length===1)tid=teams[0].id;
  // With several teams, the bare address shows the team list instead of guessing.
  TEAM=teams.find(t=>t.id===tid)||null;
  // Put the team's own address in the bar (e.g. /eastlake) without reloading.
  if(TEAM&&!(CFG.hostTeams||{})[location.hostname]&&location.pathname!=="/"+TEAM.id){try{history.replaceState(null,"","/"+encodeURIComponent(TEAM.id)+(location.hash||"#schedule"));}catch(e){}}
  if(!TEAM){
    if(pick)try{history.replaceState(null,"","/");}catch(e){}
    const card=t=>`<a href="${teamLink(t.id)}"><img src="${logoUrl(t)}" alt="" onerror="this.remove()"><b>${esc(t.name)}</b></a>`;
    const groups={};for(const t of teams)(groups[t.school||""]=groups[t.school||""]||[]).push(t);
    $("#teampick").innerHTML=Object.entries(groups).sort(([a],[b])=>(a===""?1:0)-(b===""?1:0)||a.localeCompare(b)).map(([s,ts])=>`<div class="school">${s?`<h3>${esc(s)}</h3>`:Object.keys(groups).length>1?`<h3>Other teams</h3>`:""}<div class="teampick">${ts.map(card).join("")}</div></div>`).join("")||`<p class="note">No teams yet. Run the database setup first.</p>`;
    $("header.band").hidden=true;$("nav.tabs").hidden=true;route();return;
  }
  lsSet("rr-team",TEAM.id);
  $("#school-list").innerHTML=[...new Set(teams.map(t=>t.school).filter(Boolean))].map(s=>`<option value="${esc(s)}">`).join("");
  await loadTeamData();
  // Show the public schedule and stats right away; sign-in state fills in after.
  render();route();
  try{const r=await Promise.race([sb.auth.getSession(),new Promise((_,rej)=>setTimeout(()=>rej(new Error("slow")),5000))]);session=r.data.session;}
  catch(e){session=null;}
  await refreshRole();if(canEdit||myPlayer)await loadTeamData();render();route();loadRequests();updateTryoutNav().catch(()=>{});
  fetch("/api/ai").then(r=>r.ok?r.json():{enabled:false}).then(j=>{aiEnabled=!!j.enabled;aiMulti=!!j.multi_image;renderSchedule();$("#scan-run").disabled=!(aiEnabled&&$("#scan-file").files.length);
    if(!aiEnabled)$("#scan-status").textContent="Photo reading is turned off for this site. Enter numbers in the tables below.";}).catch(()=>{});
  // Supabase can deadlock if its own calls are awaited inside this callback, so defer the work.
  sb.auth.onAuthStateChange((ev,sess)=>{
    if(ev==="INITIAL_SESSION"||ev==="TOKEN_REFRESHED"){session=sess;return;}
    setTimeout(async()=>{session=sess;await refreshRole();await loadTeamData();render();route();loadRequests();updateTryoutNav().catch(()=>{});},0);
  });
}
boot();
})();
