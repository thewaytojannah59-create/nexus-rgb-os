// ============================================================
// Nexus RGB OS — Electron Preload
// ============================================================
// Bridges the renderer (React) to the main process (Node.js).
// Exposes window.NexusOS — this is exactly what useHardwareBridge
// and useAppIntegrations check for.
//
// Security: contextIsolation = true, nodeIntegration = false.
// Only the APIs listed here are accessible from the renderer.
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('NexusOS', {

  isElectron: true,

  // ── RGB ──────────────────────────────────────────────────────
  rgb: {
    connect:    ()              => ipcRenderer.invoke('rgb:connect'),
    disconnect: ()              => ipcRenderer.invoke('rgb:disconnect'),
    scan:       ()              => ipcRenderer.invoke('rgb:scan'),
    status:     ()              => ipcRenderer.invoke('rgb:status'),
    setColor:   (id, r, g, b)  => ipcRenderer.invoke('rgb:setColor', id, r, g, b),
    setMode:    (id, modeName)  => ipcRenderer.invoke('rgb:setMode',  id, modeName),
    retry:      ()              => ipcRenderer.invoke('rgb:retry'),

    // Fired when OpenRGB fails to start — { error, reason }
    onUnavailable: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('openrgb:unavailable', handler);
      return () => ipcRenderer.removeListener('openrgb:unavailable', handler);
    },
    // Fired when a retry succeeds
    onRecovered: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('openrgb:recovered', handler);
      return () => ipcRenderer.removeListener('openrgb:recovered', handler);
    },
    // Live status during retry
    onBootStatus: (cb) => {
      const handler = (_, msg) => cb(msg);
      ipcRenderer.on('openrgb:boot-status', handler);
      return () => ipcRenderer.removeListener('openrgb:boot-status', handler);
    },
  },

  // ── System Gateway ────────────────────────────────────────────
  // Circuit breaker + watchdog state pushed from main process
  gateway: {
    getState:    ()   => ipcRenderer.invoke('gateway:state'),
    resetCircuit: () => ipcRenderer.invoke('gateway:reset'),
    // CRE heartbeat ping — lightweight liveness probe
    ping:        ()   => ipcRenderer.invoke('cre:ping'),
    onStateChange: (cb) => {
      const handler = (_, state) => cb(state);
      ipcRenderer.on('gateway:state', handler);
      return () => ipcRenderer.removeListener('gateway:state', handler);
    },
  },

  // ── Telemetry ─────────────────────────────────────────────────
  telemetry: {
    start: (intervalMs) => ipcRenderer.invoke('telemetry:start', intervalMs),
    stop:  ()           => ipcRenderer.invoke('telemetry:stop'),
    // Renderer subscribes: const unsub = window.NexusOS.telemetry.onUpdate(cb)
    onUpdate: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('telemetry-update', handler);
      // Returns an unsubscribe function (useMemoryLeak trackIpc picks this up)
      return () => ipcRenderer.removeListener('telemetry-update', handler);
    },
  },

  // ── Process list (app/game detection) ────────────────────────
  processes: {
    list: () => ipcRenderer.invoke('processes:list'),
  },

  // ── Game auto detection ───────────────────────────────────────
  detector: {
    start: () => ipcRenderer.invoke('detector:start'),
    stop:  () => ipcRenderer.invoke('detector:stop'),
    status: () => ipcRenderer.invoke('detector:status'),
    onUpdate: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('game:update', handler);
      return () => ipcRenderer.removeListener('game:update', handler);
    },
    onDetected: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('game:detected', handler);
      return () => ipcRenderer.removeListener('game:detected', handler);
    },
    onStopped: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('game:stopped', handler);
      return () => ipcRenderer.removeListener('game:stopped', handler);
    },
  },

  // ── Game integrations ─────────────────────────────────────────
  // Read-only live process status for the Game Integrations panel.
  games: {
    status: () => ipcRenderer.invoke('games:status'),
  },

  // ── Persistent store ──────────────────────────────────────────
  store: {
    get: (key, defaultValue) => ipcRenderer.invoke('store:get', key, defaultValue),
    set:    (key, value) => ipcRenderer.invoke('store:set', key, value),
    delete: (key)        => ipcRenderer.invoke('store:delete', key),
  },

  // ── AI (proxied through main process — no CORS, key never in renderer traffic) ──
  ai: {
    query:    (prompt, apiKey, system, provider) => ipcRenderer.invoke('ai:query',    prompt, apiKey, system, provider),
    checkKey: (apiKey, provider)                 => ipcRenderer.invoke('ai:checkKey', apiKey, provider),
  },

  // ── App settings ──────────────────────────────────────────────────────
  app: {
    setAutoLaunch: (enabled) => ipcRenderer.invoke('app:setAutoLaunch', enabled),
    getAutoLaunch: ()        => ipcRenderer.invoke('app:getAutoLaunch'),
  },

    // ── Window controls ───────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close:    () => ipcRenderer.invoke('window:close'),
  },

});
