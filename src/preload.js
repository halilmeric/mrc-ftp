const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => async (...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res.ok) return res.value;
  throw res.error;
};

contextBridge.exposeInMainWorld('mrc', {
  sites: { list: call('sites:list'), save: call('sites:save'), remove: call('sites:remove') },
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
    answer: call('transfers:answer'), clearFinished: call('transfers:clearFinished'), dismiss: call('transfers:dismiss'),
    onChange: (cb) => { ipcRenderer.on('transfers:change', (_event, jobs) => cb(jobs)); },
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
