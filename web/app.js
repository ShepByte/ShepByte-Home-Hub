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
  content.append(nodeTitle('Dashboard preferences', 'Minimal V0.1 controls'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rows = [
    ['Theme', 'Dark'],
    ['Motion', reduced ? 'Reduced by system preference' : 'Full'],
    ['Node labels', 'Minimal'],
    ['Environment', 'Subtle']
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

    if (activeNode === 'devices') renderDevicesPanel();
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

$('close-panel').onclick = () => focusNode('home');
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
