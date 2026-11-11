// Environment helpers.
// Mac/Linux GUI apps don't inherit the PATH from your shell profile, so `claude`
// and `git` may be "not found" when FANG is launched from Finder. fixPath()
// copies the login-shell PATH into the app and adds the usual install folders.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function fixPath() {
  if (process.platform === 'win32') return;
  const home = os.homedir();
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  let shellPath = '';
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh',
      ['-ilc', 'printf "__FANG__%s__FANG__" "$PATH"'],
      { encoding: 'utf8', timeout: 6000 });
    const m = out.match(/__FANG__(.*)__FANG__/);
    if (m) shellPath = m[1];
  } catch { /* fall back to defaults */ }
  const parts = [...shellPath.split(':'), ...(process.env.PATH || '').split(':'), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(':');
}

function findClaude(override) {
  if (override && fs.existsSync(override)) return override;
  if (process.platform === 'win32') {
    const cands = [];
    try {
      cands.push(...execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true })
        .split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    } catch { /* not on PATH */ }
    cands.push(path.join(os.homedir(), '.local', 'bin', 'claude.exe'));
    const exe = cands.find(c => /\.exe$/i.test(c) && fs.existsSync(c));
    if (exe) return exe;
    return cands.find(c => /\.(cmd|bat)$/i.test(c) && fs.existsSync(c)) || null;
  }
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim() || null;
  } catch {
    const local = path.join(os.homedir(), '.claude', 'local', 'claude');
    return fs.existsSync(local) ? local : null;
  }
}

// Reads KEY=value lines from .env files; later files win. util.parseEnv would do this,
// but it crashes Electron 33's bundled Node (20.18) on some files (SIGTRAP), so: a few lines by hand.
function readEnv(files) {
  const env = {};
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; } // missing file
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const q = m[2].match(/^(["'])(.*)\1$/);
      env[m[1]] = q ? q[2] : m[2].replace(/\s+#.*$/, '');
    }
  }
  return env;
}

module.exports = { fixPath, findClaude, readEnv };
