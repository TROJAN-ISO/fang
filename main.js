const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { fixPath, findClaude } = require('./lib/env');
const scan = require('./lib/scan');
const gitlib = require('./lib/git');
const claude = require('./lib/claude');
const prompts = require('./lib/prompts');
const jira = require('./lib/jira');
const github = require('./lib/github');
const companion = require('./companion/main');

fixPath();

let win;
const jobs = new Map();
let jobSeq = 0;

const settingsFile = () => path.join(app.getPath('userData'), 'fang-settings.json');
const DEFAULTS = { reposDir: '', claudePath: '', extraAllow: [], maxTurns: 150, whisperModel: '' };

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
  companion.create(win);
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

// Tickets come only from the read-only Jira sync, kept in FANG's own data
// folder (<userData>/jira-sync), so no other file can show up as a ticket.
handle('tickets:scan', async () => scan.scanTickets(path.join(app.getPath('userData'), 'jira-sync')));
const envFiles = () => [path.join(__dirname, '.env'), path.join(app.getPath('userData'), '.env')];
handle('jira:sync', async () => jira.sync(envFiles(), app.getPath('userData')));
// Reviews: GitHub reads, plus posting a review only when the user confirms it.
handle('github:requests', async () => github.reviewRequests(envFiles()));
handle('review:prepare', async opts => github.prepare(envFiles(), app.getPath('userData'), opts));
handle('review:post', async opts => github.postReview(envFiles(), opts));
handle('repos:scan', async dir => scan.scanRepos(dir));
handle('repo:info', async repo => gitlib.info(repo));
handle('repo:head', async repo => gitlib.head(repo));
handle('repo:createBranch', async (repo, opts) => gitlib.createBranch(repo, opts));
handle('repo:changes', async repo => gitlib.changes(repo));
handle('repo:fileDiff', async (repo, file, untracked) => gitlib.fileDiff(repo, file, untracked));
// Speech to text with local whisper.cpp (brew install whisper-cpp). Audio never leaves the machine.
handle('voice:transcribe', async wav => {
  if (!(wav instanceof Uint8Array) || wav.length > 20e6) throw new Error('Bad audio.');
  const model = loadSettings().whisperModel || path.join(app.getPath('userData'), 'models', 'ggml-base.en.bin');
  if (!fs.existsSync(model)) throw new Error(`Whisper model not found at ${model}. Download ggml-base.en.bin there, or set its path in Settings.`);
  const file = path.join(os.tmpdir(), `fang-voice-${Date.now()}.wav`);
  fs.writeFileSync(file, wav);
  try {
    return await new Promise((resolve, reject) => execFile('whisper-cli', ['-m', model, '-f', file, '-nt', '-np', '-l', 'en'], { timeout: 60000 },
      (err, stdout) => err ? reject(new Error(err.code === 'ENOENT' ? 'whisper-cli not found. Install it with: brew install whisper-cpp' : err.message)) : resolve(stdout.trim())));
  } finally { fs.rmSync(file, { force: true }); }
});
handle('shell:reveal', async p => { shell.showItemInFolder(p); return true; });

// kind: parse | plan | implement | continue | review-find | review-verify
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
  } else if (kind === 'review-find' || kind === 'review-verify') {
    const trees = path.join(app.getPath('userData'), 'review-worktrees') + path.sep;
    if (!path.resolve(String(payload.pr.worktree)).startsWith(trees)) throw new Error('Review checkout is outside FANG\'s data folder.');
    const prompt = kind === 'review-find' ? prompts.reviewFind(payload.pr) : prompts.reviewVerify(payload.pr, payload.findings);
    opts = { ...base, profile: 'review', agent: 'veronica', cwd: payload.pr.worktree, prompt };
  } else if (kind === 'continue') {
    opts = { ...base, profile: 'implement', agent: 'raphael', cwd: payload.repo, resume: payload.sessionId, prompt: prompts.continueImplement(payload) };
  } else {
    throw new Error(`Unknown job: ${kind}`);
  }

  const id = `job-${++jobSeq}`;
  const job = claude.run(opts);
  jobs.set(id, job);
  const send = (type, data) => { if (win && !win.isDestroyed()) win.webContents.send('job:event', { id, type, ...data }); };
  companion.jobEvent(kind, 'start');
  job.on('log', entry => { send('log', { entry }); companion.jobEvent(kind, 'log', { entry }); });
  job.on('done', res => { jobs.delete(id); send('done', { result: res }); companion.jobEvent(kind, 'done', { result: res }); });
  return id;
});

ipcMain.on('companion:phase', (_e, n) => companion.setPhase(n));
ipcMain.on('companion:voice', (_e, mood, text) => companion.voice(mood, text));
handle('job:cancel', async id => { const j = jobs.get(id); if (j) j.cancel(); return true; });
