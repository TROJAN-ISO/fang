/* FANG renderer. No frameworks; state + render functions. */
const api = window.fang;

const S = {
  view: 'tickets',
  settings: {},
  tickets: [], ticketsSkipped: [], ticketsLoading: false, ticketQuery: '', previewTicket: null,
  repos: [], reposLoading: false, previewRepo: null,
  dev: freshDev(),
};

function freshDev() {
  return {
    ticket: null, repo: null, notes: '',
    page: 1,
    parse: idle(), plan: idle(),
    branch: { name: '', auto: true, base: 'origin/develop', fetch: true, status: 'idle', msg: '', created: null, repoInfo: null },
    impl: { ...idle(), check: null, sessionId: null, answer: '' },
    changes: { status: 'idle', files: [], selected: null, diff: '' },
  };
}
function idle() { return { status: 'idle', text: '', log: [], error: '', jobId: null, cost: null }; }

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = ms => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h} h ago`;
  return new Date(ms).toLocaleDateString();
};
const base = p => p.split(/[\\/]/).filter(Boolean).pop();
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');
const chip = (status, labels = {}) => {
  const map = { idle: ['', 'Waiting'], running: ['run', 'Running'], done: ['ok', 'Done'], error: ['bad', 'Failed'], blocked: ['warn', 'Blocked'], cancelled: ['', 'Cancelled'] };
  const [cls, text] = map[status] || ['', status];
  return `<span class="chip ${cls}">${esc(labels[status] || text)}</span>`;
};

/* Re-render while keeping focus/caret in the field being typed in. */
function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch { /* */ } }
  }
}

function render() {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${S.view}`));
  $('#nav-tickets-sub').textContent = S.tickets.length ? `${S.tickets.length} tickets · Jira` : 'Not synced';
  $('#nav-repos-sub').textContent = S.settings.reposDir ? `${S.repos.length} repos · ${base(S.settings.reposDir)}` : 'No folder';
  $('#nav-dev-sub').textContent = S.dev.ticket ? `${S.dev.ticket.id || S.dev.ticket.title}${S.dev.repo ? ' → ' + S.dev.repo.name : ''}` : 'Nothing selected';
  keepFocus(() => {
    if (S.view === 'tickets') renderTickets();
    if (S.view === 'repos') renderRepos();
    if (S.view === 'dev') renderDev();
  });
}

/* ---------- Tickets ---------- */
// Reads the tickets the last Jira sync saved.
async function loadTickets() {
  S.ticketsLoading = true; render();
  try { const r = await api.scanTickets(); S.tickets = r.tickets; S.ticketsSkipped = r.skipped; }
  catch (e) { alert(`Couldn't read the synced tickets: ${e.message}`); S.tickets = []; S.ticketsSkipped = []; }
  S.ticketsLoading = false; render();
}

// Read-only: pulls your tickets in the configured Jira filter or sprint, then rescans.
async function syncJira() {
  if (S.jiraSyncing) return;
  S.jiraSyncing = true; render();
  try {
    const r = await api.syncJira();
    S.jiraStatus = `${r.count} ticket(s) from "${r.filter}"${r.removed ? `, ${r.removed} no longer in the filter removed` : ''}`;
  } catch (e) { alert(`Jira sync failed: ${e.message}`); }
  S.jiraSyncing = false;
  await loadTickets();
  render();
}

function renderTickets() {
  const v = $('#view-tickets');
  const q = S.ticketQuery.toLowerCase();
  const list = S.tickets.filter(t => !q || `${t.id} ${t.title} ${t.rel}`.toLowerCase().includes(q));
  const p = S.previewTicket && S.tickets.find(t => t.uid === S.previewTicket);
  v.innerHTML = `
    <div class="view-head">
      <div><h1>Tickets</h1>
        ${S.jiraStatus ? `<div class="sub">Jira: ${esc(S.jiraStatus)}</div>` : ''}
        <p>Your tickets in the Jira sprint, read-only. Press Sync from Jira to refresh.</p>
      </div>
      <div class="row">
        <button class="btn primary" data-act="sync-jira" ${S.jiraSyncing ? 'disabled' : ''}>${S.jiraSyncing ? 'Syncing…' : 'Sync from Jira'}</button>
      </div>
    </div>
    ${!S.tickets.length && !S.ticketsLoading ? `<div class="empty"><strong>No tickets yet</strong>Press Sync from Jira to fetch the tickets assigned to you.</div>` : `
    <div class="split">
      <div>
        <input class="search" id="ticket-search" placeholder="Search by ID, title or file" value="${esc(S.ticketQuery)}">
        ${S.ticketsSkipped.length ? `<details class="skipped"><summary>${S.ticketsSkipped.length} file(s) couldn't be read</summary>
          <pre>${S.ticketsSkipped.map(x => `${esc(x.rel)}: ${esc(x.reason)}`).join('\n')}</pre></details>` : ''}
        <div class="list">${list.map(t => `
          <button class="list-item ${t.uid === S.previewTicket ? 'selected' : ''}" data-act="preview-ticket" data-uid="${esc(t.uid)}">
            <span class="title">${t.id ? `<span class="tid">${esc(t.id)}</span>` : ''}${esc(t.title)}</span>
            <span class="meta">${esc(t.format)} · ${esc(t.rel)} · ${ago(t.modified)}</span>
          </button>`).join('') || '<div class="empty">No ticket matches that search.</div>'}
        </div>
      </div>
      <div class="preview">${p ? `
        <div class="row" style="justify-content:space-between">
          <div><h2>${p.id ? `<span class="tid">${esc(p.id)}</span>` : ''}${esc(p.title)}</h2><div class="path">${esc(p.file)}</div>${p.format === 'Word' ? '<div class="sub" style="margin:4px 0 0">Text extracted from the Word file. Images and formatting aren\'t included.</div>' : ''}</div>
          <button class="btn primary" data-act="develop-ticket" data-uid="${esc(p.uid)}">Develop this ticket</button>
        </div>
        <pre>${esc(p.content)}</pre>` : '<div class="empty"><strong>Select a ticket</strong>Its content shows here, ready to send to Development.</div>'}
      </div>
    </div>`}`;
}

