const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dayglass', {
  getUsage: () => ipcRenderer.invoke('usage:get'),
  getHistory: () => ipcRenderer.invoke('usage:history'),
  getMemo: () => ipcRenderer.invoke('memo:get'),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdate: (url) => ipcRenderer.invoke('update:open', url),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUsageUpdate: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('usage:update', listener);
    return () => ipcRenderer.removeListener('usage:update', listener);
  },
  onAwayPrompt: (callback) => {
    const listener = (_event, away) => callback(away);
    ipcRenderer.on('away:prompt', listener);
    return () => ipcRenderer.removeListener('away:prompt', listener);
  },
  onFocusWarning: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('focus:warning', listener);
    return () => ipcRenderer.removeListener('focus:warning', listener);
  },
  setOpacity: (value) => ipcRenderer.invoke('window:set-opacity', value),
  setSize: (size) => ipcRenderer.invoke('window:set-size', size),
  toggleTracking: () => ipcRenderer.invoke('tracking:toggle'),
  toggleFocusMode: () => ipcRenderer.invoke('focus:toggle'),
  toggleClock: () => ipcRenderer.invoke('clock:toggle'),
  toggleSeconds: () => ipcRenderer.invoke('time:toggle-seconds'),
  setDayStart: (value) => ipcRenderer.invoke('time:set-day-start', value),
  setAwayIdle: (value) => ipcRenderer.invoke('time:set-away-idle', value),
  startAway: () => ipcRenderer.invoke('away:start'),
  recordAway: (entry) => ipcRenderer.invoke('away:record', entry),
  cancelAway: () => ipcRenderer.invoke('away:cancel'),
  setDistraction: (key, isDistracting) => ipcRenderer.invoke('app:set-distraction', key, isDistracting),
  deleteApp: (key) => ipcRenderer.invoke('app:delete', key),
  setSortMode: (sortMode) => ipcRenderer.invoke('app:set-sort-mode', sortMode),
  setMemo: (text) => ipcRenderer.invoke('memo:set', text),
  signUp: (credentials) => ipcRenderer.invoke('sync:sign-up', credentials),
  signIn: (credentials) => ipcRenderer.invoke('sync:sign-in', credentials),
  connectSyncId: (value) => ipcRenderer.invoke('sync:connect-id', value),
  logout: () => ipcRenderer.invoke('sync:logout'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
});
