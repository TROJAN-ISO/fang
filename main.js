const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { fixPath, findClaude } = require('./lib/env');
const scan = require('./lib/scan');
const gitlib = require('./lib/git');
const claude = require('./lib/claude');
const prompts = require('./lib/prompts');

fixPath();

let win;
const jobs = new Map();
let jobSeq = 0;

const settingsFile = () => path.join(app.getPath('userData'), 'fang-settings.json');
const DEFAULTS = { ticketsDir: '', reposDir: '', claudePath: '', extraAllow: [], maxTurns: 150 };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 640,
    title: 'FANG',
    backgroundColor: '#1B2130',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu?.();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  for (const j of jobs.values()) j.cancel();
  app.quit();
});

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
});

handle('settings:get', async () => loadSettings());
handle('settings:set', async patch => { const s = { ...loadSettings(), ...patch }; saveSettings(s); return s; });

handle('dialog:folder', async title => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('claude:check', async () => {
  const p = findClaude(loadSettings().claudePath);
  return { path: p, version: p ? await claude.version(p) : null };
});

handle('tickets:scan', async dir => scan.scanTickets(dir));
handle('repos:scan', async dir => scan.scanRepos(dir));
handle('repo:info', async repo => gitlib.info(repo));
handle('repo:head', async repo => gitlib.head(repo));
handle('repo:createBranch', async (repo, opts) => gitlib.createBranch(repo, opts));
handle('repo:changes', async repo => gitlib.changes(repo));
handle('repo:fileDiff', async (repo, file, untracked) => gitlib.fileDiff(repo, file, untracked));
handle('shell:reveal', async p => { shell.showItemInFolder(p); return true; });

// kind: parse | plan | implement | continue
handle('job:start', async (kind, payload) => {
  const s = loadSettings();
  const claudePath = findClaude(s.claudePath);
  if (!claudePath) throw new Error('Claude Code CLI not found. Install it, or set its path in Settings.');
  const base = { claudePath, maxTurns: s.maxTurns, extraAllow: s.extraAllow };
  let opts;

  if (kind === 'parse') {
    opts = { ...base, profile: 'parse', cwd: path.dirname(payload.ticket.file), prompt: prompts.parse(payload.ticket), maxTurns: 20 };
  } else if (kind === 'plan') {
    opts = { ...base, profile: 'plan', cwd: payload.repo, prompt: prompts.plan(payload) };
  } else if (kind === 'implement') {
    opts = { ...base, profile: 'implement', agent: 'raphael', cwd: payload.repo, prompt: prompts.implement(payload) };
  } else if (kind === 'continue') {
    opts = { ...base, profile: 'implement', agent: 'raphael', cwd: payload.repo, resume: payload.sessionId, prompt: prompts.continueImplement(payload) };
  } else {
    throw new Error(`Unknown job: ${kind}`);
  }

  const id = `job-${++jobSeq}`;
  const job = claude.run(opts);
  jobs.set(id, job);
  const send = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('job:event', { id, type, ...data }); };
  job.on('log', entry => send('log', { entry }));
  job.on('done', res => { jobs.delete(id); send('done', { result: res }); });
  return id;
});

handle('job:cancel', async id => { const j = jobs.get(id); if (j) j.cancel(); return true; });
