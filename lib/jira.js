// Jira sync: READ-ONLY. Fetches the issues in one saved filter (or sprint) and writes them
// as JSON files the ticket scanner already understands. Every request goes
// through get(), which only ever sends GET — FANG never creates, edits,
// transitions, comments on or deletes a Jira issue.
const fs = require('fs');
const path = require('path');
const { readEnv } = require('./env');

const DEFAULT_FILTER = 'Ready for Sprint - Team John';
const SYNC_DIR = 'jira-sync';
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+\.json$/;

// Later files win: the project's .env (dev), then one in the app's data folder (installed app).
function loadConfig(envFiles) {
  const env = readEnv(envFiles);
  const cfg = {
    baseUrl: (env.JIRA_BASE_URL || '').trim().replace(/\/+$/, ''),
    email: (env.JIRA_EMAIL || '').trim(),
    token: (env.JIRA_API_TOKEN || '').trim(),
    filter: (env.JIRA_FILTER || DEFAULT_FILTER).trim(),
  };
  const missing = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'].filter(k => !(env[k] || '').trim());
  if (missing.length) throw new Error(`Missing in .env: ${missing.join(', ')}. Looked in: ${envFiles.join(', ')}`);
  if (!/^https:\/\//.test(cfg.baseUrl)) throw new Error('JIRA_BASE_URL must start with https://');
  return cfg;
}

async function get(cfg, apiPath, params) {
  const url = new URL(cfg.baseUrl + apiPath);
  for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64'),
    },
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' Check JIRA_EMAIL and JIRA_API_TOKEN.' : res.status === 403 ? ' Your account can\'t see this.' : '';
    throw new Error(`Jira ${res.status} ${res.statusText} on ${apiPath}.${hint}`);
  }
  return res.json();
}

async function findFilter(cfg) {
  const r = await get(cfg, '/rest/api/3/filter/search', { filterName: cfg.filter, maxResults: 50 });
  const f = (r.values || []).find(v => v.name.trim().toLowerCase() === cfg.filter.toLowerCase());
  // No saved filter by that name: treat it as a sprint name.
  // Only tickets assigned to the token's owner.
  const scope = f ? `filter = ${f.id}` : `sprint = "${cfg.filter.replace(/"/g, '\\"')}"`;
  return { name: f ? f.name : cfg.filter, jql: `${scope} AND assignee = currentUser()` };
}

// Drop null/empty fields so the saved ticket isn't mostly unused custom fields.
function compact(issue) {
  const fields = {};
  for (const [k, v] of Object.entries(issue.fields || {})) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    fields[k] = v;
  }
  return { key: issue.key, self: issue.self, fields };
}

async function fetchIssues(cfg, jql) {
  const issues = [];
  let nextPageToken;
  for (let page = 0; page < 50; page++) { // ponytail: 5000-issue cap, raise if a filter ever gets that big
    const r = await get(cfg, '/rest/api/3/search/jql', {
      jql, fields: '*navigable', maxResults: 100, nextPageToken,
    });
    issues.push(...(r.issues || []));
    nextPageToken = r.nextPageToken;
    if (r.isLast || !nextPageToken) break;
  }
  return issues;
}

// Writes <dir>/jira-sync/<KEY>.json and removes issues that left the filter.
// Only touches files in that folder, and only ones named like an issue key.
async function sync(envFiles, dir) {
  const cfg = loadConfig(envFiles);
  const filter = await findFilter(cfg);
  const issues = await fetchIssues(cfg, filter.jql);

  const out = path.join(dir, SYNC_DIR);
  fs.mkdirSync(out, { recursive: true });
  const keep = new Set();
  for (const issue of issues) {
    const name = `${issue.key}.json`;
    keep.add(name);
    fs.writeFileSync(path.join(out, name), JSON.stringify(compact(issue), null, 2));
  }
  let removed = 0;
  for (const name of fs.readdirSync(out)) {
    if (KEY_RE.test(name) && !keep.has(name)) { fs.unlinkSync(path.join(out, name)); removed++; }
  }
  return { filter: filter.name, count: issues.length, removed, dir: out };
}

module.exports = { sync };
