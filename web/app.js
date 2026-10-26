'use strict';
const $ = id => document.getElementById(id);
let credential = '', devices = [], selected = null, tab = 'overview', refreshing = false;
const make = (tag, text, cls) => {const e = document.createElement(tag); if(text !== undefined) e.textContent = text; if(cls) e.className = cls; return e;};
async function api(path, body) {
  const response = await fetch('/api/v1/'+path, {method: body === undefined ? 'GET':'POST', headers:{'Authorization':'Bearer '+credential,'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body),cache:'no-store'});
  const data = await response.json(); if(!response.ok) throw Error(data.error || 'Request failed'); return data;
}
async function action(fn) {try {$('error').textContent=''; await fn();}catch(e){$('error').textContent=e.message;}}
function button(text, fn) {const b=make('button',text); b.onclick=()=>action(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});return b;}
async function refresh() {
  if(refreshing || !credential)return; refreshing=true;
  try {
    devices=(await api('admin/devices')).devices;
    const list=$('devices');list.replaceChildren();
    if(!devices.length) list.append(make('p','No devices yet. Create an invitation to pair the simulator.'));
    for(const d of devices) {
      const card=make('div',undefined,'card');card.append(make('h3',d.name),make('p',d.status+' · '+(d.online?'Online':'Offline'),d.online?'status':'offline'));
      if(d.status==='pending') {
        card.append(make('p','Verify device ID: '+d.device_id));
        for(const op of ['approve','reject'])card.append(button(op==='approve'?'Approve pairing':'Reject',async()=>{await api(`admin/devices/${d.device_id}/${op}`,{});await refresh();}));
      }
      card.append(button('Open device',async()=>{selected=d.device_id;tab='overview';await render();}));list.append(card);
    }
    await render();
  } catch(e){$('content').replaceChildren(make('p','Hub unavailable. Live readings cleared; device operation is independent.'));throw e;}
  finally{refreshing=false;}
}
async function render() {
  const d=devices.find(d=>d.device_id===selected);$('detail').hidden=!d;if(!d)return;
  $('device-title').textContent=d.name;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.tab===tab)));
  const content=$('content');content.replaceChildren();
  if(tab==='overview') {
    content.append(make('p',`${d.online?'Online':'Offline / awaiting heartbeat'} · Version ${d.software_version} · Last received: ${d.last_seen?new Date(d.last_seen*1000).toLocaleString():'Never this hub session'}`));
    const link=make('a','Open device dashboard ↗');link.href=d.dashboard_url;link.target='_blank';link.rel='noopener noreferrer';content.append(link);
    const s=d.snapshot;
    if(!s){content.append(make('p','Live readings unavailable. Historical events remain in History.'));return;}
    content.append(make('p',`Research: ${s.research.state} · Last completed: ${s.research.last_completed_at || 'Unavailable'} · Sample: ${s.observed_at}`));
    const h=s.hardware, metrics=make('div',undefined,'metrics');
    const fmt=(v,suffix)=>v===null?'Unavailable':v.toLocaleString(undefined,{maximumFractionDigits:1})+suffix;
    for(const [name,value] of [['CPU usage',fmt(h.cpu_percent,'%')],['CPU temperature',fmt(h.cpu_temp_c,' °C')],['RAM used / total',[h.ram_used_bytes,h.ram_total_bytes].map(v=>fmt(v===null?null:v/1024**3,' GiB')).join(' / ')],['Storage used / total',[h.storage_used_bytes,h.storage_total_bytes].map(v=>fmt(v===null?null:v/1024**3,' GiB')).join(' / ')],['Uptime',fmt(h.uptime_seconds===null?null:h.uptime_seconds/3600,' hours')]]) {
      const m=make('div',name,'metric');m.append(make('strong',value));metrics.append(m);
    }content.append(metrics);
    content.append(make('h3','Financial summaries'));
    if(!d.share_financial)content.append(make('p','Sharing disabled.'));
    else if(!s.financial)content.append(make('p','Waiting for device-side consent and a shared summary.'));
    else for(const mode of ['live','practice']) {
      const f=s.financial[mode];const box=make('div',undefined,'card');box.append(make('h3',mode==='live'?'Live':'Practice'));
      box.append(make('p',f?`${f.currency} · Total ${f.total} · Available ${f.available} · Invested ${f.invested}`:'Unavailable'));
      if(f)box.append(make('p',`${f.state} · Observed ${f.observed_at}`));content.append(box);
    }
  }else if(tab==='history') {
    const data=await api(`admin/devices/${d.device_id}/history`);if(selected!==d.device_id || tab!=='history')return;
    const list=make('ul');for(const e of data.events)list.append(make('li',`${e.kind} — ${new Date(e.occurred_at).toLocaleString()} (received ${new Date(e.received_at).toLocaleString()})`));
    content.append(make('p','Latest 200 stored events, newest first.'),list);
  }else {
    content.append(make('p','Device ID: '+d.device_id));
    const label=make('label'),check=make('input');check.type='checkbox';check.checked=d.share_financial;check.disabled=d.status!=='approved';label.append(check,document.createTextNode('Allow Live and Practice summaries'));
    content.append(label,make('p','Disabled by default. Market Monitor must also explicitly opt in locally. No broker credentials or trading controls are accepted.'));
    content.append(button('Save sharing preference',async()=>{await api(`admin/devices/${d.device_id}/settings`,{share_financial:check.checked});await refresh();}));
    if(d.status==='approved')content.append(button('Revoke pairing',async()=>{if(!confirm('Revoke this device? Re-pairing requires an explicit local reset and new device identity.'))return;await api(`admin/devices/${d.device_id}/revoke`,{});await refresh();}));
  }
}
$('connect').onclick=()=>action(async()=>{credential=$('token').value;await refresh();$('token').value='';$('workspace').hidden=false;$('login').hidden=true;const info=await api('info');$('identity').textContent='Authorised hub identity: '+info.hub_id;});
$('lock').onclick=()=>location.reload();
$('invite').onclick=()=>action(async()=>{const i=await api('admin/invites',{});$('invitation').hidden=false;$('invitation').textContent=`Hub ID: ${i.hub_id}\nInvitation (expires in 10 minutes): ${i.invitation}\nTransfer both to the device privately, then approve its request here.`;});
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>action(async()=>{tab=b.dataset.tab;await render();}));
setInterval(()=>{if(credential && tab!=='settings')action(refresh);},5000);