/* ---------- Repositories ---------- */
async function pickReposDir() {
  const dir = await api.pickFolder('Choose the folder that holds your repositories');
  if (!dir) return;
  S.settings = await api.setSettings({ reposDir: dir });
  await loadRepos();
}
async function loadRepos() {
  if (!S.settings.reposDir) return;
  S.reposLoading = true; render();
  try { S.repos = await api.scanRepos(S.settings.reposDir); }
  catch (e) { alert(`Couldn't read the repositories folder: ${e.message}`); S.repos = []; }
  S.reposLoading = false; render();
}

function renderRepos() {
  const v = $('#view-repos');
  const dir = S.settings.reposDir;
  const p = S.previewRepo && S.repos.find(r => r.path === S.previewRepo);
  v.innerHTML = `
    <div class="view-head">
      <div><h1>Repositories</h1>
        ${dir ? `<div class="path">${esc(dir)}</div>` : '<p>Pick the folder that contains your local git repositories.</p>'}
      </div>
      <div class="row">
        ${dir ? `<button class="btn" data-act="reload-repos">${S.reposLoading ? 'Fetching…' : 'Fetch again'}</button>` : ''}
        <button class="btn ${dir ? '' : 'primary'}" data-act="pick-repos">${dir ? 'Change folder' : 'Choose folder'}</button>
      </div>
    </div>
    ${!dir ? `<div class="empty"><strong>No repositories folder yet</strong>Choose a folder (for example ~/Sites or C:\\Projects). FANG finds every git repository up to two levels deep.</div>` :
      !S.repos.length && !S.reposLoading ? `<div class="empty"><strong>No git repositories found</strong>None of the folders here contain a .git directory.</div>` : `
    <div class="split">
      <div class="list">${S.repos.map(r => `
        <button class="list-item ${r.path === S.previewRepo ? 'selected' : ''}" data-act="preview-repo" data-path="${esc(r.path)}">
          <span class="title">${esc(r.name)}</span>
          <span class="meta">${r.info ? `${esc(r.info.branch)}${r.info.trackedChanges ? ` · ${r.info.trackedChanges} uncommitted` : ''}${r.info.hasDevelop || r.info.hasOriginDevelop ? '' : ' · no develop'}` : esc(r.error || '')}</span>
        </button>`).join('')}
      </div>
      <div class="preview">${p ? `
        <div class="row" style="justify-content:space-between">
          <div><h2>${esc(p.name)}</h2><div class="path">${esc(p.path)}</div></div>
          <button class="btn primary" data-act="develop-repo" data-path="${esc(p.path)}">Use for development</button>
        </div>
        ${p.info ? `<div class="checks">
          <span class="chip">On ${esc(p.info.branch)}</span>
          ${p.info.trackedChanges ? `<span class="chip warn">${p.info.trackedChanges} uncommitted change(s)</span>` : '<span class="chip ok">Clean</span>'}
          ${p.info.hasOriginDevelop ? '<span class="chip ok">origin/develop</span>' : ''}${p.info.hasDevelop ? '<span class="chip ok">develop</span>' : ''}
          ${!p.info.hasDevelop && !p.info.hasOriginDevelop ? '<span class="chip bad">No develop branch</span>' : ''}
        </div>` : ''}
        <button class="btn ghost" data-act="reveal" data-path="${esc(p.path)}">Show in ${api.platform === 'darwin' ? 'Finder' : 'Explorer'}</button>` :
        '<div class="empty"><strong>Select a repository</strong>See its branch, uncommitted changes and whether develop exists.</div>'}
      </div>
    </div>`}`;
}

