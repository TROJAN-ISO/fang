// Bridge for the companion window only. It can report the mouse and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  hover: over => ipcRenderer.send('companion:hover', !!over),
  dragStart: () => ipcRenderer.send('companion:dragStart'),
  dragEnd: () => ipcRenderer.send('companion:dragEnd'),
  click: () => ipcRenderer.send('companion:click'),
  menu: () => ipcRenderer.send('companion:menu'),
  canWalk: ok => ipcRenderer.send('companion:canWalk', !!ok),
  on: (name, cb) => {
    if (!['state', 'phase', 'config', 'walk'].includes(name)) return;
    ipcRenderer.on(`companion:${name}`, (_e, data) => cb(data));
  },
});
