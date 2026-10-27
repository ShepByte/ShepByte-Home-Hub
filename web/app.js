'use strict';

const $ = id => document.getElementById(id);
const $$ = selector => Array.from(document.querySelectorAll(selector));
let credential = '';
let devices = [];
let selected = null;
let tab = 'overview';
let refreshing = false;
let activeNode = 'home';

const make = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};

async function api(path, body) {
  const response = await fetch('/api/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + credential,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}

async function action(fn) {
  try {
    $('error').textContent = '';
    await fn();
  } catch (error) {
    $('error').textContent = error.message;
  }
}

function button(text, fn, cls = '') {
  const b = make('button', text, cls);
  b.type = 'button';
  b.onclick = () => action(async () => {
    b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  });
  return b;
}

function setClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  $('date').textContent = now.toLocaleDateString([], {weekday:'short', day:'2-digit', month:'short', year:'numeric'});
}

function nodeTitle(name, subtitle) {
  const frag = document.createDocumentFragment();
  const row = make('div', undefined, 'panel-card');
  row.append(make('strong', name), make('p', subtitle || ''));
  frag.append(row);
  return frag;
}

function renderHomeSummary() {
  const approved = devices.filter(d => d.status === 'approved');
  const online = approved.filter(d => d.online).length;
  const offline = approved.length - online;
  $('devices-summary').textContent = approved.length ? `${online} Online${offline ? ' · ' + offline + ' Offline' : ''}` : 'No devices';
  $('home-device-count').textContent = `${online}/${approved.length}`;
  const problems = approved.filter(d => !d.online).length;
  $('errors-summary').textContent = `${problems} Active`;
  $('home-error-count').textContent = String(problems);
  $('network-state').textContent = 'Online';
}

function showPanel(title, kicker = 'HOME HUB') {
  $('panel-title').textContent = title;
  $('panel-kicker').textContent = kicker;
  $('panel').hidden = false;
  $('detail').hidden = true;
  return $('panel-content');
}

function clearNodeFocus() {
  $$('.node').forEach(n => n.classList.remove('active'));
}

function focusNode(name) {
  activeNode = name;
  selected = null;
  clearNodeFocus();
  const node = document.querySelector(`.node[data-node="${name}"]`);
  if (node) node.classList.add('active');

  if (name === 'home') {
    $('panel').hidden = true;
    $('detail').hidden = true;
    return;
  }

  if (name === 'devices') return renderDevicesPanel();
  if (name === 'system') return renderSystemPanel();
  if (name === 'data') return renderDataPanel();
  if (name === 'updates') return renderUpdatesPanel();
  if (name === 'errors') return renderErrorsPanel();
  if (name === 'settings') return renderSettingsPanel();
}

function renderDevicesPanel() {
  const content = showPanel('Devices');
  content.replaceChildren();

  const pending = devices.filter(d => d.status === 'pending');
  if (pending.length) {
    const section = make('div', undefined, 'panel-card');
    section.append(make('strong', 'Pairing requests'));
    for (const d of pending) {
      const row = make('div', undefined, 'panel-row');
      const info = make('span');
      info.append(make('b', d.name), make('small', ' · ' + d.device_id));
      const actions = make('span');
      actions.append(
        button('Approve', async () => { await api(`admin/devices/${d.device_id}/approve`, {}); await refresh(); }, 'primary'),
        button('Reject', async () => { await api(`admin/devices/${d.device_id}/reject`, {}); await refresh(); })
      );
      row.append(info, actions);
      section.append(row);
    }
    content.append(section);
  }

  const approved = devices.filter(d => d.status === 'approved');
  if (!approved.length) {
    content.append(nodeTitle('No paired devices', 'Create a pairing invitation to connect a ShepByte device.'));
    return;
  }

  for (const d of approved) {
    const row = button('', async () => {
      selected = d.device_id;
      tab = 'overview';
      await renderDetail();
    }, 'device-open');
    const status = make('span');
    status.append(make('i', undefined, 'status-dot ' + (d.online ? 'online' : 'offline')));
    status.append(document.createTextNode(d.online ? 'Online' : 'Offline'));
    row.append(make('strong', d.name), make('span', d.software_version || ''), status);
    content.append(row);
  }
}

function renderSystemPanel() {
  const content = showPanel('System');
  content.replaceChildren();
  const approved = devices.filter(d => d.status === 'approved');
  const online = approved.filter(d => d.online).length;
  content.append(nodeTitle('Home Hub', 'Local monitoring platform'));
  for (const [label, value] of [
    ['Hub status', 'Healthy'],
    ['Paired devices', String(approved.length)],
    ['Devices online', `${online}/${approved.length}`],
    ['API', 'Running'],
    ['Database', 'Available']
  ]) {
    const row = make('div', undefined, 'panel-row');
    row.append(make('span', label), make('strong', value));
    content.append(row);
  }
}

function renderDataPanel() {
  const content = showPanel('Data');
  content.replaceChildren();
  content.append(nodeTitle('History', 'Live readings remain transient. Meaningful events are stored.'));
  const approved = devices.filter(d => d.status === 'approved');
  const row = make('div', undefined, 'panel-row');
  row.append(make('span', 'Devices with history'), make('strong', String(approved.length)));
  content.append(row);
  const hint = make('p', 'Open a device and choose History to view its stored events.');
  hint.className = 'muted';
  content.append(hint);
}

function renderUpdatesPanel() {
  const content = showPanel('Updates');
  content.replaceChildren();
  content.append(button('Update Home Hub', async () => {
    await api('admin/update', {});
    watchUpdate();
  }, 'primary'));
  const progress = make('p', 'Updates this hub from the official main branch. Devices continue independently.');
  progress.id = 'update-progress';
  progress.setAttribute('role', 'status');
  content.append(progress);
  api('admin/update').then(s => { progress.textContent = s.message; }).catch(e => { progress.textContent = e.message; });
  content.append(nodeTitle('Update centre', 'Version awareness is available; remote deployment remains intentionally conservative.'));
  for (const d of devices.filter(d => d.status === 'approved')) {
    const row = make('div', undefined, 'panel-row');
    row.append(make('span', d.name), make('strong', d.software_version || 'Unknown'));
    content.append(row);
  }
}

function renderErrorsPanel() {
  const content = showPanel('Errors');
  content.replaceChildren();
  const offline = devices.filter(d => d.status === 'approved' && !d.online);
  content.append(nodeTitle(offline.length ? `${offline.length} active issue${offline.length === 1 ? '' : 's'}` : 'No active issues', offline.length ? 'Current connection state' : 'All approved devices are responding.'));
  for (const d of offline) {
    const row = make('div', undefined, 'panel-row');
    row.append(make('span', d.name), make('strong', 'Offline'));
    content.append(row);
  }
}

function renderSettingsPanel() {
  const content = showPanel('Settings');
  content.replaceChildren();
  content.append(nodeTitle('Dashboard preferences', 'V0.2 · swipe or drag to explore; pinch or use + / − to zoom.'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = [
    ['Theme', 'Dark'],
    ['Motion', reduced ? 'Reduced by system preference' : 'Full'],
    ['Node labels', 'Minimal'],
    ['Environment', 'Ambient; umbrella toggles rain'],
    ['Weather source', 'Decorative, not live weather']
  ];
  rows.forEach(([label,value]) => {
    const row = make('div', undefined, 'panel-row');
    row.append(make('span', label), make('strong', value));
    content.append(row);
  });
}

async function refresh() {
  if (refreshing || !credential) return;
  refreshing = true;
  try {
    devices = (await api('admin/devices')).devices;
    renderHomeSummary();

    if (activeNode === 'devices' && !selected) renderDevicesPanel();
    if (activeNode === 'errors') renderErrorsPanel();
    if (selected) await renderDetail(false);
  } catch (error) {
    $('network-state').textContent = 'Hub unavailable';
    if (selected && !$('detail').hidden) {
      $('content').replaceChildren(make('p', 'Hub unavailable. Live readings cleared; device operation is independent.'));
    }
    throw error;
  } finally {
    refreshing = false;
  }
}

function metricCard(name, value) {
  const m = make('div', undefined, 'metric');
  m.append(make('small', name), make('strong', value));
  return m;
}

async function renderDetail(forceShow = true) {
  const d = devices.find(item => item.device_id === selected);
  if (!d) {
    $('detail').hidden = true;
    return;
  }

  if (forceShow) {
    $('panel').hidden = true;
    $('detail').hidden = false;
  }
  $('device-title').textContent = d.name;
  $('device-status').textContent = `${d.online ? '● Online' : '○ Offline'} · ${d.software_version || 'Version unknown'}`;
  $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-current', String(b.dataset.tab === tab)));

  const content = $('content');
  content.replaceChildren();

  if (tab === 'overview') {
    const lead = make('p', `${d.online ? 'Online' : 'Offline / awaiting heartbeat'} · Last received: ${d.last_seen ? new Date(d.last_seen * 1000).toLocaleString() : 'Never this hub session'}`);
    content.append(lead);

    if (d.dashboard_url) {
      const link = make('a', 'Open device dashboard ↗');
      link.href = d.dashboard_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      content.append(link);
    }

    const s = d.snapshot;
    if (!s) {
      content.append(make('p', 'Live readings unavailable. Historical events remain available in History.'));
      return;
    }

    if (s.research) {
      const research = make('div', undefined, 'panel-card');
      research.append(make('strong', 'Research'), make('p', `${s.research.state || 'Unknown'} · Last completed: ${s.research.last_completed_at || 'Unavailable'}`));
      content.append(research);
    }

    if (s.hardware) {
      const h = s.hardware;
      const fmt = (v, suffix) => v === null || v === undefined ? 'Unavailable' : Number(v).toLocaleString(undefined,{maximumFractionDigits:1}) + suffix;
      const metrics = make('div', undefined, 'metrics');
      metrics.append(
        metricCard('CPU usage', fmt(h.cpu_percent, '%')),
        metricCard('CPU temperature', fmt(h.cpu_temp_c, ' °C')),
        metricCard('RAM', [h.ram_used_bytes,h.ram_total_bytes].map(v => fmt(v == null ? null : v / 1024**3, ' GiB')).join(' / ')),
        metricCard('Storage', [h.storage_used_bytes,h.storage_total_bytes].map(v => fmt(v == null ? null : v / 1024**3, ' GiB')).join(' / ')),
        metricCard('Uptime', fmt(h.uptime_seconds == null ? null : h.uptime_seconds / 3600, ' hours'))
      );
      content.append(metrics);
    }

    if (d.share_financial) {
      content.append(make('h3', 'Financial summaries'));
      if (!s.financial) {
        content.append(make('p', 'Waiting for device-side consent and a shared summary.'));
      } else {
        for (const mode of ['live','practice']) {
          const f = s.financial[mode];
          const box = make('div', undefined, 'panel-card');
          box.append(make('strong', mode === 'live' ? 'Live' : 'Practice'));
          box.append(make('p', f ? `${f.currency} · Total ${f.total} · Available ${f.available} · Invested ${f.invested}` : 'Unavailable'));
          content.append(box);
        }
      }
    }
  } else if (tab === 'history') {
    const data = await api(`admin/devices/${d.device_id}/history`);
    if (selected !== d.device_id || tab !== 'history') return;
    const list = make('ul', undefined, 'event-list');
    for (const e of data.events) {
      list.append(make('li', `${e.kind} — ${new Date(e.occurred_at).toLocaleString()}`));
    }
    content.append(make('p', 'Latest 200 stored events, newest first.'), list);
  } else {
    const id = make('div', undefined, 'panel-row');
    id.append(make('span', 'Device ID'), make('strong', d.device_id));
    content.append(id);

    const label = make('label');
    const check = make('input');
    check.type = 'checkbox';
    check.checked = d.share_financial;
    check.disabled = d.status !== 'approved';
    label.append(check, document.createTextNode(' Allow Live and Practice summaries'));
    content.append(label, make('p', 'Disabled by default. The device must also explicitly opt in. No broker credentials or trading controls are accepted.'));

    content.append(button('Save sharing preference', async () => {
      await api(`admin/devices/${d.device_id}/settings`, {share_financial:check.checked});
      await refresh();
    }, 'primary'));

    if (d.status === 'approved') {
      content.append(button('Revoke pairing', async () => {
        if (!confirm('Revoke this device? Re-pairing requires an explicit local reset and new device identity.')) return;
        await api(`admin/devices/${d.device_id}/revoke`, {});
        selected = null;
        await refresh();
        focusNode('devices');
      }));
    }
  }
}

$('connect').onclick = () => action(async () => {
  credential = $('token').value;
  await refresh();
  $('token').value = '';
  $('workspace').hidden = false;
  $('login').hidden = true;
  const info = await api('info');
  $('identity').textContent = 'Hub ' + info.hub_id;
});

$('lock').onclick = () => location.reload();

$('invite').onclick = () => action(async () => {
  const invite = await api('admin/invites', {});
  $('invitation').hidden = false;
  $('invitation').textContent = `Hub ID: ${invite.hub_id}\nInvitation: ${invite.invitation}\nExpires in 10 minutes. Approve the device when its pairing request appears.`;
  focusNode('devices');
});

$('close-panel').onclick = () => {
  const node = document.querySelector(`[data-node="${activeNode}"]`);
  focusNode('home');
  if (node) node.focus({preventScroll:true});
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    focusNode('home');
    document.querySelector('[data-node="home"]').focus({preventScroll:true});
  }
});
$('detail-back').onclick = () => {
  selected = null;
  $('detail').hidden = true;
  focusNode('devices');
};

$$('.node').forEach(node => {
  node.addEventListener('click', () => focusNode(node.dataset.node));
});

$$('.tabs [data-tab]').forEach(b => {
  b.onclick = () => action(async () => {
    tab = b.dataset.tab;
    await renderDetail();
  });
});

setClock();
setInterval(setClock, 1000);
setInterval(() => {
  if (credential && tab !== 'settings') action(refresh);
}, 5000);
/* V0.2 camera. Identical in both entry points; no API or backend dependencies. */
(() => {
  'use strict';
  const viewport = document.querySelector('.world-viewport');
  const world = viewport.querySelector('.world-camera');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const points = {home:[1200,850],devices:[740,440],system:[540,860],data:[820,1280],updates:[1660,440],errors:[1860,860],settings:[1580,1280]};
  let x=1200, y=850, scale=innerWidth<700?.9:1, frame=0, animation=0;
  let gesture=null, suppressClick=false, current='home';
  const pointers=new Map();
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  const size=()=>({w:viewport.clientWidth,h:viewport.clientHeight});
  function paint() {
    frame=0;
    const {w,h}=size();
    if (!w || !h) return;
    x=clamp(x,300,2100); y=clamp(y,240,1460);
    world.style.transform=`translate(${w/2-x*scale}px,${h/2-y*scale}px) scale(${scale})`;
    viewport.querySelector('#zoom-level').textContent=Math.round(scale*100)+'%';
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
  function travel(name,animate=true){
    cancelAnimationFrame(animation);
    const point=points[name]; if(!point)return;
    current=name;
    viewport.querySelectorAll('[data-travel]').forEach(b=>{
      if(b.dataset.travel===name)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');
    });
    const sx=x,sy=y,start=performance.now();
    function step(now){
      const progress=animate&&!reducedMotion.matches?Math.min(1,(now-start)/450):1;
      const ease=1-Math.pow(1-progress,3);
      x=sx+(point[0]-sx)*ease;y=sy+(point[1]-sy)*ease;schedule();
      if(progress<1)animation=requestAnimationFrame(step);
    }
    animation=requestAnimationFrame(step);
  }
  function zoom(next,cx=size().w/2,cy=size().h/2){
    const {w,h}=size(),before=scale;
    scale=clamp(next,.6,1.4);
    x+=(cx-w/2)*(1/before-1/scale);y+=(cy-h/2)*(1/before-1/scale);schedule();
  }
  const isControl=target=>target.closest('.camera-controls,.world-nav');
  const distance=()=>{const [a,b]=[...pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
  viewport.addEventListener('pointerdown',event=>{
    if(isControl(event.target)||event.button>0)return;
    cancelAnimationFrame(animation);
    // Clear a previous drag only when starting a new gesture, not at pointerup
    // (the synthetic click follows pointerup on touch screens).
    if(!pointers.size)suppressClick=false;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1)gesture={x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY};
    else {gesture={distance:distance(),scale};suppressClick=true;}
    viewport.classList.add('dragging');
    // Capture on the original button so a tap still activates it.
    event.target.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>=2){
      const rect=viewport.getBoundingClientRect(),[a,b]=[...pointers.values()];
      if(gesture.distance>0)zoom(gesture.scale*distance()/gesture.distance,(a.x+b.x)/2-rect.left,(a.y+b.y)/2-rect.top);
    }else if(gesture){
      if(Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)>7)suppressClick=true;
      if(suppressClick){x-=(event.clientX-gesture.x)/scale;y-=(event.clientY-gesture.y)/scale;schedule();}
      gesture.x=event.clientX;gesture.y=event.clientY;
    }
  });
  function end(event){
    pointers.delete(event.pointerId);
    if(pointers.size===1){const p=[...pointers.values()][0];gesture={...p,startX:p.x,startY:p.y};}
    else if(!pointers.size){gesture=null;viewport.classList.remove('dragging');}
  }
  viewport.addEventListener('pointerup',end);
  viewport.addEventListener('pointercancel',event=>{suppressClick=true;end(event);});
  viewport.addEventListener('lostpointercapture',end);
  viewport.addEventListener('click',event=>{
    if(isControl(event.target))return;
    if(suppressClick){event.stopImmediatePropagation();event.preventDefault();return;}
    const node=event.target.closest('[data-node]');if(node)travel(node.dataset.node);
  },true);
  viewport.addEventListener('wheel',event=>{
    if(isControl(event.target))return;
    event.preventDefault();cancelAnimationFrame(animation);
    const rect=viewport.getBoundingClientRect();
    if(event.ctrlKey||event.metaKey)zoom(scale*Math.exp(-event.deltaY*.008),event.clientX-rect.left,event.clientY-rect.top);
    else{const unit=event.deltaMode===1?16:event.deltaMode===2?size().h:1;x+=event.deltaX*unit/scale;y+=event.deltaY*unit/scale;schedule();}
  },{passive:false});
  viewport.addEventListener('keydown',event=>{
    if(event.target.closest('button'))return;
    const keys={ArrowLeft:[-70,0],ArrowRight:[70,0],ArrowUp:[0,-70],ArrowDown:[0,70]};
    if(keys[event.key]){event.preventDefault();cancelAnimationFrame(animation);x+=keys[event.key][0]/scale;y+=keys[event.key][1]/scale;schedule();}
    if(event.key==='Home'){event.preventDefault();travel('home');}
    if(event.key==='+'||event.key==='='){event.preventDefault();zoom(scale+.1);}
    if(event.key==='-'){event.preventDefault();zoom(scale-.1);}
  });
  viewport.querySelectorAll('[data-travel]').forEach(b=>b.addEventListener('click',()=>{
    travel(b.dataset.travel);
    // Keyboard users can reach every island without navigating a huge canvas.
    const node=viewport.querySelector(`[data-node="${b.dataset.travel}"]`);
    node.focus({preventScroll:true});
  }));
  viewport.querySelectorAll('[data-camera]').forEach(b=>b.addEventListener('click',()=>{
    const command=b.dataset.camera;
    if(command==='in')zoom(scale+.1);
    if(command==='out')zoom(scale-.1);
    if(command==='home'){scale=innerWidth<700?.9:1;travel('home');}
    if(command==='weather'){
      const enabled=viewport.querySelector('.environment').classList.toggle('rain');
      b.setAttribute('aria-pressed',String(enabled));
    }
  }));
  viewport.querySelectorAll('[data-node]').forEach(node=>node.addEventListener('focus',()=>{
    if(!pointers.size && node.matches(':focus-visible') && current!==node.dataset.node)travel(node.dataset.node);
  }));
  const observer=new ResizeObserver(schedule);observer.observe(viewport);
  function motion(){
    const paused=document.hidden||reducedMotion.matches||!viewport.clientWidth;
    viewport.classList.toggle('scene-paused',paused);
    const svg=viewport.querySelector('.world-branches');
    if(paused)svg.pauseAnimations();else svg.unpauseAnimations();
  }
  document.addEventListener('visibilitychange',motion);reducedMotion.addEventListener('change',motion);
  new ResizeObserver(motion).observe(viewport);
  window.addEventListener('blur',()=>{pointers.clear();gesture=null;viewport.classList.remove('dragging');});
  schedule();motion();
})();

let updateTimer = null;
function watchUpdate() {
  clearTimeout(updateTimer);
  const poll = async () => {
    try {
      const state = await api('admin/update');
      const progress = $('update-progress');
      if (progress) progress.textContent = state.message;
      if (state.status === 'restarting') {
        updateTimer = setTimeout(() => location.reload(), 8000);
      } else if (state.status === 'running') {
        updateTimer = setTimeout(poll, 1500);
      } else if (state.status === 'idle') {
        location.reload();
      }
    } catch (error) {
      const progress = $('update-progress');
      if (progress) progress.textContent = 'Waiting for Home Hub to reconnect…';
      updateTimer = setTimeout(poll, 3000);
    }
  };
  poll();
}
