// Git helper.
// FANG ONLY reads git state and creates branches. It never commits, pushes,
// merges, rebases, resets, or stashes. Those subcommands are hard-blocked here,
// so even a bug elsewhere in the app can't run them.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const FORBIDDEN = new Set([
  'commit', 'push', 'merge', 'rebase', 'reset', 'clean', 'tag', 'am', 'cherry-pick',
  'revert', 'pull', 'stash', 'checkout', 'restore', 'rm', 'mv', 'remote', 'config',
]);

function git(cwd, args, { allowFail = false } = {}) {
  if (FORBIDDEN.has(args[0])) {
    return Promise.reject(new Error(`Blocked: FANG never runs "git ${args[0]}".`));
  }
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !allowFail) return reject(new Error((stderr || err.message).trim()));
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

async function refExists(repo, ref) {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', ref], { allowFail: true })).code === 0;
}

function parseStatus(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const code = line.slice(0, 2);
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    file = file.replace(/^"(.*)"$/, '$1');
    return { code, file, untracked: code === '??' };
  });
}

async function info(repo) {
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })).stdout.trim() || '(no commits)';
  const status = parseStatus((await git(repo, ['status', '--porcelain=v1'])).stdout);
  return {
    branch,
    trackedChanges: status.filter(s => !s.untracked).length,
    untracked: status.filter(s => s.untracked).length,
    hasDevelop: await refExists(repo, 'refs/heads/develop'),
    hasOriginDevelop: await refExists(repo, 'refs/remotes/origin/develop'),
    origin: await originSlug(repo),
  };
}

// "owner/name" of the origin remote on GitHub, or null. ls-remote --get-url reads config only, no network.
async function originSlug(repo) {
  const url = (await git(repo, ['ls-remote', '--get-url', 'origin'], { allowFail: true })).stdout.trim();
  const m = url.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
  return m ? m[1] : null;
}

async function createBranch(repo, { name, base, fetchFirst }) {
  name = String(name || '').trim();
  if (!name) throw new Error('Enter a branch name.');
  if ((await git(repo, ['check-ref-format', '--branch', name], { allowFail: true })).code !== 0) {
    throw new Error(`"${name}" isn't a valid branch name. Avoid spaces, "..", "~", "^", ":" and a trailing "/".`);
  }
  if (await refExists(repo, `refs/heads/${name}`)) {
    throw new Error(`Branch "${name}" already exists in this repository. Choose another name.`);
  }
  const dirty = parseStatus((await git(repo, ['status', '--porcelain=v1'])).stdout).filter(s => !s.untracked);
  if (dirty.length) {
    throw new Error(`This repository has ${dirty.length} uncommitted change(s) to tracked files. Commit or stash them yourself, then create the branch.`);
  }
  let start;
  if (base === 'origin/develop') {
    if (fetchFirst) await git(repo, ['fetch', 'origin', 'develop']);
    if (!(await refExists(repo, 'refs/remotes/origin/develop'))) throw new Error('origin/develop not found. Try "Local develop" instead.');
    start = 'origin/develop';
  } else {
    if (!(await refExists(repo, 'refs/heads/develop'))) throw new Error('No local develop branch. Try "origin/develop" instead.');
    start = 'develop';
  }
  // --no-track: the new branch gets no upstream, so nothing is set up to push.
  await git(repo, ['switch', '--no-track', '-c', name, start]);
  return { name, start, head: await head(repo) };
}

async function head(repo) {
  const sha = (await git(repo, ['rev-parse', 'HEAD'], { allowFail: true })).stdout.trim();
  const branch = (await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true })).stdout.trim();
  const up = await git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFail: true });
  return { sha, branch, upstream: up.code === 0 ? up.stdout.trim() : null };
}

function countLines(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 2 * 1024 * 1024) return null;
    const txt = fs.readFileSync(file, 'utf8');
    return txt ? txt.split('\n').length - (txt.endsWith('\n') ? 1 : 0) : 0;
  } catch { return null; }
}

async function changes(repo) {
  const status = parseStatus((await git(repo, ['status', '--porcelain=v1', '-uall'])).stdout);
  const num = {};
  const ns = await git(repo, ['diff', '--numstat', 'HEAD'], { allowFail: true });
  for (const line of ns.stdout.split(/\r?\n/).filter(Boolean)) {
    const [add, del, ...rest] = line.split('\t');
    let f = rest.join('\t');
    if (f.includes(' => ')) f = f.replace(/\{.* => (.*)\}/, '$1').replace(/^.* => /, '');
    num[f] = { add: add === '-' ? null : Number(add), del: del === '-' ? null : Number(del) };
  }
  return status.map(s => {
    const n = num[s.file] || (s.untracked ? { add: countLines(path.join(repo, s.file)), del: 0 } : { add: null, del: null });
    let kind = 'modified';
    if (s.untracked || s.code.includes('A')) kind = 'added';
    else if (s.code.includes('D')) kind = 'deleted';
    else if (s.code.includes('R')) kind = 'renamed';
    return { file: s.file, kind, untracked: s.untracked, add: n.add, del: n.del };
  });
}

async function fileDiff(repo, file, untracked) {
  if (untracked) {
    try {
      const txt = fs.readFileSync(path.join(repo, file), 'utf8');
      return `new file: ${file}\n` + txt.replace(/\n$/, '').split('\n').map(l => '+' + l).join('\n');
    } catch (e) { return `Can't read ${file}: ${e.message}`; }
  }
  return (await git(repo, ['diff', 'HEAD', '--', file], { allowFail: true })).stdout || '(no textual diff)';
}

module.exports = { git, info, createBranch, head, changes, fileDiff };
