const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => async (...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res.ok) return res.value;
  throw res.error;
};

contextBridge.exposeInMainWorld('mrc', {
  sites: {
    onChange: (cb) => { ipcRenderer.on('sites:changed', () => cb()); },
    list: call('sites:list'), save: call('sites:save'), remove: call('sites:remove'), favorites: call('sites:favorites'), favorite: call('sites:favorite'),
  },
  lang: ipcRenderer.sendSync('lang:get'), // { current, chosen }
  setLang: call('lang:set'), relaunch: call('app:relaunch'),
  newTab: call('window:newTab'),
  onSettings: (cb) => { ipcRenderer.on('settings:open', () => cb()); },
  connect: call('connect'),
  trust: call('trust'),
  disconnect: call('disconnect'),
  remote: { list: call('remote:list'), mkdir: call('remote:mkdir'), rename: call('remote:rename'), remove: call('remote:remove'), chmod: call('remote:chmod') },
  local: { home: call('local:home'), list: call('local:list'), downloads: call('local:downloads'), pickDir: call('local:pickDir'), pickKey: call('local:pickKey') },
  edit: {
    open: call('edit:open'), stopAll: call('edit:stopAll'),
    onChange: (cb) => { ipcRenderer.on('edits:change', (_event, count) => cb(count)); },
  },
  preview: { local: call('preview:local'), remote: call('preview:remote') },
  transfers: {
    add: call('transfers:add'), cancel: call('transfers:cancel'), retry: call('transfers:retry'),
    answer: call('transfers:answer'), clearFinished: call('transfers:clearFinished'), dismiss: call('transfers:dismiss'), setLimit: call('transfers:setLimit'), setParallel: call('transfers:setParallel'),
    onChange: (cb) => { ipcRenderer.on('transfers:change', (_event, jobs) => cb(jobs)); },
  },
  term: {
    start: call('term:start'), resize: call('term:resize'), snapshot: call('term:snapshot'),
    detach: call('term:detach'), dock: call('term:dock'), stop: call('term:stop'),
    input: (data) => ipcRenderer.send('term:input', data),
    onData: (cb) => { ipcRenderer.on('term:data', (_event, data) => cb(data)); },
    onState: (cb) => { ipcRenderer.on('term:state', (_event, state) => cb(state)); },
    onDocked: (cb) => { ipcRenderer.on('term:docked', (_event, docked) => cb(docked)); },
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
