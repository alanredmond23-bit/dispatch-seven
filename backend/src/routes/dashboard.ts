// routes/dashboard.ts — D7 Ops Dashboard
// GET /dashboard — self-contained HTML ops dashboard, no build step required
//
// Shows in real-time (2s poll):
//   - System health: supabase, anthropic, inngest, mem0, voyage with latency
//   - Today's cost and budget utilization bar
//   - Active sessions (last 24h) with per-agent cost breakdown
//   - Recent agent runs: session, agent, model, tokens, cost, status
//   - Task queue depth and concurrency (requires PR #13 queue-stats endpoint)
//
// No external CDN dependencies — pure vanilla JS/CSS, inline everything.
// Served from the backend — no frontend build needed.

import { Hono } from "hono";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/", (c) => {
  const html = buildDashboardHtml();
  return c.html(html);
});

function buildDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>D7 Ops Dashboard</title>
<style>
  :root {
    --bg:       #0d1117;
    --surface:  #161b22;
    --border:   #30363d;
    --text:     #e6edf3;
    --muted:    #8b949e;
    --green:    #3fb950;
    --yellow:   #d29922;
    --red:      #f85149;
    --blue:     #58a6ff;
    --purple:   #bc8cff;
    --orange:   #ffa657;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace;
    font-size: 13px;
    padding: 16px;
    min-height: 100vh;
  }
  h1 { font-size: 18px; font-weight: 600; color: var(--blue); margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 11px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
  }
  .card h2 { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.08em; margin-bottom: 10px; }
  .dep-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .dep-row:last-child { border-bottom: none; }
  .dep-name { color: var(--text); font-weight: 500; }
  .dep-meta { color: var(--muted); font-size: 11px; }
  .badge {
    font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .badge.ok      { background: rgba(63,185,80,.15);  color: var(--green); }
  .badge.degraded{ background: rgba(210,153,34,.15); color: var(--yellow);}
  .badge.down    { background: rgba(248,81,73,.15);  color: var(--red);   }
  .badge.healthy { background: rgba(63,185,80,.15);  color: var(--green); }
  .cost-big { font-size: 28px; font-weight: 700; color: var(--text); }
  .cost-cap { color: var(--muted); font-size: 11px; margin-top: 2px; }
  .progress-bar { width: 100%; height: 6px; background: var(--border); border-radius: 3px; margin: 8px 0; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
  .progress-fill.ok       { background: var(--green); }
  .progress-fill.warn     { background: var(--yellow); }
  .progress-fill.critical { background: var(--red); }
  .stat-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .stat-label { color: var(--muted); }
  .stat-value { color: var(--text); font-weight: 500; }
  .queue-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; }
  .queue-item { text-align: center; padding: 8px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }
  .queue-item .q-num { font-size: 20px; font-weight: 700; }
  .queue-item .q-label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .q-CRITICAL { color: var(--red); }
  .q-HIGH     { color: var(--orange); }
  .q-NORMAL   { color: var(--blue); }
  .q-LOW      { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: var(--muted); font-size: 10px; text-transform: uppercase; padding: 4px 6px; border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 5px 6px; border-bottom: 1px solid rgba(48,54,61,.5); color: var(--text); font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(48,54,61,.3); }
  .status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
  .status-dot.ok,       .status-dot.completed { background: var(--green); }
  .status-dot.running,  .status-dot.in_progress { background: var(--blue); animation: pulse 1.2s infinite; }
  .status-dot.failed,   .status-dot.error { background: var(--red); }
  .status-dot.queued,   .status-dot.pending { background: var(--muted); }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
  .agent-pill {
    display: inline-block; font-size: 10px; font-weight: 600;
    padding: 1px 6px; border-radius: 8px; text-transform: uppercase;
    letter-spacing: .04em;
  }
  .agent-LEGAL      { background: rgba(188,140,255,.15); color: var(--purple); }
  .agent-RESEARCH   { background: rgba(88,166,255,.15);  color: var(--blue); }
  .agent-CODE       { background: rgba(63,185,80,.15);   color: var(--green); }
  .agent-SCHEDULER  { background: rgba(255,166,87,.15);  color: var(--orange); }
  .agent-ORCHESTRATOR { background: rgba(210,153,34,.15); color: var(--yellow); }
  .table-wrap { overflow-x: auto; }
  .refresh-ts { color: var(--muted); font-size: 10px; text-align: right; margin-top: 4px; }
  .error-msg { color: var(--red); font-size: 11px; padding: 4px; }
  .section-title {
    font-size: 11px; text-transform: uppercase; color: var(--muted);
    letter-spacing: .08em; margin: 16px 0 8px; font-weight: 600;
  }
</style>
</head>
<body>

<h1>D7 Ops Dashboard</h1>
<p class="subtitle">Dispatch Seven · <span id="refresh-ts">loading…</span></p>

<div class="grid">

  <!-- Health card -->
  <div class="card">
    <h2>System Health</h2>
    <div id="health-status" style="margin-bottom:8px">—</div>
    <div id="health-deps"></div>
  </div>

  <!-- Cost card -->
  <div class="card">
    <h2>Cost · Today</h2>
    <div class="cost-big" id="daily-cost">$0.0000</div>
    <div class="cost-cap" id="budget-cap">of $— budget</div>
    <div class="progress-bar"><div class="progress-fill ok" id="budget-bar" style="width:0%"></div></div>
    <div class="stat-row"><span class="stat-label">Session total</span><span class="stat-value" id="session-cost">—</span></div>
    <div class="stat-row"><span class="stat-label">Budget used</span><span class="stat-value" id="budget-pct">—</span></div>
  </div>

  <!-- Queue card -->
  <div class="card">
    <h2>Task Queue</h2>
    <div class="queue-grid" id="queue-grid">
      <div class="queue-item"><div class="q-num q-CRITICAL" id="q-CRITICAL">—</div><div class="q-label">Critical</div></div>
      <div class="queue-item"><div class="q-num q-HIGH"     id="q-HIGH">—</div><div class="q-label">High</div></div>
      <div class="queue-item"><div class="q-num q-NORMAL"   id="q-NORMAL">—</div><div class="q-label">Normal</div></div>
      <div class="queue-item"><div class="q-num q-LOW"      id="q-LOW">—</div><div class="q-label">Low</div></div>
    </div>
    <div class="stat-row" style="margin-top:8px">
      <span class="stat-label">Active tasks</span>
      <span class="stat-value" id="q-active">—</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Capacity</span>
      <span class="stat-value" id="q-capacity">—</span>
    </div>
  </div>

</div>

<p class="section-title">Active Sessions (last 24h)</p>
<div class="card">
  <div class="table-wrap"><table>
    <thead><tr>
      <th>Session ID</th><th>Last Agent</th><th>Cost</th><th>Runs</th><th>Last Activity</th>
    </tr></thead>
    <tbody id="sessions-body"><tr><td colspan="5" class="error-msg">Loading…</td></tr></tbody>
  </table></div>
</div>

<p class="section-title">Recent Agent Runs (last 20)</p>
<div class="card">
  <div class="table-wrap"><table>
    <thead><tr>
      <th>Agent</th><th>Model</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th><th>Status</th><th>Started</th>
    </tr></thead>
    <tbody id="runs-body"><tr><td colspan="7" class="error-msg">Loading…</td></tr></tbody>
  </table></div>
</div>

<script>
const BASE = '';  // same origin

function fmt$(n) { return '$' + (n ?? 0).toFixed(4); }
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function shortId(id) { return id ? id.slice(0,12)+'…' : '—'; }
function agentPill(a) { return '<span class="agent-pill agent-'+(a||'')+'">'+( a||'?')+'</span>'; }
function statusDot(s) { return '<span class="status-dot '+(s||'')+'"></span>'+(s||'?'); }

async function fetchJson(path) {
  try {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch(e) {
    return null;
  }
}

async function refreshHealth() {
  const d = await fetchJson('/health');
  if (!d) {
    document.getElementById('health-status').innerHTML = '<span class="badge down">unreachable</span>';
    return;
  }
  const statusEl = document.getElementById('health-status');
  statusEl.innerHTML = '<span class="badge ' + d.status + '">' + d.status + '</span>' +
    ' <span style="color:var(--muted);font-size:11px">uptime ' + Math.floor(d.uptime_ms/1000) + 's</span>';

  const depsEl = document.getElementById('health-deps');
  depsEl.innerHTML = '';
  for (const [name, dep] of Object.entries(d.dependencies || {})) {
    const latency = dep.latency_ms != null ? dep.latency_ms + 'ms' : '';
    depsEl.innerHTML += '<div class="dep-row">' +
      '<span class="dep-name">' + name + '</span>' +
      '<span>' +
        (latency ? '<span class="dep-meta">' + latency + '&nbsp;</span>' : '') +
        '<span class="badge ' + dep.status + '">' + dep.status + '</span>' +
      '</span>' +
      '</div>';
  }
}

async function refreshCost() {
  const sessionId = new URLSearchParams(location.search).get('session_id') || '';
  const url = sessionId ? '/api/v1/runs/summary?session_id=' + sessionId : '/api/v1/runs/summary';
  const d = await fetchJson(url);
  if (!d) return;
  document.getElementById('daily-cost').textContent = fmt$(d.daily_total_usd);
  document.getElementById('budget-cap').textContent = 'of ' + fmt$(d.budget_cap_usd) + ' budget';
  document.getElementById('session-cost').textContent = fmt$(d.session_total_usd);
  document.getElementById('budget-pct').textContent = (d.budget_pct ?? 0).toFixed(1) + '%';
  const bar = document.getElementById('budget-bar');
  bar.style.width = Math.min(100, d.budget_pct ?? 0) + '%';
  bar.className = 'progress-fill ' + (d.budget_pct > 90 ? 'critical' : d.budget_pct > 70 ? 'warn' : 'ok');
}

async function refreshQueue() {
  const d = await fetchJson('/api/v1/jobs/queue-stats');
  if (!d) return;
  const q = d.queued?.byPriority || {};
  ['CRITICAL','HIGH','NORMAL','LOW'].forEach(p => {
    const el = document.getElementById('q-' + p);
    if (el) el.textContent = q[p] ?? '0';
  });
  document.getElementById('q-active').textContent = d.active?.total ?? '—';
  document.getElementById('q-capacity').textContent = d.capacity ?? '—';
}

async function refreshSessions() {
  const d = await fetchJson('/api/v1/sessions');
  const tbody = document.getElementById('sessions-body');
  if (!d?.sessions?.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:12px">No active sessions</td></tr>';
    return;
  }
  tbody.innerHTML = d.sessions.map(s => '<tr>' +
    '<td style="font-family:monospace">' + shortId(s.session_id) + '</td>' +
    '<td>' + agentPill(s.last_agent) + '</td>' +
    '<td>' + fmt$(s.total_cost_usd) + '</td>' +
    '<td>' + (s.run_count ?? 0) + '</td>' +
    '<td>' + fmtTime(s.last_activity) + '</td>' +
    '</tr>'
  ).join('');
}

async function refreshRuns() {
  const d = await fetchJson('/api/v1/runs?limit=20');
  const tbody = document.getElementById('runs-body');
  if (!d?.runs?.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);padding:12px">No recent runs</td></tr>';
    return;
  }
  tbody.innerHTML = d.runs.slice(0, 20).map(r => '<tr>' +
    '<td>' + agentPill(r.agent) + '</td>' +
    '<td style="font-size:11px;color:var(--muted)">' + (r.model || '—').replace('claude-', '') + '</td>' +
    '<td>' + (r.tokens_in ?? 0).toLocaleString() + '</td>' +
    '<td>' + (r.tokens_out ?? 0).toLocaleString() + '</td>' +
    '<td>' + fmt$(r.cost_usd) + '</td>' +
    '<td>' + statusDot(r.status) + '</td>' +
    '<td>' + fmtTime(r.started_at) + '</td>' +
    '</tr>'
  ).join('');
}

async function refreshAll() {
  await Promise.allSettled([
    refreshHealth(),
    refreshCost(),
    refreshQueue(),
    refreshSessions(),
    refreshRuns(),
  ]);
  document.getElementById('refresh-ts').textContent =
    'last refresh ' + new Date().toLocaleTimeString();
}

refreshAll();
setInterval(refreshAll, 2000);
</script>
</body>
</html>`;
}
