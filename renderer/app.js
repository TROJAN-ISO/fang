/* FANG renderer. No frameworks; state + render functions. */
const api = window.fang;

const S = {
  view: 'tickets',
  settings: {},
  tickets: [], ticketsSkipped: [], ticketsLoading: false, ticketQuery: '', previewTicket: null,
  repos: [], reposLoading: false, previewRepo: null,
  dev: freshDev(),
  reviewPRs: [], reviewLoading: false, reviewErr: '',
  rev: freshRev(),
};

function freshRev() {
  return {
    pr: null, repo: null, page: 1, body: null,
    prep: { status: 'idle', msg: '', data: null },
    find: idle(), verify: idle(),
    post: { status: 'idle', msg: '', url: '' },
  };
}

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
  $('#nav-reviews-sub').textContent = S.reviewPRs.length ? `${S.reviewPRs.length} waiting on you` : S.reviewErr ? 'GitHub error' : 'None waiting';
  $('#nav-dev-sub').textContent = S.dev.ticket ? `${S.dev.ticket.id || S.dev.ticket.title}${S.dev.repo ? ' → ' + S.dev.repo.name : ''}` : 'Nothing selected';
  keepFocus(() => {
    if (S.view === 'tickets') renderTickets();
    if (S.view === 'repos') renderRepos();
    if (S.view === 'dev') renderDev();
    if (S.view === 'reviews') renderReviews();
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
const jobKey = {};       // jobId -> job key (dev: parse/plan/impl, reviews: find/verify)
const slot = key => S.dev[key] || S.rev[key];
const pendingEvents = {}; // events that arrive before startJob resolves

async function startJob(key, kind, payload) {
  const st = slot(key);
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
  const st = slot(key);
  if (st.jobId && st.status === 'running') api.cancelJob(st.jobId);
}
function onJobEvent(ev) {
  const key = jobKey[ev.id];
  if (!key) { (pendingEvents[ev.id] = pendingEvents[ev.id] || []).push(ev); return; }
  const st = slot(key);
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
  if (key === 'find') maybeVerify();
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

function stepper(names = PHASES, page = S.dev.page, { done, reachable, busy } = phaseState(), act = 'goto') {
  return `<ol class="stepper">${names.map((name, i) => {
    const n = i + 1;
    const cls = n === page ? 'current' : done[n] ? 'done' : reachable[n] ? 'open' : 'locked';
    return `${i ? '<li class="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 4l8 8-8 8"/></svg></li>' : ''}
      <li class="step">
        <button class="circle ${cls} ${busy[n] ? 'busy' : ''}" data-act="${act}" data-n="${n}" ${reachable[n] ? '' : 'disabled'}
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
  api.companionPhase(n - 1); // companion counts steps from 0
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

/* ---------- Reviews ---------- */
const REV_PHASES = ['Pull request', 'Repository', 'Veronica review', 'Submit'];
const BLOCKING = new Set(['blocker', 'major']);

async function loadReviewPRs(quiet = false) {
  S.reviewLoading = true; render();
  try { S.reviewPRs = await api.reviewRequests(); S.reviewErr = ''; }
  catch (e) { S.reviewErr = e.message; if (!quiet) alert(`Couldn't fetch review requests: ${e.message}`); }
  S.reviewLoading = false; render();
}

function selectPR(key) {
  const pr = S.reviewPRs.find(p => `${p.repo}#${p.number}` === key);
  if (!pr) return;
  cancelJob('find'); cancelJob('verify');
  S.rev = { ...freshRev(), pr, page: 2 };
  const same = S.repos.filter(r => r.info && r.info.origin && r.info.origin.toLowerCase() === pr.repo.toLowerCase());
  const match = same.find(r => r.name.toLowerCase() === pr.repo.split('/')[1].toLowerCase()) || same[0]; // prefer the main clone over extra worktrees
  if (match) selectReviewRepo(match.path);
  else render();
}

// Fetches the PR head into a separate worktree; your checkout is not touched.
async function selectReviewRepo(p) {
  const r = S.rev;
  const repo = S.repos.find(x => x.path === p);
  if (!repo || !r.pr) return;
  cancelJob('find'); cancelJob('verify');
  Object.assign(r, { repo, body: null, prep: { status: 'running', msg: '', data: null }, find: idle(), verify: idle(), post: { status: 'idle', msg: '', url: '' } });
  render();
  try { r.prep = { status: 'done', msg: '', data: await api.prepareReview({ repo: repo.path, slug: r.pr.repo, number: r.pr.number }) }; }
  catch (e) { r.prep = { status: 'error', msg: e.message, data: null }; }
  render();
}

function startReview() {
  const r = S.rev;
  r.verify = idle(); r.body = null; r.post = { status: 'idle', msg: '', url: '' };
  r.page = 3;
  startJob('find', 'review-find', { pr: { ...r.prep.data, slug: r.pr.repo } });
}

// The JSON object after the marker line in a run's reply.
function markedJson(text, marker) {
  const t = text || '';
  const i = t.lastIndexOf(marker);
  if (i < 0) return null;
  const rest = t.slice(i + marker.length);
  try { return JSON.parse(rest.slice(rest.indexOf('{'), rest.lastIndexOf('}') + 1)); } catch { return null; }
}

function foundFindings() {
  const j = markedJson(S.rev.find.text, 'FANG REVIEW JSON');
  if (!j || !Array.isArray(j.findings)) return null;
  return { summary: String(j.summary || ''), findings: j.findings.map((f, i) => ({ ...f, id: i + 1, line: Number(f.line) || null, severity: String(f.severity || 'minor').toLowerCase() })) };
}

// Every finding gets a second, skeptical run before it can be shown or posted.
function maybeVerify() {
  const r = S.rev;
  const f = foundFindings();
  if (r.find.status !== 'done' || !f || !f.findings.length) return;
  startJob('verify', 'review-verify', { pr: { ...r.prep.data, slug: r.pr.repo }, findings: f.findings });
}

// null while running; { error } if a reply couldn't be read; otherwise the verified review.
function reviewResult() {
  const r = S.rev;
  if (r.find.status !== 'done') return null;
  const f = foundFindings();
  if (!f) return { error: 'Veronica didn\'t return a FANG REVIEW JSON block. Run the review again.' };
  if (!f.findings.length) return { summary: f.summary, confirmed: [], rejected: [], approved: true };
  if (r.verify.status !== 'done') return r.verify.status === 'error' ? { error: `Verification failed: ${r.verify.error}` } : null;
  const v = markedJson(r.verify.text, 'FANG VERIFY JSON');
  if (!v || !Array.isArray(v.results)) return { error: 'The verifier didn\'t return a FANG VERIFY JSON block. Nothing unverified is shown. Verify again.' };
  const byId = new Map(v.results.map(x => [Number(x.id), x]));
  const confirmed = [], rejected = [];
  for (const x of f.findings) {
    const res = byId.get(x.id);
    if (res && res.verdict === 'confirmed') confirmed.push({ ...x, line: Number(res.line) || x.line, reason: res.reason });
    else rejected.push({ ...x, reason: res ? res.reason : 'Not checked by the verifier.' });
  }
  return { summary: f.summary, confirmed, rejected, approved: !confirmed.some(x => BLOCKING.has(x.severity)) };
}

// Findings on lines inside the diff become line comments; the rest go in the review body.
function reviewDraft(res) {
  const lines = new Map(S.rev.prep.data.files.map(f => [f.path, new Set(f.lines)]));
  const inline = res.confirmed.filter(x => lines.get(x.path)?.has(x.line));
  const outside = res.confirmed.filter(x => !inline.includes(x));
  const comment = x => `**${x.severity}: ${x.title}**\n\n${x.problem}\n\n**Suggested fix:** ${x.fix}`;
  const defaultBody = [
    res.summary,
    res.approved ? (res.confirmed.length ? 'Approved. A few minor notes are left inline.' : 'Approved. No issues found.') : `Not approved yet: ${res.confirmed.length} issue(s) to fix, see the comments.`,
    ...outside.map(x => `- \`${x.path}${x.line ? ':' + x.line : ''}\` ${comment(x).replace(/\n\n/g, ' ')}`),
    '_Reviewed with FANG (Veronica). Each finding was checked against the code by a second pass._',
  ].filter(Boolean).join('\n\n');
  return {
    event: res.approved ? 'APPROVE' : 'COMMENT',
    body: S.rev.body ?? defaultBody,
    comments: inline.map(x => ({ path: x.path, line: x.line, body: comment(x) })),
    outside,
  };
}

async function postReview() {
  const r = S.rev;
  const d = reviewDraft(reviewResult());
  const what = d.event === 'APPROVE' ? 'an APPROVE review' : 'a comment review (not approved)';
  if (!confirm(`Post ${what} on ${r.pr.repo}#${r.pr.number} with ${d.comments.length} line comment(s)?\n\nThis is public on GitHub and can't be unposted from FANG.`)) return;
  r.post = { status: 'running', msg: '', url: '' }; render();
  try {
    const res = await api.postReview({ slug: r.pr.repo, number: r.pr.number, headSha: r.prep.data.headSha, event: d.event, body: d.body, comments: d.comments });
    r.post = { status: 'done', msg: `Posted (${res.state}).`, url: res.url };
    S.reviewPRs = S.reviewPRs.filter(p => !(p.repo === r.pr.repo && p.number === r.pr.number)); // search lags behind your review
  } catch (e) { r.post = { status: 'error', msg: e.message, url: '' }; }
  render();
}

function revState() {
  const r = S.rev;
  const res = reviewResult();
  const ready = !!res && !res.error;
  return {
    done: { 1: !!r.pr, 2: r.prep.status === 'done', 3: ready, 4: r.post.status === 'done' },
    reachable: { 1: true, 2: !!r.pr, 3: r.prep.status === 'done', 4: ready },
    busy: { 1: S.reviewLoading, 2: r.prep.status === 'running', 3: r.find.status === 'running' || r.verify.status === 'running', 4: r.post.status === 'running' },
  };
}
function revGoTo(n) {
  if (n >= 1 && n <= 4 && revState().reachable[n]) { S.rev.page = n; render(); }
}

const findingCard = (x, note) => `
  <div class="finding ${esc(x.severity)}">
    <div class="row"><span class="chip ${BLOCKING.has(x.severity) ? 'bad' : 'warn'}">${esc(x.severity)}</span><b>${esc(x.title)}</b></div>
    <div class="path">${esc(x.path)}${x.line ? ':' + x.line : ''}</div>
    <p>${esc(x.problem)}</p>
    ${x.fix ? `<p><b>Fix:</b> ${esc(x.fix)}</p>` : ''}
    ${note ? `<p class="sub">${esc(note)}</p>` : ''}
  </div>`;

function rev1() {
  const r = S.rev;
  return `
    <div class="card-head"><h2>Pull requests waiting for your review</h2>
      <button class="btn" data-act="rev-load" ${S.reviewLoading ? 'disabled' : ''}>${S.reviewLoading ? 'Fetching…' : 'Fetch again'}</button></div>
    <p class="sub">Open PRs on GitHub where your review is requested.</p>
    ${S.reviewErr ? `<div class="notice bad">${esc(S.reviewErr)}</div>` : ''}
    ${S.reviewPRs.length ? `<div class="list">${S.reviewPRs.map(p => `
      <button class="list-item ${r.pr && r.pr.repo === p.repo && r.pr.number === p.number ? 'selected' : ''}" data-act="rev-pr" data-key="${esc(`${p.repo}#${p.number}`)}">
        <span class="title"><span class="tid">#${p.number}</span>${esc(p.title)}${p.draft ? ' <span class="chip">Draft</span>' : ''}</span>
        <span class="meta">${esc(p.repo)} · by ${esc(p.author)} · ${ago(p.updated)}</span>
      </button>`).join('')}</div>` : S.reviewLoading ? '' : '<div class="empty"><strong>Nothing waiting</strong>No open pull requests request your review.</div>'}`;
}

function rev2() {
  const r = S.rev;
  const p = r.prep.data;
  const mismatch = r.repo && r.repo.info && r.repo.info.origin && r.repo.info.origin.toLowerCase() !== r.pr.repo.toLowerCase();
  return `
    <div class="card-head"><h2>${esc(r.pr.repo)} #${r.pr.number}</h2>${chip(r.prep.status, { running: 'Fetching PR', done: 'PR checked out', idle: 'Choose a repository' })}</div>
    <p class="sub">${esc(r.pr.title)} · by ${esc(r.pr.author)} · <span class="path">${esc(r.pr.url)}</span></p>
    <div class="row">
      <label class="field"><span>Local repository</span>
        <select id="rev-repo" data-act="rev-repo">
          <option value="">Select a repository…</option>
          ${S.repos.map(x => `<option value="${esc(x.path)}" ${r.repo && r.repo.path === x.path ? 'selected' : ''}>${esc(x.name)}${x.info && x.info.origin ? ` (${esc(x.info.origin)})` : ''}</option>`).join('')}
        </select>
      </label>
    </div>
    ${!r.repo ? `<div class="notice warn">No repository in your Repositories folder has origin ${esc(r.pr.repo)}. Clone it there, press Fetch again in Repositories, or pick one by hand.</div>` : ''}
    ${mismatch ? `<div class="notice warn">This repository's origin is ${esc(r.repo.info.origin)}, not ${esc(r.pr.repo)}. Fetching the PR will likely fail.</div>` : ''}
    ${r.prep.status === 'error' ? `<div class="notice bad">${esc(r.prep.msg)}</div>` : ''}
    ${p ? `<div class="checks" style="margin-top:12px">
      <span class="chip">${esc(p.headRef)} → ${esc(p.base)}</span>
      <span class="chip">${p.files.length} file(s)</span>
      <span class="chip">${esc(p.headSha.slice(0, 8))}</span>
      ${p.localHead !== p.headSha ? '<span class="chip warn">Fetched head differs from GitHub. Pick the repository again to refetch.</span>' : ''}
    </div>
    <p class="sub" style="margin-top:8px">Checked out read-only at <span class="path">${esc(p.worktree)}</span>. Your own branch and changes are not touched.</p>` : ''}`;
}

function rev3() {
  const r = S.rev;
  const res = reviewResult();
  const running = r.find.status === 'running' || r.verify.status === 'running';
  return `
    <div class="card-head"><h2>Veronica review</h2>
      <div class="row">${cost(r.find)}${cost(r.verify)}
      ${r.find.status === 'running' ? chip('running', { running: 'Veronica reviewing' }) : r.verify.status === 'running' ? chip('running', { running: 'Verifying findings' }) : res && !res.error ? `<span class="chip ${res.approved ? 'ok' : 'bad'}">${res.approved ? 'Approved' : 'Not approved'}</span>` : ''}</div>
    </div>
    <p class="sub">Veronica reviews read-only. A second run then checks every finding against the code and drops anything it can't confirm.</p>
    <div class="row">
      ${running ? `<button class="btn danger" data-act="cancel" data-key="${r.find.status === 'running' ? 'find' : 'verify'}">Stop</button>`
        : `<button class="btn primary" data-act="rev-start" ${r.prep.status === 'done' ? '' : 'disabled'}>${r.find.status === 'idle' ? 'Review with Veronica' : 'Review again'}</button>`}
      ${!running && r.find.status === 'done' && ['error', 'cancelled'].includes(r.verify.status) || res && /verifier/.test(res.error || '') ? '<button class="btn ghost" data-act="rev-verify">Verify again</button>' : ''}
    </div>
    ${logBox('find', r.find)}${err(r.find)}${logBox('verify', r.verify)}
    ${res && res.error ? `<div class="notice bad">${esc(res.error)}</div>` : ''}
    ${res && !res.error ? `
      ${res.summary ? `<p style="margin-top:12px">${esc(res.summary)}</p>` : ''}
      <h3>What to fix</h3>
      ${res.confirmed.length ? res.confirmed.map(x => findingCard(x, x.reason && `Verified: ${x.reason}`)).join('') : '<div class="notice ok">None. Nothing to fix.</div>'}
      ${res.rejected.length ? `<details><summary>${res.rejected.length} finding(s) dropped as unverified</summary>${res.rejected.map(x => findingCard(x, `Dropped: ${x.reason}`)).join('')}</details>` : ''}` : ''}`;
}

function rev4() {
  const r = S.rev;
  const res = reviewResult();
  const d = reviewDraft(res);
  return `
    <div class="card-head"><h2>Submit the review</h2><span class="chip ${res.approved ? 'ok' : 'bad'}">${res.approved ? 'Approve' : 'Comment (not approved)'}</span></div>
    <p class="sub">${res.approved ? 'Posts an approving review.' : 'Posts a comment review with a comment on each issue. It doesn\'t block merging.'} Nothing is posted until you press Post review.</p>
    <label class="field"><span>Review summary</span><textarea id="rev-body" rows="8" ${r.post.status === 'done' ? 'disabled' : ''}>${esc(d.body)}</textarea></label>
    ${d.comments.length ? `<h3>${d.comments.length} line comment(s)</h3>${d.comments.map(c => `<div class="finding"><div class="path">${esc(c.path)}:${c.line}</div><pre>${esc(c.body)}</pre></div>`).join('')}` : ''}
    ${d.outside.length ? `<div class="notice warn">${d.outside.length} finding(s) point at lines outside the diff, so GitHub can't take them as line comments. They're listed in the summary instead.</div>` : ''}
    ${r.post.status === 'error' ? `<div class="notice bad">${esc(r.post.msg)}</div>` : ''}
    ${r.post.status === 'done' ? `<div class="notice ok">${esc(r.post.msg)} ${esc(r.post.url)}</div>` : `
    <div class="row end" style="margin-top:12px">
      <button class="btn primary big" data-act="rev-post" ${r.post.status === 'running' ? 'disabled' : ''}>${r.post.status === 'running' ? 'Posting…' : res.approved ? 'Post approval' : 'Post comments'}</button>
    </div>`}`;
}

function renderReviews() {
  const v = $('#view-reviews');
  const r = S.rev;
  const n = r.page;
  const st = revState();
  const body = [rev1, rev2, rev3, rev4][n - 1]();
  const nextOk = n < 4 && st.reachable[n + 1];
  v.innerHTML = `
    <div class="view-head"><div><h1>Reviews</h1><p>Pull requests assigned to you, reviewed by Veronica, verified, then posted by you.</p></div></div>
    ${stepper(REV_PHASES, n, st, 'rev-goto')}
    <div class="card phase-card">${body}</div>
    <div class="pager">
      <button class="btn" data-act="rev-back" ${n === 1 ? 'disabled' : ''}>Back</button>
      <span class="pager-pos">Phase ${n} of 4 · ${REV_PHASES[n - 1]}</span>
      ${n < 4 ? `<button class="btn primary" data-act="rev-next" ${nextOk ? '' : 'disabled'}>Next: ${REV_PHASES[n]}</button>` : `<button class="btn primary" data-act="rev-new" ${r.post.status === 'running' ? 'disabled' : ''}>Review another PR</button>`}
    </div>`;
  v.querySelectorAll('.log').forEach(l => { l.scrollTop = l.scrollHeight; });
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
  else if (a === 'rev-load') loadReviewPRs();
  else if (a === 'rev-pr') selectPR(el.dataset.key);
  else if (a === 'rev-start') startReview();
  else if (a === 'rev-verify') maybeVerify();
  else if (a === 'rev-post') postReview();
  else if (a === 'rev-goto') revGoTo(Number(el.dataset.n));
  else if (a === 'rev-next') revGoTo(S.rev.page + 1);
  else if (a === 'rev-back') revGoTo(S.rev.page - 1);
  else if (a === 'rev-new') { cancelJob('find'); cancelJob('verify'); S.rev = freshRev(); loadReviewPRs(); }
});

document.addEventListener('change', e => {
  const a = e.target.dataset.act;
  if (a === 'dev-ticket' && e.target.value) selectTicket(e.target.value);
  else if (a === 'dev-repo' && e.target.value) selectRepo(e.target.value);
  else if (a === 'branch-base') { S.dev.branch.base = e.target.value; render(); }
  else if (a === 'branch-fetch') { S.dev.branch.fetch = e.target.checked; }
  else if (a === 'rev-repo' && e.target.value) selectReviewRepo(e.target.value);
});

document.addEventListener('input', e => {
  if (e.target.id === 'ticket-search') { S.ticketQuery = e.target.value; render(); }
  else if (e.target.id === 'dev-branch') { S.dev.branch.name = e.target.value; S.dev.branch.auto = false; }
  else if (e.target.id === 'dev-notes') { S.dev.notes = e.target.value; }
  else if (e.target.id === 'impl-answer') { S.dev.impl.answer = e.target.value; }
  else if (e.target.id === 'rev-body') { S.rev.body = e.target.value; }
});

/* ---------- Settings ---------- */
$('#open-settings').addEventListener('click', () => {
  $('#set-claude').value = S.settings.claudePath || '';
  $('#set-extra').value = (S.settings.extraAllow || []).join('\n');
  $('#set-turns').value = S.settings.maxTurns || 150;
  $('#set-whisper').value = S.settings.whisperModel || '';
  $('#settings-dialog').showModal();
});
$('#settings-dialog').addEventListener('close', async () => {
  if ($('#settings-dialog').returnValue !== 'save') return;
  S.settings = await api.setSettings({
    claudePath: $('#set-claude').value.trim(),
    extraAllow: $('#set-extra').value.split('\n').map(s => s.trim()).filter(Boolean),
    maxTurns: Math.max(20, Math.min(500, parseInt($('#set-turns').value, 10) || 150)),
    whisperModel: $('#set-whisper').value.trim(),
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

/* ---------- Voice ---------- */
// Hold Option/Alt+Space (or press the mic button) and speak; whisper.cpp transcribes locally.
// A focused text field gets the words as dictation; otherwise they run as a command.
const V = { rec: null, want: false };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const VOICE_ACTS = {
  next: 'next', back: 'back', 'go back': 'back', 'sync jira': 'sync-jira',
  'create branch': 'create-branch', implement: 'implement', 'start implementation': 'implement',
  replan: 'replan', 're plan': 'replan', cancel: 'cancel', stop: 'cancel',
  refresh: 'load-changes', 'refresh changes': 'load-changes', 'send answer': 'continue-impl', continue: 'continue-impl',
  'develop another ticket': 'new-ticket', 'another ticket': 'new-ticket', 'new ticket': 'new-ticket', 'next ticket': 'new-ticket',
  'fetch reviews': 'rev-load', 'fetch pull requests': 'rev-load', 'review with veronica': 'rev-start', 'start review': 'rev-start',
  'review again': 'rev-start', 'verify again': 'rev-verify', 'post review': 'rev-post', 'post approval': 'rev-post',
  'post comments': 'rev-post', 'review another': 'rev-new', 'review another pr': 'rev-new', 'next review': 'rev-new',
};
// On the Reviews screen, "next", "back" and "phase N" move through the review phases.
const REV_ACTS = { next: 'rev-next', back: 'rev-back' };
const VOICE_VIEWS = { tickets: 'tickets', repositories: 'repos', repos: 'repos', development: 'dev', reviews: 'reviews' };

// mood is for the companion: thinking (listening/transcribing), happy (handled), idle, error.
function voiceStatus(text, mood = 'idle') {
  const el = $('#voice-status');
  el.textContent = text;
  el.classList.toggle('bad', mood === 'error');
  $('#voice-btn').classList.toggle('live', V.want);
  api.companionVoice(mood, text);
}

async function voiceStart() {
  if (V.want) return;
  V.want = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext({ sampleRate: 16000 }); // whisper.cpp wants 16 kHz mono
    const node = ctx.createScriptProcessor(4096, 1, 1); // ponytail: deprecated but tiny; move to AudioWorklet if Chromium drops it
    const chunks = [];
    node.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination);
    V.rec = { stream, ctx, chunks };
    voiceStatus('Listening…', 'thinking');
    if (!V.want) voiceStop(); // key released while the mic was opening
  } catch (e) { V.want = false; voiceStatus(`Microphone: ${e.message}`, 'error'); }
}

async function voiceStop() {
  V.want = false;
  const r = V.rec;
  if (!r) return;
  V.rec = null;
  r.stream.getTracks().forEach(t => t.stop());
  await r.ctx.close();
  const len = r.chunks.reduce((n, c) => n + c.length, 0);
  if (len < 16000 * 0.3) { voiceStatus('Too short. Hold the key while you speak.'); return; }
  voiceStatus('Transcribing…', 'thinking');
  try {
    const text = (await api.transcribe(wav(r.chunks, len))).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) { voiceStatus('Heard nothing.'); return; }
    const miss = voiceRun(text);
    voiceStatus(`"${text}"${miss}`, miss ? 'idle' : 'happy');
  } catch (e) { voiceStatus(e.message, 'error'); }
}

function wav(chunks, len) {
  const b = new DataView(new ArrayBuffer(44 + len * 2));
  const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 16000, true); b.setUint32(28, 32000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  str(36, 'data'); b.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (const s of c) { b.setInt16(o, Math.max(-1, Math.min(1, s)) * 0x7fff, true); o += 2; }
  return new Uint8Array(b.buffer);
}

// Returns '' when handled, or a short reason shown after the transcript.
function voiceRun(text) {
  const f = document.activeElement;
  if (f && (f.tagName === 'TEXTAREA' || f.tagName === 'INPUT' && /^(text|search)$/.test(f.type))) {
    const pad = f.selectionStart > 0 && !/\s$/.test(f.value.slice(0, f.selectionStart)) ? ' ' : '';
    f.setRangeText(pad + text, f.selectionStart, f.selectionEnd, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    return '';
  }
  const said = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let m;
  if ((m = said.match(/^(?:develop|open|work on|start) ticket (.+)$/))) {
    const q = flat(m[1]);
    const t = S.tickets.find(x => flat(x.id) === q) || S.tickets.find(x => flat(x.title).includes(q));
    if (!t) return ' · no matching ticket';
    selectTicket(t.uid); return '';
  }
  if ((m = said.match(new RegExp(`^review (?:pr ?|p r |pull request |number )?(\\d+|${Object.keys(NUM).join('|')})$`)))) {
    const n = NUM[m[1]] || Number(m[1]);
    const pr = S.reviewPRs.find(p => p.number === n);
    if (!pr) return ' · no pull request with that number waiting for you';
    S.view = 'reviews'; selectPR(`${pr.repo}#${pr.number}`); return '';
  }
  if ((m = said.match(/^(?:use |open |select )?(?:repo|repository) (.+)$/))) {
    const q = flat(m[1]);
    const r = S.repos.find(x => flat(x.name) === q) || S.repos.find(x => flat(x.name).includes(q));
    if (!r) return ' · no matching repository';
    if (S.view === 'reviews' && S.rev.pr) selectReviewRepo(r.path); else selectRepo(r.path);
    return '';
  }
  if ((m = said.match(/^(?:go to )?(?:phase|step) (\w+)$/))) {
    const n = NUM[m[1]] || Number(m[1]);
    if (S.view === 'reviews') { revGoTo(n); return ''; }
    if (S.view !== 'dev') { S.view = 'dev'; render(); }
    goTo(n); return '';
  }
  const view = VOICE_VIEWS[said.replace(/^(?:go to|show|open) /, '')];
  if (view) { S.view = view; render(); return ''; }
  const act = (S.view === 'reviews' && REV_ACTS[VOICE_ACTS[said]]) || VOICE_ACTS[said];
  if (!act) return ' · not a command';
  const btn = document.querySelector(`.view.active [data-act="${act}"]:not([disabled])`);
  if (!btn) return ' · not available here';
  btn.click(); return '';
}

document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || !e.altKey) return;
  e.preventDefault(); // no non-breaking space typed
  if (!e.repeat) voiceStart();
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && V.want) { e.preventDefault(); voiceStop(); } });
window.addEventListener('blur', () => { if (V.want) voiceStop(); });
$('#voice-btn').addEventListener('mousedown', e => e.preventDefault()); // keep focus in the field being dictated into
$('#voice-btn').addEventListener('click', () => (V.want ? voiceStop() : voiceStart()));

/* ---------- Boot ---------- */
api.onJobEvent(onJobEvent);
(async () => {
  S.settings = await api.getSettings();
  render();
  checkClaude();
  await Promise.all([loadTickets(), loadRepos(), loadReviewPRs(true)]);
  render();
})();