/* ---------- Jobs ---------- */
const jobKey = {};       // jobId -> dev key
const pendingEvents = {}; // events that arrive before startJob resolves

async function startJob(key, kind, payload) {
  const st = S.dev[key];
  Object.assign(st, { status: 'running', text: '', log: [], error: '', cost: null });
  render();
  try {
    const id = await api.startJob(kind, payload);
    st.jobId = id; jobKey[id] = key;
    (pendingEvents[id] || []).forEach(onJobEvent);
    delete pendingEvents[id];
  } catch (e) {
    Object.assign(st, { status: 'error', error: e.message });
    render();
  }
}
function cancelJob(key) {
  const st = S.dev[key];
  if (st.jobId && st.status === 'running') api.cancelJob(st.jobId);
}
function onJobEvent(ev) {
  const key = jobKey[ev.id];
  if (!key) { (pendingEvents[ev.id] = pendingEvents[ev.id] || []).push(ev); return; }
  const st = S.dev[key];
  if (st.jobId !== ev.id) return; // stale job
  if (ev.type === 'log') {
    st.log.push(ev.entry);
    if (st.log.length > 400) st.log.shift();
    const el = document.getElementById(`log-${key}`);
    if (el) { el.insertAdjacentHTML('beforeend', `<div class="${ev.entry.type}">${esc(ev.entry.text)}</div>`); el.scrollTop = el.scrollHeight; }
    return;
  }
  if (ev.type === 'done') {
    const r = ev.result;
    st.cost = r.cost;
    if (r.cancelled) { st.status = 'cancelled'; st.error = ''; }
    else if (!r.ok) { st.status = 'error'; st.error = r.error || 'Run failed.'; st.text = r.text || ''; }
    else { st.status = 'done'; st.text = r.text; }
    if (key === 'impl') st.sessionId = r.sessionId || st.sessionId;
    afterJob(key);
    render();
  }
}

async function afterJob(key) {
  const d = S.dev;
  if (key === 'parse') maybePlan();
  if (key === 'impl') {
    if (d.impl.status === 'done' && /RAPHAEL BLOCKED/.test(d.impl.text)) d.impl.status = 'blocked';
    await safetyCheck();
    d.page = 5;
    await loadChanges();
    render();
  }
}

/* ---------- Development flow ---------- */
const PHASES = ['Ticket', 'Repository', 'Branch', 'Implement', 'Changes'];
const freshImpl = () => ({ ...idle(), check: null, sessionId: null, answer: '' });

function selectTicket(uid, goTo = true) {
  const t = S.tickets.find(x => x.uid === uid);
  if (!t) return;
  const d = S.dev;
  cancelJob('parse'); cancelJob('plan'); cancelJob('impl');
  d.ticket = t;
  d.parse = idle(); d.plan = idle(); d.impl = freshImpl();
  if (d.branch.auto || !d.branch.name) d.branch.name = `feature/${t.id ? t.id + '-' : ''}${slug(t.title)}`;
  S.view = 'dev';
  if (goTo) d.page = 1;
  startJob('parse', 'parse', { ticket: t });
}

async function selectRepo(p, goTo = true) {
  const r = S.repos.find(x => x.path === p);
  if (!r) return;
  const d = S.dev;
  cancelJob('plan'); cancelJob('impl');
  d.repo = r;
  d.plan = idle(); d.impl = freshImpl();
  d.branch = { ...d.branch, status: 'idle', msg: '', created: null, repoInfo: null };
  d.changes = { status: 'idle', files: [], selected: null, diff: '' };
  S.view = 'dev';
  if (goTo) d.page = 2;
  render();
  await refreshRepoInfo();
  maybePlan();
}

async function refreshRepoInfo() {
  const d = S.dev;
  if (!d.repo) return;
  try {
    d.branch.repoInfo = await api.repoInfo(d.repo.path);
    if (!d.branch.repoInfo.hasOriginDevelop && d.branch.repoInfo.hasDevelop) d.branch.base = 'develop';
  } catch { /* */ }
  render();
}

// Planning starts on its own once the ticket is read and a repository is chosen.
function maybePlan() {
  const d = S.dev;
  if (d.parse.status === 'done' && d.repo && d.plan.status === 'idle') {
    startJob('plan', 'plan', { ticket: d.ticket, parseText: d.parse.text, notes: d.notes, repo: d.repo.path });
  }
}
function replan() {
  const d = S.dev;
  cancelJob('plan');
  d.plan = idle(); d.impl = freshImpl();
  maybePlan();
  render();
}

// Start over with a clean slate; uncommitted changes stay on disk.
function newTicket() {
  ['parse', 'plan', 'impl'].forEach(cancelJob);
  S.dev = freshDev();
  S.view = 'tickets';
  render();
}

