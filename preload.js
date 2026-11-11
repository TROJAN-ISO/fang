const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('fang', {
  platform: process.platform,
  getSettings: () => call('settings:get'),
  setSettings: patch => call('settings:set', patch),
  pickFolder: title => call('dialog:folder', title),
  checkClaude: () => call('claude:check'),
  scanTickets: () => call('tickets:scan'),
  syncJira: () => call('jira:sync'),
  reviewRequests: () => call('github:requests'),
  prepareReview: opts => call('review:prepare', opts),
  postReview: opts => call('review:post', opts),
  scanRepos: dir => call('repos:scan', dir),
  repoInfo: repo => call('repo:info', repo),
  repoHead: repo => call('repo:head', repo),
  createBranch: (repo, opts) => call('repo:createBranch', repo, opts),
  changes: repo => call('repo:changes', repo),
  fileDiff: (repo, file, untracked) => call('repo:fileDiff', repo, file, untracked),
  reveal: p => call('shell:reveal', p),
  companionPhase: n => ipcRenderer.send('companion:phase', n),
  companionVoice: (mood, text) => ipcRenderer.send('companion:voice', mood, text),
  transcribe: wav => call('voice:transcribe', wav),
  startJob: (kind, payload) => call('job:start', kind, payload),
  cancelJob: id => call('job:cancel', id),
  onJobEvent: cb => ipcRenderer.on('job:event', (_e, ev) => cb(ev)),
});
