const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  detectSources: () => ipcRenderer.invoke('sources:detect'),
  importSources: (sources) => ipcRenderer.invoke('import:sources', sources),
  importHtml: () => ipcRenderer.invoke('import:html'),
  list: () => ipcRenderer.invoke('library:list'),
  update: (id, patch) => ipcRenderer.invoke('bookmark:update', id, patch),
  remove: (ids) => ipcRenderer.invoke('bookmark:remove', ids),
  open: (url) => ipcRenderer.invoke('open:url', url),
  browserSyncPlan: () => ipcRenderer.invoke('browsers:plan'),
  browserSyncApply: (labels) => ipcRenderer.invoke('browsers:apply', labels),
  revealFile: (file) => ipcRenderer.invoke('browsers:reveal', file),
  keyStatus: () => ipcRenderer.invoke('key:status'),
  saveKey: (key) => ipcRenderer.invoke('key:save', key),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  ollamaStatus: (model) => ipcRenderer.invoke('ollama:status', model),
  categorize: (ids) => ipcRenderer.invoke('claude:categorize', { ids }),
  checkLinks: (ids) => ipcRenderer.invoke('links:check', { ids }),
  exportHtml: (ids, groupBy) => ipcRenderer.invoke('export:html', { ids, groupBy }),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, p) => fn(p)),
});