async function createBranch() {
  const d = S.dev;
  d.branch.status = 'running'; d.branch.msg = ''; render();
  try {
    const res = await api.createBranch(d.repo.path, { name: d.branch.name, base: d.branch.base, fetchFirst: d.branch.fetch && d.branch.base === 'origin/develop' });
    d.branch.created = res; d.branch.status = 'done';
    d.branch.msg = `Created ${res.name} from ${res.start} and switched to it.`;
  } catch (e) { d.branch.status = 'error'; d.branch.msg = e.message; }
  await refreshRepoInfo();
  render();
}

async function implement() {
  const d = S.dev;
  let h;
  try { h = await api.repoHead(d.repo.path); } catch (e) { alert(e.message); return; }
  if (h.branch !== d.branch.created.name) {
    alert(`The repository is on "${h.branch}", not "${d.branch.created.name}". Switch back to ${d.branch.created.name}, then press Implement again.`);
    return;
  }
  const ok = confirm(`Raphael will now edit files in ${d.repo.name} on branch ${h.branch}.\n\nNothing will be committed or pushed. You review and commit yourself.\n\nStart implementation?`);
  if (!ok) return;
  d.impl.check = { before: h };
  d.changes = { status: 'idle', files: [], selected: null, diff: '' };
  startJob('impl', 'implement', { ticket: d.ticket, parseText: d.parse.text, planText: d.plan.text, branch: h.branch, notes: d.notes, repo: d.repo.path });
}

function continueImpl() {
  const d = S.dev;
  if (!d.impl.answer.trim()) return;
  if (!d.impl.sessionId) { alert('This run has no session to continue. Press Implement to start again.'); return; }
  const before = d.impl.check && d.impl.check.before;
  const answer = d.impl.answer;
  startJob('impl', 'continue', { repo: d.repo.path, sessionId: d.impl.sessionId, answer });
  d.impl.check = { before };
  d.impl.answer = '';
}

async function safetyCheck() {
  const d = S.dev;
  if (!d.impl.check || !d.impl.check.before) return;
  try { d.impl.check.after = await api.repoHead(d.repo.path); } catch { /* */ }
}

async function loadChanges() {
  const d = S.dev;
  if (!d.repo) return;
  d.changes.status = 'running'; render();
  try {
    d.changes.files = await api.changes(d.repo.path);
    d.changes.status = 'done';
    if (d.changes.selected && !d.changes.files.find(f => f.file === d.changes.selected)) { d.changes.selected = null; d.changes.diff = ''; }
  } catch (e) { d.changes.status = 'error'; d.changes.error = e.message; }
  render();
}
async function showDiff(file) {
  const d = S.dev;
  const f = d.changes.files.find(x => x.file === file);
  d.changes.selected = file;
  d.changes.diff = 'Loading…'; render();
  try { d.changes.diff = await api.fileDiff(d.repo.path, file, f && f.untracked); }
  catch (e) { d.changes.diff = e.message; }
  render();
}

