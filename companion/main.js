// FANG companion: a small desk buddy that lives on your screen and reacts to FANG's jobs.
// Main-process module. Wire it up from FANG's main.js (see companion/README.md).
//
// It never runs git, never touches your repos and never starts jobs on its own.
// It only listens to the jobs FANG already runs and shows you what's happening.

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const NAME = 'Fang';
const BASE = { w: 240, h: 360 };
const SIZES = { Small: 0.8, Normal: 1, Large: 1.3 };
const PHASES = ['Ticket', 'Repository', 'Branch', 'Implement', 'Changes'];
const KEYS = { toggle: 'CommandOrControl+Alt+H', quiet: 'CommandOrControl+Alt+P' };

let win = null;
let mainWin = null;
let cfg = null;
let cfgFile = null;
let drag = null;
let lastLogAt = 0;
let phase = 0;

// ---------- settings ----------
function loadCfg() {
  cfgFile = path.join(app.getPath('userData'), 'companion.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* first run */ }
  cfg = { size: 'Normal', quiet: false, hidden: false, x: null, y: null, ...saved };
  if (!SIZES[cfg.size]) cfg.size = 'Normal';
}
function saveCfg() {
  try { fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2)); } catch { /* not critical */ }
}

// ---------- window ----------
function dims() {
  const s = SIZES[cfg.size];
  return { w: Math.round(BASE.w * s), h: Math.round(BASE.h * s), s };
}

function startPos(w, h) {
  const onScreen = (x, y) => screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return x + w / 2 >= a.x && x + w / 2 <= a.x + a.width && y + h / 2 >= a.y && y + h / 2 <= a.y + a.height;
  });
  if (Number.isFinite(cfg.x) && Number.isFinite(cfg.y) && onScreen(cfg.x, cfg.y)) return { x: cfg.x, y: cfg.y };
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - w - 24, y: a.y + a.height - h };
}

function send(ch, data) {
  if (win && !win.isDestroyed()) win.webContents.send(`companion:${ch}`, data);
}

function say(mood, text, opts = {}) {
  // Quiet mode keeps the moods but drops chatter. Errors and blocks always get through.
  const urgent = mood === 'error' || mood === 'blocked';
  send('state', { mood, text: cfg.quiet && !urgent && !opts.force ? '' : text, hold: !!opts.hold });
}

function create(mainWindow) {
  mainWin = mainWindow;
  loadCfg();
  const { w, h, s } = dims();
  const { x, y } = startPos(w, h);

  win = new BrowserWindow({
    width: w, height: h, x, y,
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: `${NAME} (FANG companion)`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); // keep FANG in the Dock and app switcher
  win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass through the empty parts
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    send('config', { scale: s, quiet: cfg.quiet, name: NAME, phases: PHASES });
    send('phase', phase);
    if (!cfg.hidden) win.showInactive();
    say('hello', greeting());
  });

  if (mainWin) mainWin.on('closed', destroy);
  registerKeys();
}

function destroy() {
  stopDrag();
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

function greeting() {
  const hr = new Date().getHours();
  const part = hr < 12 ? 'Morning' : hr < 18 ? 'Afternoon' : 'Evening';
  return `${part}. Pick a ticket and I'll keep an eye on things.`;
}

function toggleHidden(force) {
  if (!win || win.isDestroyed()) return;
  cfg.hidden = typeof force === 'boolean' ? force : !cfg.hidden;
  saveCfg();
  if (cfg.hidden) win.hide(); else { win.showInactive(); say('hello', 'Back.'); }
}

function toggleQuiet() {
  cfg.quiet = !cfg.quiet;
  saveCfg();
  send('config', { quiet: cfg.quiet });
  say('idle', cfg.quiet ? 'Quiet on. I\'ll only speak up if something breaks.' : 'Quiet off.', { force: true });
}

function setSize(name) {
  if (!SIZES[name] || !win) return;
  cfg.size = name;
  const { w, h, s } = dims();
  const b = win.getBounds();
  win.setBounds({ x: b.x + b.width - w, y: b.y + b.height - h, width: w, height: h });
  saveCfg();
  send('config', { scale: s });
}

function showFang() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function registerKeys() {
  try { globalShortcut.register(KEYS.toggle, () => toggleHidden()); } catch { /* taken by another app */ }
  try { globalShortcut.register(KEYS.quiet, toggleQuiet); } catch { /* taken by another app */ }
  app.on('will-quit', () => {
    globalShortcut.unregister(KEYS.toggle);
    globalShortcut.unregister(KEYS.quiet);
  });
}

// ---------- dragging (main process follows the cursor; works the same on Mac and Windows) ----------
function startDrag() {
  if (!win) return;
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  drag = { dx: c.x - wx, dy: c.y - wy, timer: setInterval(() => {
    if (!win || win.isDestroyed()) return stopDrag();
    const p = screen.getCursorScreenPoint();
    win.setPosition(p.x - drag.dx, p.y - drag.dy);
  }, 16) };
  // Safety net in case the release is never reported.
  drag.giveUp = setTimeout(stopDrag, 30000);
}

function stopDrag() {
  if (!drag) return;
  clearInterval(drag.timer);
  clearTimeout(drag.giveUp);
  drag = null;
  if (!win || win.isDestroyed()) return;
  // Keep her inside the screen she was dropped on.
  const b = win.getBounds();
  const a = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, a.x), a.x + a.width - b.width);
  const y = Math.min(Math.max(b.y, a.y), a.y + a.height - b.height);
  win.setPosition(x, y);
  cfg.x = x; cfg.y = y;
  saveCfg();
}

