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
  remote: { list: call('remote:list'), mkdir: call('remote:mkdir'), rename: call('remote:rename'), remove: call('remote:remove') },
  local: { home: call('local:home'), list: call('local:list') },
  transfers: {
    add: call('transfers:add'), cancel: call('transfers:cancel'), retry: call('transfers:retry'),
    answer: call('transfers:answer'), clearFinished: call('transfers:clearFinished'),
    onChange: (cb) => { ipcRenderer.on('transfers:change', (_event, jobs) => cb(jobs)); },
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
