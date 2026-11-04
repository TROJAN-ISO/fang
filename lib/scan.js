// Folder scanning: tickets and repositories.
const fs = require('fs');
const path = require('path');
const gitlib = require('./git');
const WordExtractor = require('word-extractor');

const word = new WordExtractor();

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json']);
const WORD_EXT = new Set(['.doc', '.docx']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', 'dist', 'build', '.next', 'coverage']);
const ID_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

function walk(dir, depth, onFile, onDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (onDir && onDir(full) === false) continue;
      if (depth > 0) walk(full, depth - 1, onFile, onDir);
    } else if (onFile) onFile(full);
  }
}

function firstLine(txt) {
  return (txt.split(/\r?\n/).find(l => l.trim()) || '').trim();
}

function ticketFromText(file, text) {
  const heading = (text.match(/^#\s+(.+)$/m) || [])[1];
  const id = (path.basename(file).match(ID_RE) || text.match(ID_RE) || [])[0] || null;
  let title = (heading || firstLine(text) || path.basename(file)).replace(ID_RE, '').replace(/^[\s:–—-]+/, '').trim();
  if (!title) title = path.basename(file, path.extname(file));
  return { id, title: title.slice(0, 160), content: text };
}

function ticketsFromJson(file, text) {
  let data;
  try { data = JSON.parse(text); } catch { return [ticketFromText(file, text)]; }
  const issues = Array.isArray(data) ? data : Array.isArray(data.issues) ? data.issues : [data];
  return issues.map(issue => {
    const f = issue.fields || {};
    const content = JSON.stringify(issue, null, 2);
    return {
      id: issue.key || (content.match(ID_RE) || [])[0] || null,
      title: String(f.summary || issue.summary || issue.title || path.basename(file)).slice(0, 160),
      content,
    };
  });
}

// Word documents (.doc and .docx): extract the plain text of the body.
async function readWord(file) {
  const doc = await word.extract(file);
  return [doc.getHeaders?.() || '', doc.getBody(), doc.getFootnotes?.() || '']
    .map(t => (t || '').trim()).filter(Boolean).join('\n\n')
    .replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
}

async function scanTickets(dir) {
  const files = [];
  walk(dir, 2, file => {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file);
    if (name.startsWith('~$') || name.startsWith('.~lock')) return; // Word/LibreOffice lock files
    if (TEXT_EXT.has(ext) || WORD_EXT.has(ext)) files.push(file);
  });

  const tickets = [];
  const skipped = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const isWord = WORD_EXT.has(ext);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (st.size > (isWord ? 25 : 1) * 1024 * 1024) { skipped.push({ file, reason: 'File is too large.' }); continue; }

    let list;
    try {
      if (isWord) {
        const text = await readWord(file);
        if (!text.trim()) { skipped.push({ file, reason: 'No text found in this Word file.' }); continue; }
        list = [ticketFromText(file, text)];
      } else {
        const text = fs.readFileSync(file, 'utf8');
        list = ext === '.json' ? ticketsFromJson(file, text) : [ticketFromText(file, text)];
      }
    } catch (e) {
      skipped.push({ file, reason: isWord ? `Couldn't read this Word file (it may be password-protected or damaged).` : e.message });
      continue;
    }
    list.forEach((t, i) => tickets.push({
      ...t,
      uid: `${file}#${i}`,
      file,
      rel: path.relative(dir, file),
      format: isWord ? 'Word' : ext === '.json' ? 'JSON' : ext === '.txt' ? 'Text' : 'Markdown',
      modified: st.mtimeMs,
    }));
  }
  tickets.sort((a, b) => b.modified - a.modified);
  return { tickets, skipped: skipped.map(x => ({ ...x, rel: path.relative(dir, x.file) })) };
}

function isRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

async function scanRepos(dir) {
  const found = [];
  if (isRepo(dir)) found.push(dir);
  walk(dir, 1, null, d => {
    if (isRepo(d)) { found.push(d); return false; } // don't descend into a repo
    return true;
  });
  const repos = [];
  for (const p of found) {
    let info = null, error = null;
    try { info = await gitlib.info(p); } catch (e) { error = e.message; }
    repos.push({ path: p, name: path.basename(p), info, error });
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanTickets, scanRepos };
