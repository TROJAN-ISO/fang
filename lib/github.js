// GitHub for the Reviews flow. Reads pull requests where your review is
// requested, and posts ONE kind of write: a pull request review, only after you
// confirm it in FANG. Every request goes through api(), which refuses any other
// write, so FANG can't merge, close, push to or edit a pull request.
const fs = require('fs');
const path = require('path');
const { readEnv } = require('./env');
const gitlib = require('./git');

const API = 'https://api.github.com';
const REVIEW_PATH = /^\/repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+\/reviews$/;
const SLUG = /^[\w.-]+\/[\w.-]+$/;

function loadToken(envFiles) {
  const env = readEnv(envFiles);
  const token = (env.GITHUB_TOKEN || '').trim();
  if (!token) throw new Error(`Missing in .env: GITHUB_TOKEN. Looked in: ${envFiles.join(', ')}`);
  return token;
}

async function api(token, method, apiPath, { params, body, raw } = {}) {
  if (method !== 'GET' && !(method === 'POST' && REVIEW_PATH.test(apiPath))) {
    throw new Error(`Blocked: FANG never sends ${method} ${apiPath} to GitHub.`);
  }
  const url = new URL(API + apiPath);
  for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = [j.message, ...(j.errors || []).map(e => e.message || e)].filter(Boolean).join(' · '); } catch { /* not JSON */ }
    const hint = res.status === 401 ? ' Check GITHUB_TOKEN.' : res.status === 404 ? ' The token can\'t see this repository (it needs the repo scope).' : '';
    throw new Error(`GitHub ${res.status} on ${apiPath}: ${detail || res.statusText}.${hint}`);
  }
  return raw ? res : res.json();
}

const toItem = (repo, p) => ({
  repo, number: p.number, title: p.title, author: p.user && p.user.login,
  url: p.html_url, draft: !!p.draft, updated: Date.parse(p.updated_at),
});

// Open PRs where you (or one of your teams) were asked to review.
// Search is indexed with a delay of up to several minutes, so a brand-new request
// can be missing. Your notifications from the last day arrive instantly; each one
// is checked against the PR itself so only PRs still waiting on you are added.
async function reviewRequests(envFiles) {
  const token = loadToken(envFiles);
  const [search, notes, me] = await Promise.all([
    api(token, 'GET', '/search/issues', {
      params: { q: 'is:pr is:open review-requested:@me archived:false', sort: 'updated', order: 'desc', per_page: 100 },
    }),
    api(token, 'GET', '/notifications', {
      params: { all: 'true', participating: 'true', since: new Date(Date.now() - 864e5).toISOString(), per_page: 50 },
    }).catch(() => []), // notifications are a speed-up, not required
    api(token, 'GET', '/user'),
  ]);
  const items = (search.items || []).map(i => toItem(i.repository_url.split('/repos/')[1], i));
  const have = new Set(items.map(i => `${i.repo}#${i.number}`));
  const fresh = notes.filter(n => n.reason === 'review_requested' && n.subject.type === 'PullRequest')
    .map(n => ({ repo: n.repository.full_name, number: Number(n.subject.url.split('/').pop()) }))
    .filter(n => SLUG.test(n.repo) && Number.isInteger(n.number) && !have.has(`${n.repo}#${n.number}`) && have.add(`${n.repo}#${n.number}`));
  const prs = await Promise.all(fresh.map(n => api(token, 'GET', `/repos/${n.repo}/pulls/${n.number}`).catch(() => null)));
  prs.forEach((p, i) => {
    if (p && p.state === 'open' && p.requested_reviewers.some(u => u.login === me.login)) items.push(toItem(fresh[i].repo, p));
  });
  return items.sort((a, b) => b.updated - a.updated);
}

// New-file line numbers you can comment on: added and context lines in each hunk.
function commentableLines(patch) {
  const lines = [];
  let n = 0;
  for (const l of (patch || '').split('\n')) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) { n = Number(h[1]); continue; }
    if (l.startsWith('-') || l.startsWith('\\')) continue;
    if (l.startsWith('+') || l.startsWith(' ')) lines.push(n++);
  }
  return lines;
}

async function prFiles(token, slug, number) {
  const files = [];
  for (let page = 1; page <= 30; page++) { // GitHub stops at 3000 files
    const r = await api(token, 'GET', `/repos/${slug}/pulls/${number}/files`, { params: { per_page: 100, page } });
    files.push(...r);
    if (r.length < 100) break;
  }
  return files;
}

// Fetches the PR into refs/fang/pr-N and checks it out in a separate worktree
// under FANG's data folder. Your own working tree and branch are not touched.
async function prepare(envFiles, dataDir, { repo, slug, number }) {
  if (!SLUG.test(slug) || !Number.isInteger(number)) throw new Error('Bad pull request.');
  const token = loadToken(envFiles);
  const pr = await api(token, 'GET', `/repos/${slug}/pulls/${number}`);
  const files = await prFiles(token, slug, number);

  const ref = `refs/fang/pr-${number}`;
  const baseRef = `refs/fang/pr-${number}-base`;
  await gitlib.git(repo, ['fetch', '--no-tags', 'origin', `+pull/${number}/head:${ref}`, `+refs/heads/${pr.base.ref}:${baseRef}`]);
  const head = (await gitlib.git(repo, ['rev-parse', ref])).stdout.trim();

  // ponytail: one worktree per PR is kept until that PR is reviewed again; add a cleanup if the folder grows.
  const tree = path.join(dataDir, 'review-worktrees', `${path.basename(repo)}-pr-${number}`);
  await gitlib.git(repo, ['worktree', 'remove', '--force', tree], { allowFail: true });
  fs.rmSync(tree, { recursive: true, force: true });
  await gitlib.git(repo, ['worktree', 'prune']);
  await gitlib.git(repo, ['worktree', 'add', '--detach', tree, ref]);

  return {
    slug, number, title: pr.title, body: pr.body || '', author: pr.user.login, url: pr.html_url,
    base: pr.base.ref, headRef: pr.head.ref, headSha: pr.head.sha, localHead: head,
    ref, baseRef, worktree: tree,
    files: files.map(f => ({ path: f.filename, status: f.status, add: f.additions, del: f.deletions, lines: commentableLines(f.patch) })),
  };
}

// event: APPROVE or COMMENT. comments: [{ path, line, body }] on new-file lines in the diff.
// Refuses to post if the PR got new commits after the review ran.
async function postReview(envFiles, { slug, number, headSha, event, body, comments }) {
  if (!SLUG.test(slug) || !Number.isInteger(number)) throw new Error('Bad pull request.');
  if (!['APPROVE', 'COMMENT'].includes(event)) throw new Error(`Blocked review event: ${event}`);
  const token = loadToken(envFiles);
  const pr = await api(token, 'GET', `/repos/${slug}/pulls/${number}`);
  if (pr.head.sha !== headSha) throw new Error('The pull request got new commits after the review. Run the review again.');
  const r = await api(token, 'POST', `/repos/${slug}/pulls/${number}/reviews`, {
    body: {
      commit_id: headSha,
      event,
      body: String(body || ''),
      comments: (comments || []).map(c => ({ path: String(c.path), line: Number(c.line), side: 'RIGHT', body: String(c.body) })),
    },
  });
  return { id: r.id, url: r.html_url, state: r.state };
}

module.exports = { reviewRequests, prepare, postReview, commentableLines };