// ---------- IPC from the companion window only ----------
const fromCompanion = e => win && !win.isDestroyed() && e.sender === win.webContents;

ipcMain.on('companion:hover', (e, over) => {
  if (!fromCompanion(e) || drag) return;
  win.setIgnoreMouseEvents(!over, { forward: true });
});
ipcMain.on('companion:dragStart', e => { if (fromCompanion(e)) startDrag(); });
ipcMain.on('companion:dragEnd', e => { if (fromCompanion(e)) stopDrag(); });
ipcMain.on('companion:click', e => { if (fromCompanion(e)) showFang(); });
ipcMain.on('companion:menu', e => {
  if (!fromCompanion(e)) return;
  Menu.buildFromTemplate([
    { label: 'Open FANG', click: showFang },
    { type: 'separator' },
    { label: 'Quiet', type: 'checkbox', checked: cfg.quiet, accelerator: KEYS.quiet, click: toggleQuiet },
    { label: 'Size', submenu: Object.keys(SIZES).map(n => ({ label: n, type: 'radio', checked: cfg.size === n, click: () => setSize(n) })) },
    { label: 'Nap', click: () => send('state', { mood: 'sleep', text: '' }) },
    { type: 'separator' },
    { label: 'Hide', accelerator: KEYS.toggle, click: () => toggleHidden(true) },
  ]).popup({ window: win });
});

// ---------- hooks FANG calls ----------
// Which step FANG's Development stepper is on (0-based).
function setPhase(n) {
  if (!Number.isInteger(n)) return;
  phase = Math.max(0, Math.min(PHASES.length - 1, n));
  send('phase', phase);
}

const START = {
  parse: ['thinking', 'Reading the ticket…', 0],
  plan: ['thinking', 'Planning it with jira-to-code…', 3],
  implement: ['working', 'Raphael is on it. I\'ll shout when it\'s done.', 3],
  continue: ['working', 'Raphael is picking it back up.', 3],
};

// kind: parse | plan | implement | continue    type: start | log | done
function jobEvent(kind, type, data = {}) {
  if (!win || win.isDestroyed()) return;

  if (type === 'start') {
    const [mood, text, p] = START[kind] || ['thinking', 'Working…', phase];
    setPhase(p);
    say(mood, text, { hold: true });
    return;
  }

  if (type === 'log') {
    const entry = data.entry || {};
    if (entry.type === 'warn') { send('state', { mood: 'worried', text: '', hold: true }); return; }
    // Narrate tool activity now and then, never more than once every 6 seconds.
    const now = Date.now();
    if (now - lastLogAt < 6000 || !entry.text) return;
    lastLogAt = now;
    const line = String(entry.text).split('\n')[0].trim();
    if (line) say(START[kind] ? START[kind][0] : 'working', line.length > 90 ? `${line.slice(0, 87)}…` : line, { hold: true });
    return;
  }

  if (type === 'done') {
    const r = data.result || {};
    const text = String(r.text || '');
    if (r.cancelled) { say('idle', 'Stopped.'); return; }
    if (!r.ok) {
      const why = String(r.error || 'Something went wrong.').split('\n')[0].slice(0, 120);
      say('error', `That failed: ${why}`, { hold: true });
      nudge();
      return;
    }
    if ((kind === 'implement' || kind === 'continue') && /RAPHAEL BLOCKED/i.test(text)) {
      say('blocked', 'Raphael is stuck and needs your answer. Open FANG to reply.', { hold: true });
      nudge();
      return;
    }
    if (kind === 'parse') say('success', 'Ticket read. Check the parse, then pick a repo.');
    else if (kind === 'plan') say('success', 'The brief is ready for your review.');
    else {
      setPhase(4);
      say('success', 'Done. The changes are on disk for you to review and commit yourself.', { hold: true });
      nudge();
    }
  }
}

// Get your attention when FANG is in the background.
function nudge() {
  if (!mainWin || mainWin.isDestroyed() || mainWin.isFocused()) return;
  if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
  else { mainWin.flashFrame(true); mainWin.once('focus', () => mainWin.flashFrame(false)); }
}

// Voice feedback from FANG's renderer: listening, transcribing, what was heard.
const VOICE_MOODS = new Set(['thinking', 'happy', 'idle', 'error']);
function voice(mood, text) {
  if (!VOICE_MOODS.has(mood)) return;
  say(mood, String(text || '').slice(0, 160), { force: true });
}

module.exports = { create, destroy, jobEvent, setPhase, toggleHidden, voice };