/* ---------- Development rendering ---------- */
function extractBrief(text) {
  const m = (text || '').match(/^[#*\s]*FANG BRIEF[*\s:]*$/m);
  return m ? text.slice(m.index + m[0].length).trim() : '';
}
// The CODEBASE SUMMARY block from jira-to-code's Phase 2, up to the next major section.
function extractCodebase(text) {
  const t = text || '';
  const m = t.match(/^[#*\s]*CODEBASE SUMMARY[*\s]*$/m);
  if (!m) return '';
  const rest = t.slice(m.index + m[0].length);
  const end = rest.search(/^[#*\s]*(AC #\d|COMPLEXITY|IMPLEMENTATION PLAN|RECONCILE|Phase 3)/mi);
  return (end >= 0 ? rest.slice(0, end) : rest).replace(/^[─═\-\s]+\n/, '').trim();
}
function complexity(text) {
  const m = (text || '').match(/Score\s*:\s*\**\s*(XL|S|M|L)\b/);
  return m ? m[1] : null;
}
const logBox = (key, st) => st.log.length || st.status === 'running'
  ? `<div class="log" id="log-${key}">${st.log.map(l => `<div class="${l.type}">${esc(l.text)}</div>`).join('')}</div>` : '';
const err = st => st.status === 'error' ? `<div class="notice bad">${esc(st.error)}</div>` : '';
const cost = st => st.cost != null ? `<span class="chip">$${st.cost.toFixed(2)}</span>` : '';

// Which phases are done, reachable, and busy.
function phaseState() {
  const d = S.dev;
  const done = {
    1: d.parse.status === 'done',
    2: !!d.repo,
    3: d.branch.status === 'done',
    4: ['done', 'blocked'].includes(d.impl.status),
    5: d.changes.status === 'done' && d.impl.status === 'done',
  };
  const reachable = {
    1: true,
    2: true,
    3: !!d.repo,
    4: !!d.ticket && !!d.repo,
    5: d.impl.status !== 'idle' || d.changes.files.length > 0,
  };
  const busy = {
    1: d.parse.status === 'running',
    2: false,
    3: d.branch.status === 'running',
    4: d.plan.status === 'running' || d.impl.status === 'running',
    5: d.changes.status === 'running',
  };
  return { done, reachable, busy };
}

function goTo(n) {
  const { reachable } = phaseState();
  if (n >= 1 && n <= 5 && reachable[n]) { S.dev.page = n; render(); }
}

function stepper() {
  const { done, reachable, busy } = phaseState();
  const page = S.dev.page;
  return `<ol class="stepper">${PHASES.map((name, i) => {
    const n = i + 1;
    const cls = n === page ? 'current' : done[n] ? 'done' : reachable[n] ? 'open' : 'locked';
    return `${i ? '<li class="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 4l8 8-8 8"/></svg></li>' : ''}
      <li class="step">
        <button class="circle ${cls} ${busy[n] ? 'busy' : ''}" data-act="goto" data-n="${n}" ${reachable[n] ? '' : 'disabled'}
          aria-current="${n === page ? 'step' : 'false'}" aria-label="Phase ${n}: ${name}${done[n] ? ', done' : ''}">
          <span class="ph">Phase</span><span class="pn">${done[n] && n !== page ? '✓' : n}</span>
        </button>
        <span class="step-name">${name}</span>
      </li>`;
  }).join('')}</ol>`;
}

function phase1() {
  const d = S.dev;
  return `
    <div class="card-head"><h2>Choose a ticket</h2>${d.ticket ? chip(d.parse.status, { running: 'Reading ticket', done: 'Ticket read' }) : ''}</div>
    <p class="sub">jira-to-code reads the ticket in the background. Planning starts once a repository is chosen.</p>
    <div class="row">
      <label class="field"><span>Ticket</span>
        <select id="dev-ticket" data-act="dev-ticket">
          <option value="">Select a ticket…</option>
          ${S.tickets.map(t => `<option value="${esc(t.uid)}" ${d.ticket && d.ticket.uid === t.uid ? 'selected' : ''}>${esc((t.id ? t.id + ' · ' : '') + t.title)}</option>`).join('')}
        </select>
      </label>
      ${d.parse.status === 'running' ? '<button class="btn ghost" data-act="cancel" data-key="parse">Cancel</button>' : ''}
      ${d.ticket && ['error', 'cancelled', 'done'].includes(d.parse.status) ? '<button class="btn ghost" data-act="rerun-parse">Read again</button>' : ''}
    </div>
    ${logBox('parse', d.parse)}${err(d.parse)}
    ${d.parse.status === 'done' ? `<details open><summary>Ticket parse (Checkpoint 1)</summary><pre>${esc(d.parse.text)}</pre></details>` : ''}
    <label class="field" style="margin-top:12px"><span>Notes and corrections for the planner (optional)</span>
      <textarea id="dev-notes" rows="2" placeholder="e.g. AC 3 means admins only. Use the existing InvoiceService.">${esc(d.notes)}</textarea>
    </label>`;
}

function phase2() {
  const d = S.dev;
  const ri = d.branch.repoInfo;
  return `
    <div class="card-head"><h2>Choose a repository</h2>${d.plan.status === 'running' ? chip('running', { running: 'Planning in background' }) : d.plan.status === 'done' ? '<span class="chip ok">Plan ready</span>' : ''}</div>
    <p class="sub">jira-to-code explores only the parts of this repository the ticket touches.</p>
    <div class="row">
      <label class="field"><span>Repository</span>
        <select id="dev-repo" data-act="dev-repo">
          <option value="">Select a repository…</option>
          ${S.repos.map(r => `<option value="${esc(r.path)}" ${d.repo && d.repo.path === r.path ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
      </label>
    </div>
    ${ri ? `<div class="checks" style="margin-top:12px">
      <span class="chip">On ${esc(ri.branch)}</span>
      ${ri.trackedChanges ? `<span class="chip warn">${ri.trackedChanges} uncommitted change(s)</span>` : '<span class="chip ok">Clean</span>'}
      ${ri.hasOriginDevelop ? '<span class="chip ok">origin/develop</span>' : ''}${ri.hasDevelop ? '<span class="chip ok">develop</span>' : ''}
      ${!ri.hasDevelop && !ri.hasOriginDevelop ? '<span class="chip bad">No develop branch</span>' : ''}
    </div>` : ''}
    ${d.repo && d.parse.status !== 'done' ? '<div class="notice warn">Planning starts when the ticket in phase 1 has been read.</div>' : ''}`;
}

function phase3() {
  const d = S.dev;
  const ri = d.branch.repoInfo;
  const s3 = d.branch.status === 'done';
  return `
    <div class="card-head"><h2>Create a branch from develop</h2>${s3 ? '<span class="chip ok">Branch ready</span>' : ''}</div>
    <p class="sub">FANG creates the branch and switches to it. It never sets an upstream or pushes.</p>
    <div class="row">
      <label class="field"><span>Branch name</span><input id="dev-branch" value="${esc(d.branch.name)}" ${s3 ? 'disabled' : ''}></label>
      <label class="field" style="max-width:220px"><span>Start from</span>
        <select id="dev-base" data-act="branch-base" ${s3 ? 'disabled' : ''}>
          <option value="origin/develop" ${d.branch.base === 'origin/develop' ? 'selected' : ''} ${ri && !ri.hasOriginDevelop ? 'disabled' : ''}>origin/develop</option>
          <option value="develop" ${d.branch.base === 'develop' ? 'selected' : ''} ${ri && !ri.hasDevelop ? 'disabled' : ''}>Local develop</option>
        </select>
      </label>
    </div>
    <div class="row" style="margin-top:10px;justify-content:space-between">
      <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="dev-fetch" data-act="branch-fetch" ${d.branch.fetch ? 'checked' : ''} ${d.branch.base !== 'origin/develop' || s3 ? 'disabled' : ''}> Fetch latest develop first</label>
      ${s3 ? '' : `<button class="btn primary" data-act="create-branch" ${!d.repo || d.branch.status === 'running' ? 'disabled' : ''}>${d.branch.status === 'running' ? 'Creating…' : 'Create branch'}</button>`}
    </div>
    ${ri ? `<p class="sub" style="margin-top:8px">Currently on <b>${esc(ri.branch)}</b>${ri.trackedChanges ? ` · ${ri.trackedChanges} uncommitted change(s): commit or stash them before creating a branch` : ''}</p>` : ''}
    ${d.branch.msg ? `<div class="notice ${d.branch.status === 'error' ? 'bad' : 'ok'}">${esc(d.branch.msg)}</div>` : ''}`;
}

function phase4() {
  const d = S.dev;
  const planReady = d.plan.status === 'done';
  const canImpl = d.parse.status === 'done' && d.repo && d.branch.status === 'done' && planReady && d.impl.status !== 'running';
  const cx = complexity(d.plan.text);
  const brief = extractBrief(d.plan.text);
  const codebase = extractCodebase(d.plan.text);
  const planBody = d.plan.text.replace(/^[#*\s]*FANG BRIEF[\s\S]*$/m, '').trim();
  const missing = [d.parse.status !== 'done' && 'the ticket read (phase 1)', !d.repo && 'a repository (phase 2)', d.branch.status !== 'done' && 'a branch (phase 3)', !planReady && 'the plan'].filter(Boolean);
  return `
    <div class="card-head"><h2>Review the brief and implement</h2>
      <div class="row">${cx ? `<span class="chip ${cx === 'XL' ? 'bad' : cx === 'L' ? 'warn' : ''}">Complexity ${cx}</span>` : ''}${cost(d.plan)}
      ${d.plan.status === 'running' ? chip('running', { running: 'Planning' }) : d.impl.status !== 'idle' ? chip(d.impl.status, { running: 'Raphael implementing', done: 'Implemented', blocked: 'Raphael blocked' }) : planReady ? '<span class="chip ok">Plan ready</span>' : ''}</div>
    </div>
    <p class="sub">Pressing Implement is your plan approval (Checkpoint 3). Raphael then writes the code and tests.</p>
    ${d.plan.status === 'idle' ? `<div class="notice warn">${d.parse.status !== 'done' ? 'Waiting for the ticket to be read.' : 'Choose a repository to start planning.'}</div>` : ''}
    ${logBox('plan', d.plan)}${err(d.plan)}
    ${planReady ? `
      ${cx === 'XL' ? '<div class="notice bad">XL complexity: jira-to-code recommends a team review before implementing.</div>' : ''}
      <div class="brief">
        <div><h3>Plan brief</h3><pre>${esc(brief || 'No FANG BRIEF section returned. Open the full plan below.')}</pre></div>
        <div><h3>Codebase brief</h3><pre>${esc(codebase || 'No CODEBASE SUMMARY section returned. Open the full plan below.')}</pre></div>
      </div>
      <details><summary>Full plan and analysis</summary><pre>${esc(planBody)}</pre></details>
      <div class="row" style="margin-top:8px"><button class="btn ghost" data-act="replan">Plan again with my notes</button></div>` : ''}
    <div class="guardrail">
      <ul>
        <li><b>No auto commit, no auto push.</b> Raphael is blocked from git commit, push, merge, rebase, reset, stash and switching branches.</li>
        <li>Dependency installs are blocked. You review every change with git diff and commit yourself.</li>
      </ul>
      ${d.impl.status === 'running'
        ? '<button class="btn danger big" data-act="cancel" data-key="impl">Stop</button>'
        : `<button class="btn primary big" data-act="implement" ${canImpl ? '' : 'disabled'}>Implement</button>`}
    </div>
    ${!canImpl && d.impl.status !== 'running' && missing.length ? `<p class="sub" style="margin-top:8px">Implement unlocks after ${missing.join(', ')}.</p>` : ''}
    ${logBox('impl', d.impl)}${err(d.impl)}
    ${d.impl.status === 'blocked' ? `
      <div class="notice warn">Raphael stopped and needs your answer.</div>
      <pre>${esc(d.impl.text)}</pre>
      <label class="field" style="margin-top:10px"><span>Your answer</span><textarea id="impl-answer" rows="3" placeholder="e.g. Use option A.">${esc(d.impl.answer)}</textarea></label>
      <div class="row end" style="margin-top:8px"><button class="btn primary" data-act="continue-impl">Send answer and continue</button></div>` : ''}`;
}

function phase5() {
  const d = S.dev;
  const c = d.changes;
  const chk = d.impl.check;
  const checks = chk && chk.after ? `
    <div class="checks">
      ${chk.after.sha === chk.before.sha ? '<span class="chip ok">No commits made</span>' : `<span class="chip bad">HEAD moved: a commit was made (${esc(chk.after.sha.slice(0, 8))})</span>`}
      ${chk.after.branch === chk.before.branch ? `<span class="chip ok">Still on ${esc(chk.after.branch)}</span>` : `<span class="chip bad">Branch changed to ${esc(chk.after.branch)}</span>`}
      ${chk.after.upstream ? `<span class="chip warn">Branch tracks ${esc(chk.after.upstream)}</span>` : '<span class="chip ok">Nothing pushed (no upstream)</span>'}
    </div>` : '';
  const totals = c.files.reduce((a, f) => ({ add: a.add + (f.add || 0), del: a.del + (f.del || 0) }), { add: 0, del: 0 });
  const diffHtml = esc(c.diff).split('\n').map(l => l.startsWith('+') ? `<span class="a">${l}</span>` : l.startsWith('-') ? `<span class="d">${l}</span>` : l.startsWith('@@') || l.startsWith('diff ') ? `<span class="h">${l}</span>` : l).join('\n');
  return `
    <div class="card-head"><h2>File changes</h2>
      <div class="row">${cost(d.impl)}${d.impl.status === 'running' ? chip('running', { running: 'Raphael implementing' }) : ''}${d.repo ? `<button class="btn ghost" data-act="load-changes">${c.status === 'running' ? 'Reading…' : 'Refresh'}</button>` : ''}</div>
    </div>
    <p class="sub">Everything below is uncommitted. Review it, then commit and push yourself.</p>
    ${checks}
    ${d.impl.status === 'done' && d.impl.text ? `<details open><summary>Raphael's implementation summary and PR description</summary><pre>${esc(d.impl.text)}</pre></details>` : ''}
    ${c.status === 'error' ? `<div class="notice bad">${esc(c.error)}</div>` : ''}
    ${c.files.length ? `
      <p class="sub" style="margin-top:12px">${c.files.length} file(s) · <span class="plus">+${totals.add}</span> <span class="minus">−${totals.del}</span></p>
      <div class="changes">
        <div class="list">${c.files.map(f => `
          <button class="file ${c.selected === f.file ? 'selected' : ''}" data-act="diff" data-file="${esc(f.file)}" title="${esc(f.file)}">
            <span class="k">${f.kind[0].toUpperCase()}</span><span class="name">${esc(f.file)}</span>
            <span>${f.add != null ? `<span class="plus">+${f.add}</span>` : ''} ${f.del ? `<span class="minus">−${f.del}</span>` : ''}</span>
          </button>`).join('')}
        </div>
        <pre class="diff">${c.selected ? diffHtml : 'Select a file to see its diff.'}</pre>
      </div>
      <div class="notice ok">Review with <code>git diff</code>, then commit when you're ready. FANG won't do it for you.</div>` :
      c.status === 'done' ? '<div class="empty">No uncommitted changes in this repository.</div>' :
      d.impl.status === 'running' ? '<div class="empty">Raphael is working. Changes appear here when he finishes.</div>' : ''}`;
}

function renderDev() {
  const v = $('#view-dev');
  const d = S.dev;
  if (!S.tickets.length || !S.repos.length) {
    v.innerHTML = `<div class="view-head"><div><h1>Development</h1><p>Plan, branch, implement, review.</p></div></div>
      <div class="empty"><strong>Fetch tickets and repositories first</strong>
      ${!S.tickets.length ? 'Choose a folder in Tickets. ' : ''}${!S.repos.length ? 'Choose a folder in Repositories.' : ''}</div>`;
    return;
  }
  const { done, reachable } = phaseState();
  const n = d.page;
  const body = [phase1, phase2, phase3, phase4, phase5][n - 1]();
  const nextOk = n < 5 && reachable[n + 1] && (done[n] || n === 2 && !!d.repo);
  v.innerHTML = `
    <div class="view-head"><div><h1>Development</h1><p>Plan with jira-to-code, implement with Raphael.</p></div></div>
    ${stepper()}
    <div class="card phase-card">${body}</div>
    <div class="pager">
      <button class="btn" data-act="back" ${n === 1 ? 'disabled' : ''}>Back</button>
      <span class="pager-pos">Phase ${n} of 5 · ${PHASES[n - 1]}</span>
      ${n < 5 ? `<button class="btn primary" data-act="next" ${nextOk ? '' : 'disabled'}>Next: ${PHASES[n]}</button>` : `<button class="btn primary" data-act="new-ticket" ${d.impl.status === 'running' ? 'disabled' : ''}>Develop another ticket</button>`}
    </div>`;
  const log = v.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('.nav-item');
  if (nav) { S.view = nav.dataset.view; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const a = el.dataset.act;
  if (a === 'sync-jira') syncJira();
  else if (a === 'preview-ticket') { S.previewTicket = el.dataset.uid; render(); }
  else if (a === 'develop-ticket') selectTicket(el.dataset.uid);
  else if (a === 'pick-repos') pickReposDir();
  else if (a === 'reload-repos') loadRepos();
  else if (a === 'preview-repo') { S.previewRepo = el.dataset.path; render(); }
  else if (a === 'develop-repo') selectRepo(el.dataset.path);
  else if (a === 'reveal') api.reveal(el.dataset.path);
  else if (a === 'cancel') cancelJob(el.dataset.key);
  else if (a === 'rerun-parse') selectTicket(S.dev.ticket.uid);
  else if (a === 'goto') goTo(Number(el.dataset.n));
  else if (a === 'next') goTo(S.dev.page + 1);
  else if (a === 'back') goTo(S.dev.page - 1);
  else if (a === 'replan') replan();
  else if (a === 'create-branch') createBranch();
  else if (a === 'implement') implement();
  else if (a === 'continue-impl') continueImpl();
  else if (a === 'load-changes') loadChanges();
  else if (a === 'diff') showDiff(el.dataset.file);
  else if (a === 'new-ticket') newTicket();
});

document.addEventListener('change', e => {
  const a = e.target.dataset.act;
  if (a === 'dev-ticket' && e.target.value) selectTicket(e.target.value);
  else if (a === 'dev-repo' && e.target.value) selectRepo(e.target.value);
  else if (a === 'branch-base') { S.dev.branch.base = e.target.value; render(); }
  else if (a === 'branch-fetch') { S.dev.branch.fetch = e.target.checked; }
});

document.addEventListener('input', e => {
  if (e.target.id === 'ticket-search') { S.ticketQuery = e.target.value; render(); }
  else if (e.target.id === 'dev-branch') { S.dev.branch.name = e.target.value; S.dev.branch.auto = false; }
  else if (e.target.id === 'dev-notes') { S.dev.notes = e.target.value; }
  else if (e.target.id === 'impl-answer') { S.dev.impl.answer = e.target.value; }
});

/* ---------- Settings ---------- */
$('#open-settings').addEventListener('click', () => {
  $('#set-claude').value = S.settings.claudePath || '';
  $('#set-extra').value = (S.settings.extraAllow || []).join('\n');
  $('#set-turns').value = S.settings.maxTurns || 150;
  $('#settings-dialog').showModal();
});
$('#settings-dialog').addEventListener('close', async () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  S.settings = await api.setSettings({
    claudePath: $('#set-claude').value.trim(),
    extraAllow: $('#set-extra').value.split('\n').map(s => s.trim()).filter(Boolean),
    maxTurns: Math.max(20, Math.min(500, parseInt($('#set-turns').value, 10) || 150)),
  });
  checkClaude();
});

async function checkClaude() {
  const el = $('#claude-status');
  try {
    const c = await api.checkClaude();
    if (c.path && c.version) { el.textContent = `Claude Code ${c.version.replace(/\s*\(.*\)/, '')}`; el.classList.remove('bad'); }
    else { el.textContent = 'Claude Code not found. Install it or set its path in Settings.'; el.classList.add('bad'); }
  } catch (e) { el.textContent = e.message; el.classList.add('bad'); }
}

/* ---------- Boot ---------- */
api.onJobEvent(onJobEvent);
(async () => {
  S.settings = await api.getSettings();
  render();
  checkClaude();
  await Promise.all([loadTickets(), loadRepos()]);
  render();
})();
