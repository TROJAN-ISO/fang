// Runs Claude Code headlessly (`claude -p`) and streams progress back.
// The prompt is sent on stdin so it never passes through a shell.
//
// Safety: every run gets a deny list that blocks commits, pushes, merges,
// rebases, resets, branch switching, dependency installs and `gh`. Deny rules
// win over allow rules in Claude Code. FANG never passes
// --dangerously-skip-permissions.
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');

const READ_ONLY = [
  'Read', 'Glob', 'Grep', 'LS', 'Skill', 'TodoWrite',
  'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)',
  'Bash(git rev-parse:*)', 'Bash(git ls-files:*)', 'Bash(git branch --show-current:*)',
  'Bash(git branch -a:*)', 'Bash(git fetch:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(find:*)', 'Bash(grep:*)', 'Bash(head:*)',
  'Bash(tail:*)', 'Bash(wc:*)', 'Bash(sort:*)', 'Bash(basename:*)', 'Bash(date:*)',
];

const IMPLEMENT_EXTRA = [
  'Edit', 'Write', 'MultiEdit', 'Bash(mkdir:*)',
  'Bash(php -l:*)', 'Bash(php artisan test:*)', 'Bash(php artisan make:*)',
  'Bash(./vendor/bin/pest:*)', 'Bash(vendor/bin/pest:*)',
  'Bash(./vendor/bin/phpunit:*)', 'Bash(vendor/bin/phpunit:*)',
  'Bash(./vendor/bin/phpstan:*)', 'Bash(vendor/bin/phpstan:*)', 'Bash(composer test:*)',
  'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run lint:*)', 'Bash(npm run typecheck:*)',
  'Bash(npx tsc:*)', 'Bash(npx vitest:*)', 'Bash(npx jest:*)', 'Bash(npx eslint:*)',
  'Bash(pnpm test:*)', 'Bash(yarn test:*)',
];

const DENY = [
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)',
  'Bash(git reset:*)', 'Bash(git clean:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)',
  'Bash(git restore:*)', 'Bash(git stash:*)', 'Bash(git tag:*)', 'Bash(git pull:*)',
  'Bash(git cherry-pick:*)', 'Bash(git revert:*)', 'Bash(git am:*)', 'Bash(git remote:*)',
  'Bash(git config:*)', 'Bash(git branch -d:*)', 'Bash(git branch -D:*)', 'Bash(git branch -m:*)',
  'Bash(git branch -M:*)', 'Bash(gh:*)',
  'Bash(composer require:*)', 'Bash(composer update:*)', 'Bash(composer remove:*)', 'Bash(composer install:*)',
  'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(npm uninstall:*)', 'Bash(pnpm add:*)', 'Bash(pnpm install:*)',
  'Bash(yarn add:*)', 'Bash(yarn install:*)',
  'Bash(rm -rf:*)', 'Bash(rm -r:*)', 'Bash(sudo:*)',
];

const PROFILES = {
  parse: { permissionMode: 'default', allow: ['Read', 'Skill'], edits: false },
  plan: { permissionMode: 'default', allow: READ_ONLY, edits: false },
  implement: { permissionMode: 'acceptEdits', allow: [...READ_ONLY, ...IMPLEMENT_EXTRA], edits: true },
};

function buildArgs({ profile, agent, maxTurns, addDirs = [], extraAllow = [], resume }) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`Unknown run profile: ${profile}`);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', String(maxTurns || 120)];
  if (agent) args.push('--agent', agent);
  if (resume) args.push('--resume', resume);
  args.push('--permission-mode', p.permissionMode);
  for (const d of addDirs) args.push('--add-dir', d);
  const extra = p.edits ? extraAllow.filter(Boolean).map(c => (/^[A-Z][A-Za-z]+(\(.*\))?$/.test(c) ? c : `Bash(${c}:*)`)) : [];
  args.push('--allowedTools', ...new Set([...p.allow, ...extra]));
  args.push('--disallowedTools', ...DENY);
  return args;
}

function spawnClaude(claudePath, args, cwd) {
  const isWin = process.platform === 'win32';
  if (isWin && /\.(cmd|bat)$/i.test(claudePath)) {
    // .cmd shims need a shell on Windows; quote every argument.
    return spawn(`"${claudePath}"`, args.map(a => `"${a}"`), { cwd, shell: true, windowsHide: true });
  }
  return spawn(claudePath, args, { cwd, windowsHide: true });
}

function describeTool(block) {
  const i = block.input || {};
  const target = i.file_path || i.path || i.pattern || i.command || i.skill || i.description || '';
  return `${block.name}${target ? ' · ' + String(target).split('\n')[0].slice(0, 140) : ''}`;
}

function run({ claudePath, cwd, prompt, ...opts }) {
  const ev = new EventEmitter();
  const args = buildArgs(opts);
  const child = spawnClaude(claudePath, args, cwd);
  let buf = '';
  let stderr = '';
  let result = null;
  let finished = false;

  const finish = (payload) => {
    if (finished) return;
    finished = true;
    ev.emit('done', payload);
  };

  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { ev.emit('log', { type: 'text', text: line }); continue; }
      if (msg.type === 'system' && msg.subtype === 'init') {
        ev.emit('log', { type: 'info', text: `Session started${msg.model ? ' · ' + msg.model : ''}` });
      } else if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
        for (const b of msg.message.content) {
          if (b.type === 'tool_use') ev.emit('log', { type: 'tool', text: describeTool(b) });
          else if (b.type === 'text' && b.text.trim()) ev.emit('log', { type: 'text', text: b.text.trim().split('\n')[0].slice(0, 200) });
        }
      } else if (msg.type === 'user' && msg.message && Array.isArray(msg.message.content)) {
        for (const b of msg.message.content) {
          if (b.type === 'tool_result' && b.is_error) {
            const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            ev.emit('log', { type: 'warn', text: t.split('\n')[0].slice(0, 200) });
          }
        }
      } else if (msg.type === 'result') {
        result = msg;
      }
    }
  });
  child.stderr.on('data', c => { stderr = (stderr + c.toString('utf8')).slice(-4000); });
  child.on('error', err => finish({ ok: false, error: `Couldn't start Claude Code: ${err.message}` }));
  child.on('close', code => {
    if (result) {
      finish({
        ok: !result.is_error && result.subtype === 'success',
        text: result.result || '',
        error: result.is_error || result.subtype !== 'success' ? (result.result || result.subtype) : null,
        sessionId: result.session_id || null,
        cost: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null,
        turns: result.num_turns || null,
      });
    } else {
      finish({ ok: false, error: (stderr.trim() || `Claude Code exited with code ${code}.`) });
    }
  });

  child.stdin.on('error', () => {});
  child.stdin.write(prompt);
  child.stdin.end();

  ev.cancel = () => {
    if (finished) return;
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    else child.kill('SIGTERM');
    finish({ ok: false, cancelled: true, error: 'Cancelled.' });
  };
  return ev;
}

function version(claudePath) {
  return new Promise(resolve => {
    if (!claudePath) return resolve(null);
    const child = spawnClaude(claudePath, ['--version'], undefined);
    let out = '';
    child.stdout.on('data', c => { out += c; });
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out.trim() : null));
  });
}

module.exports = { run, version, buildArgs, DENY };
