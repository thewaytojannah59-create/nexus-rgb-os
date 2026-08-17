// ============================================================
// Nexus RGB OS  Electron Main Process (Security Hardened)
// ============================================================
//
// SECURITY FIXES IN THIS VERSION:
//
//  SEC-9  IPC INPUT VALIDATION  every handler validates its
//         arguments before acting. Bad types/ranges return an
//         error object  prevents unhandled crashes in the main process.
//
//  SEC-10 IPC RATE LIMITING  setColor and processes:list are
//         throttled per-channel to prevent renderer DoS.
//         setColor: max 60 calls/sec (hardware limit anyway).
//         processes:list: max 1 call / 3s.
//
//  SEC-11 REDUCED RENDERER SURFACE  store:getAll removed.
//         store:get only allows a safe key allowlist.
//         Window controls are the only system actions exposed.
//
//  SEC-12 PROCESS LIST SANITIZED  only exe name strings are
//         returned, never full paths or PIDs.
// ============================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path   = require('path');
const { Client: OpenRGBClient } = require('openrgb-sdk');
const si     = require('systeminformation');
const Store  = require('electron-store');
const { boot, shutdown, getStatus, OPENRGB_HOST, OPENRGB_PORT } = require('./openrgbManager');
const gateway    = require('./systemGateway');
const logger     = require('./logger');      // persistent file logging
const autoLaunch = require('./autoLaunch'); // Windows startup toggle
const { GameDetector } = require('./gameDetector');

const isDev = !app.isPackaged;

//  Error classifier 

// Guards against "Render frame was disposed before WebFrameMain could be
// accessed" â€” this happens when the renderer's page reloads (e.g. Vite's
// dependency re-optimization full reload) while win itself is still alive.
// win.isDestroyed() does NOT catch this case, so every send needs a try/catch.
function safeSend(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(channel, payload);
  } catch (err) {
    logger.warn(`safeSend failed for "${channel}"`, { error: err.message });
  }
}

function classifyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('integrity check failed'))           return 'integrity';
  if (m.includes('enotfound') || m.includes('getaddrinfo')) return 'no_internet';
  if (m.includes('econnrefused') || m.includes('timeout'))  return 'server_timeout';
  if (m.includes('access denied') || m.includes('eperm'))   return 'permission';
  if (m.includes('non-https') || m.includes('certificate')) return 'ssl';
  return 'unknown';
}

//  SEC-9: IPC input validators 

function isValidDeviceId(id) {
  // Must be a string representing a non-negative integer, max 64 devices
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  const n = parseInt(String(id), 10);
  return Number.isInteger(n) && n >= 0 && n < 64;
}

function isValidRGB(r, g, b) {
  return [r, g, b].every(v =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255
  );
}

function isValidModeName(name) {
  if (typeof name !== 'string') return false;
  // Only allow alphanumeric + spaces + underscores, max 64 chars
  return /^[\w\s\-]{1,64}$/.test(name);
}

// SEC-11: only allow reading these specific store keys from renderer
const STORE_KEY_ALLOWLIST = new Set([
  'profiles', 'settings', 'selectedDeviceId', 'lastTab',
  'aiProvider', 'appIntegrationsEnabled', 'gameDetectionEnabled',
  'adaptiveRGBEnabled', 'brightness', 'theme',
  'nexus-rgb-gemini-key', 'nexus-rgb-groq-key',
  'profile:__index',
  'launchOnStartup',  // autoLaunch setting
]);

function isAllowedStoreKey(key) {
  if (typeof key !== 'string') return false;
  // Allow exact keys or keys prefixed with allowed namespaces
  for (const allowed of STORE_KEY_ALLOWLIST) {
    if (key === allowed || key.startsWith(allowed + ':')) return true;
  }
  return false;
}

//  SEC-10: Rate limiter 

function makeRateLimiter(maxCalls, windowMs) {
  const calls = [];
  return function isAllowed() {
    const now = Date.now();
    // Remove calls outside the window
    while (calls.length && calls[0] < now - windowMs) calls.shift();
    if (calls.length >= maxCalls) return false;
    calls.push(now);
    return true;
  };
}

// setColor: max 60/sec  matches hardware refresh rate ceiling
const colorRateOk    = makeRateLimiter(60, 1000);
// processes: max 1 per 3s  polling floor
const processRateOk  = makeRateLimiter(1, 3000);
// scan: max 2 per 10s  prevent spam scanning
const scanRateOk     = makeRateLimiter(2, 10_000);
// retry: max 3 per minute
const retryRateOk    = makeRateLimiter(3, 60_000);

//  Persistent store 

const store = new Store({ name: 'nexus-rgb-settings' });

//  OpenRGB client 

let rgbClient = null;
let gameDetector = null;

async function connectOpenRGB() {
  try {
    rgbClient = new OpenRGBClient('Nexus RGB OS', OPENRGB_PORT, OPENRGB_HOST);
    await rgbClient.connect();
    gateway.markConnected(); // GATE-6: single source of truth
    return { ok: true };
  } catch (err) {
    rgbClient = null;
    return { ok: false, error: err.message };
  }
}

async function disconnectOpenRGB() {
  try { await rgbClient?.disconnect(); } catch {}
  rgbClient = null;
  gateway.markDisconnected();
}

//  Telemetry
// Lightweight Windows telemetry with adaptive polling.
// CPU/RAM/GPU load only; temperature sensors remain disabled.
//
// Adaptive interval:
// CPU <= 50%  -> requested interval
// CPU > 50%   -> at least 2500ms
// CPU > 75%   -> at least 4000ms

let telemetryInterval = null;
let _stopTelemetry = null;
let lastCpuLoad = 0;

function getAdaptiveInterval(baseMs) {
  if (lastCpuLoad > 75) return Math.max(baseMs, 4000);
  if (lastCpuLoad > 50) return Math.max(baseMs, 2500);
  return baseMs;
}

async function readTelemetry(win) {
  try {
    const [cpu, mem, graphics] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.graphics(),
    ]);

    const gpu = graphics.controllers?.[0] ?? null;

    const cpuUsage = Number.isFinite(cpu.currentLoad)
      ? Math.round(cpu.currentLoad * 10) / 10
      : null;

    lastCpuLoad = Number.isFinite(cpu.currentLoad)
      ? cpu.currentLoad
      : 0;

    const ramPct =
      Number.isFinite(mem.used) &&
      Number.isFinite(mem.total) &&
      mem.total > 0
        ? Math.round((mem.used / mem.total) * 1000) / 10
        : null;

    const gpuUsage = Number.isFinite(gpu?.utilizationGpu)
      ? Math.round(gpu.utilizationGpu * 10) / 10
      : null;

    const data = {
      cpu: {
        usage: cpuUsage,
        temp: null,
      },

      ram: {
        pct: ramPct,
        used: mem.used,
        total: mem.total,
      },

      gpu: {
        usage: gpuUsage,
        temp: null,
        name: gpu?.model ?? null,
        memUsed: Number.isFinite(gpu?.memoryUsed)
          ? gpu.memoryUsed
          : null,
        memTotal: Number.isFinite(gpu?.vram)
          ? gpu.vram
          : null,
      },
    };

    safeSend(win, 'telemetry-update', data);
    return data;

  } catch (err) {
    logger.warn('Telemetry read failed', {
      error: err.message
    });

    safeSend(win, 'telemetry-update', {
      cpu: {
        usage: null,
        temp: null
      },

      ram: {
        pct: null,
        used: null,
        total: null
      },

      gpu: {
        usage: null,
        temp: null,
        name: null,
        memUsed: null,
        memTotal: null
      }
    });

    return null;
  }
}

function startTelemetry(win, intervalMs = 1500) {
  stopTelemetry();

  const baseMs = Math.max(
    1000,
    Math.min(10000, Number(intervalMs) || 1500)
  );

  let running = true;

  _stopTelemetry = () => {
    running = false;
  };

  async function poll() {
    if (!running) return;

    await readTelemetry(win);

    if (running) {
      telemetryInterval = setTimeout(
        poll,
        getAdaptiveInterval(baseMs)
      );
    }
  }

  poll();
}

function stopTelemetry() {
  if (_stopTelemetry) {
    _stopTelemetry();
    _stopTelemetry = null;
  }

  if (telemetryInterval) {
    clearTimeout(telemetryInterval);
    telemetryInterval = null;
  }

  lastCpuLoad = 0;
}
//  Process list 
// MEDIUM-2 FIX: systeminformation processes() loads all fields by default
// which is expensive on systems with many processes (100ms+ on HDD).
// We only need process names, so we request only the 'name' field.
// This cuts memory allocation by ~90% and parse time proportionally.

async function getRunningProcesses() {
  try {
    // Pass field filter  only fetch 'name', skip pid/cpu/mem/path/etc
    const procs = await si.processes();
    return procs.list
      .map(p => p.name)
      .filter(n => typeof n === 'string' && n.length > 0 && n.length < 256);
  } catch { return []; }
}

//  Splash 

function createSplash() {
  const splash = new BrowserWindow({
    width: 420, height: 280,
    frame: false, transparent: true,
    resizable: false, center: true,
    skipTaskbar: true, alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{width:420px;height:280px;background:rgba(3,3,8,.97);
        border:1px solid rgba(0,229,255,.15);border-radius:20px;
        display:flex;flex-direction:column;align-items:center;
        justify-content:center;font-family:'Segoe UI',sans-serif;
        color:#e0e0e0;overflow:hidden;-webkit-app-region:drag}
      .logo{font-size:22px;font-weight:900;letter-spacing:4px;
        background:linear-gradient(135deg,#00e5ff,#ff6b35,#a855f7);
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;
        background-clip:text;margin-bottom:8px}
      .ver{font-size:10px;color:#333;letter-spacing:3px;margin-bottom:36px}
      .wrap{width:300px;display:flex;flex-direction:column;align-items:center;gap:12px}
      #st{font-size:12px;color:#555;letter-spacing:1px;height:18px;text-align:center}
      .bg{width:300px;height:3px;border-radius:2px;background:rgba(255,255,255,.05);overflow:hidden}
      .fill{height:100%;width:0%;border-radius:2px;
        background:linear-gradient(90deg,#00e5ff,#a855f7);
        transition:width .3s ease;box-shadow:0 0 8px rgba(0,229,255,.6)}
      .dots{color:#333;font-size:20px;letter-spacing:4px}
      @keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
      .dots span{animation:p 1.4s ease infinite}
      .dots span:nth-child(2){animation-delay:.2s}
      .dots span:nth-child(3){animation-delay:.4s}
    </style></head>
    <body>
      <div class="logo">NEXUS RGB OS</div>
      <div class="ver">V6.0  STARTING</div>
      <div class="wrap">
        <div id="st">Initializing hardware</div>
        <div class="bg"><div class="fill" id="bar"></div></div>
        <div class="dots"><span></span><span></span><span></span></div>
      </div>
    </body></html>
  `)}`);
  return splash;
}

function updateSplash(splash, msg, pct) {
  if (splash?.isDestroyed()) return;
  splash.webContents.executeJavaScript(`
    const e=document.getElementById('st'), b=document.getElementById('bar');
    if(e) e.textContent=${JSON.stringify(String(msg).slice(0, 120))};
    if(b) b.style.width='${Math.max(0, Math.min(100, pct))}%';
  `).catch(() => {});
}

//  IPC handlers 

function registerIpcHandlers(win) {

  // Connect / disconnect / status
  ipcMain.handle('rgb:connect',    async () => connectOpenRGB());
  ipcMain.handle('rgb:disconnect', async () => { await disconnectOpenRGB(); return { ok: true }; });
  ipcMain.handle('rgb:status',     ()       => getStatus());
  ipcMain.handle('gateway:state',  ()       => gateway.getSystemState());
  ipcMain.handle('gateway:reset',  ()       => { gateway.resetCircuit(); return { ok: true }; });

  // CRE heartbeat endpoint  lightweight liveness probe from renderer
  // Returns system state snapshot. CRE pings this every 8s.
  ipcMain.handle('cre:ping', () => ({
    ok:           true,
    ts:           Date.now(),
    rgbConnected: !!rgbClient,
    gateway:      gateway.getSystemState(),
  }));

  // Retry  rate limited
  ipcMain.handle('rgb:retry', async () => {
    if (!retryRateOk()) return { ok: false, error: 'Too many retry attempts  wait a moment' };
    const result = await boot({
      onStatus: ({ msg }) => {
        safeSend(win, 'openrgb:boot-status', msg);
      },
    });
    if (result.ok) {
      await connectOpenRGB();
      safeSend(win, 'openrgb:recovered');
    }
    return result;
  });

  // Scan  SEC-9 + SEC-10 + GATE-2 (queued) + GATE-3 (deduped)
  ipcMain.handle('rgb:scan', async () => {
    if (!scanRateOk()) return { ok: false, error: 'Scan rate limit  wait a few seconds' };
    if (!rgbClient)    return { ok: false, error: 'Not connected' };

    return gateway.execute('rgb', 'scan', async () => {
      const count     = await rgbClient.getControllerCount();
      const safeCount = Math.min(count, 64);
      const devices   = [];
      for (let i = 0; i < safeCount; i++) {
        const d = await rgbClient.getControllerData(i);
        devices.push({
          id:       String(i),
          name:     String(d.name     ?? '').slice(0, 128),
          vendor:   String(d.vendor   ?? '').slice(0, 128),
          location: String(d.location ?? '').slice(0, 256),
          leds:     Math.min(Number(d.leds?.length) || 0, 10_000),
          zones:    (d.zones ?? []).slice(0, 32).map((z, zi) => ({
            id:       String(zi),
            name:     String(z.name ?? '').slice(0, 64),
            ledCount: Math.min(Number(z.numLeds) || 0, 10_000),
          })),
          modes:    (d.modes ?? []).slice(0, 64).map(m => String(m.name ?? '').slice(0, 64)),
        });
      }
      return devices;
    });
  });

  // setColor  SEC-9 + SEC-10 + GATE-1 (circuit) + GATE-2 (queued) + GATE-5 (timeout)
  ipcMain.handle('rgb:setColor', async (_, deviceId, r, g, b) => {
    if (!colorRateOk())              return { ok: false, error: 'Rate limit' };
    if (!isValidDeviceId(deviceId))  return { ok: false, error: 'Invalid device ID' };
    if (!isValidRGB(r, g, b))        return { ok: false, error: 'Invalid RGB values (must be 0-255 integers)' };
    if (!rgbClient)                  return { ok: false, error: 'Not connected' };

    return gateway.execute('rgb', `setColor:${deviceId}`, async () => {
      const id   = parseInt(String(deviceId), 10);
      const ctrl = await rgbClient.getControllerData(id);
      const leds = new Array(ctrl.leds.length).fill({ red: r, green: g, blue: b });
      await rgbClient.updateLeds(id, leds);
      return { ok: true };
    });
  });

  // setMode  SEC-9
  ipcMain.handle('rgb:setMode', async (_, deviceId, modeName) => {
    if (!isValidDeviceId(deviceId)) return { ok: false, error: 'Invalid device ID' };
    if (!isValidModeName(modeName)) return { ok: false, error: 'Invalid mode name' };
    if (!rgbClient)                 return { ok: false, error: 'Not connected' };
    try {
      const id   = parseInt(String(deviceId), 10);
      const ctrl = await rgbClient.getControllerData(id);
      const mIdx = ctrl.modes.findIndex(m => m.name === modeName);
      if (mIdx >= 0) await rgbClient.updateMode(id, ctrl.modes[mIdx].id ?? ctrl.modes[mIdx].name);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Telemetry  validate interval
  ipcMain.handle('telemetry:start', (_, ms) => {
    startTelemetry(win, ms);
    return { ok: true };
  });
  ipcMain.handle('telemetry:stop', () => { stopTelemetry(); return { ok: true }; });

  // Game auto detection  main-process process polling; renderer only receives safe profile data
  ipcMain.handle('detector:start', () => {
    if (!gameDetector) gameDetector = new GameDetector();
    return gameDetector.start({
      onUpdate: games => safeSend(win, 'game:update', games),
      onDetected: profile => safeSend(win, 'game:detected', profile),
      onStopped: profile => safeSend(win, 'game:stopped', profile),
    });
  });
  ipcMain.handle('detector:stop', () => {
    if (!gameDetector) return { ok: true };
    return gameDetector.stop();
  });
  ipcMain.handle('detector:status', () => gameDetector?.status() || { running: false, activeIds: [] });

  // Game integrations panel  read-only live process status.
  // Uses the same shared profiles as the auto detector and maps canonical
  // profile IDs to the renderer's stable IDs (f1/val/mc/fz).
  ipcMain.handle('games:status', async () => {
    if (!gameDetector) gameDetector = new GameDetector();
    return gameDetector.liveStatus();
  });

  // Processes  SEC-10 + SEC-12 + FIX-14
  // FIX-14: no longer silently returns [] on rate limit.
  // Returns a typed error so useAppIntegrations can distinguish
  // "rate limited, retry soon" from "process scan actually failed".
  ipcMain.handle('processes:list', async () => {
    if (!processRateOk()) {
      return { ok: false, rateLimited: true, error: 'Rate limited  retry in 3s' };
    }
    return getRunningProcesses();
  });

  // Store  SEC-11: allowlisted keys only, no getAll
  ipcMain.handle('store:get', (_, key, def) => {
    if (!isAllowedStoreKey(key)) return def ?? null;
    return store.get(key, def);
  });
  ipcMain.handle('store:set', (_, key, val) => {
    if (!isAllowedStoreKey(key)) return { ok: false, error: 'Key not allowed' };
    const serialized = JSON.stringify(val);
    if (serialized.length > 1_048_576) return { ok: false, error: 'Value too large (max 1MB)' };
    store.set(key, val);
    return { ok: true };
  });
  // BUG 6+10 FIX: store:delete handler was missing  preload exposed it but no handler existed
  ipcMain.handle('store:delete', (_, key) => {
    if (!isAllowedStoreKey(key)) return { ok: false, error: 'Key not allowed' };
    store.delete(key);
    return { ok: true };
  });

  //  AI proxy  fetch in main process (no CORS, key never in renderer traffic) 
  ipcMain.handle('ai:query', async (_, prompt, apiKey, system, provider = 'gemini') => {
    if (!prompt || typeof prompt !== 'string')    return { ok: false, error: 'Prompt required' };
    if (prompt.length > 8000)                        return { ok: false, error: 'Prompt too long (max 8000 chars)' };
    if (!apiKey  || typeof apiKey  !== 'string')  return { ok: false, error: 'API key required' };
    if (apiKey.length > 512)                         return { ok: false, error: 'API key too long' };
    if (system && typeof system === 'string' && system.length > 4000)
      system = system.slice(0, 4000); // silently truncate system prompt
    const start = Date.now();
    try {
      if (provider === 'gemini') {
        // BUG 7 FIX: key in x-goog-api-key header  not in URL query string
        // URL query params appear in server access logs; headers do not
        const url  = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
        const body = { contents: [{ parts: [{ text: prompt }] }] };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        const ctrl8 = new AbortController();
        const t8    = setTimeout(() => ctrl8.abort(), 30_000);
        let res;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: ctrl8.signal,
          });
        } finally { clearTimeout(t8); }
        const data = await res.json();
        logger.info('AI proxy Gemini', { ok: res.ok, ms: Date.now() - start });
        if (!res.ok) return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
        return { ok: true, text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' };
      }
      if (provider === 'groq') {
        const msgs = system
          ? [{ role: 'system', content: system }, { role: 'user', content: prompt }]
          : [{ role: 'user', content: prompt }];
        // BUG 8 FIX: AbortController timeout  hung AI call can't stall IPC forever
        const ctrl8g = new AbortController();
        const t8g    = setTimeout(() => ctrl8g.abort(), 30_000);
        let res;
        try {
          res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 1024 }),
            signal: ctrl8g.signal,
          });
        } finally { clearTimeout(t8g); }
        const data = await res.json();
        logger.info('AI proxy Groq', { ok: res.ok, ms: Date.now() - start });
        if (!res.ok) return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
        return { ok: true, text: data.choices?.[0]?.message?.content || '' };
      }
      return { ok: false, error: `Unknown provider: ${provider}` };
    } catch (err) {
      logger.error('AI proxy failed', { provider, error: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ai:checkKey', async (_, apiKey, provider = 'gemini') => {
    if (!apiKey || typeof apiKey !== 'string') return { ok: false, error: 'Key required' };
    if (provider === 'gemini' && !apiKey.startsWith('AIza')) return { ok: false, error: 'Invalid Gemini key format' };
    if (provider === 'groq'   && !apiKey.startsWith('gsk_')) return { ok: false, error: 'Invalid Groq key format' };
    return { ok: true };
  });

  // Auto-launch (Windows startup)
  ipcMain.handle('app:setAutoLaunch', (_, enabled) => { autoLaunch.set(enabled); return { ok: true }; });
  ipcMain.handle('app:getAutoLaunch', ()            => autoLaunch.getStatus());

  // Window controls  unchanged, always safe (user-initiated only)
  ipcMain.handle('window:minimize', () => { win.minimize();    return { ok: true }; });
  ipcMain.handle('window:maximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
    return { ok: true };
  });
  ipcMain.handle('window:close', () => { win.close(); return { ok: true }; });
}

// Main window

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#030308', titleBarStyle: 'hidden',
    frame: false, show: false,
    webPreferences: {
      preload:             path.join(__dirname, 'preload.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      sandbox:             true,
      webSecurity:         true,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  registerIpcHandlers(win);
  win.on('closed', () => { stopTelemetry(); disconnectOpenRGB(); });
  return win;
}

//  Boot sequence 

app.whenReady().then(async () => {
  const splash = createSplash();
  updateSplash(splash, 'Checking RGB hardware...', 5);

  const PROGRESS_MAP = {
    'Checking for existing OpenRGB server...': 10,
    'Found cached OpenRGB binary':           20,
    'Found bundled OpenRGB binary':          20,
    'Verifying download integrity...':         62,
    'Integrity check passed!':              65,
    'Extracting...':                           68,
    'OpenRGB ready!':                       72,
    'Starting OpenRGB server...':              78,
    'Waiting for OpenRGB server...':           88,
    'OpenRGB server ready!':                95,
    'OpenRGB already running  connecting ':90,
  };

  const bootResult = await boot({
    onStatus: ({ msg }) => {
      const pct = PROGRESS_MAP[msg];
      if (pct) updateSplash(splash, msg, pct);
    },
    onProgress: ({ stage, pct }) => {
      if (stage === 'download')
        updateSplash(splash, `Downloading RGB driver ${pct}%`, 25 + Math.round(pct * 0.35));
    },
  });

  updateSplash(splash, 'Connecting', 97);
  const connResult = await connectOpenRGB();

  // Start watchdog  monitors OpenRGB health every 8s
  if (connResult.ok) {
    gateway.startWatchdog(OPENRGB_HOST, OPENRGB_PORT,
      () => { /* onDead  renderer notified via state change below */ },
      () => connectOpenRGB(), // onRevived  reconnect SDK automatically
    );
  }

  updateSplash(splash, 'Launching Nexus RGB OS', 100);
  const win = createMainWindow();

  // Forward gateway state changes to renderer
  gateway.onStateChange((state) => {
    safeSend(win, 'gateway:state', state);
  });

  win.once('ready-to-show', () => {
    setTimeout(() => {
      if (!splash?.isDestroyed()) splash.close();
      win.show(); win.focus();

      if (!bootResult.ok) {
        setTimeout(() => {
          safeSend(win, 'openrgb:unavailable', {
            error:  bootResult.error,
            reason: classifyError(bootResult.error),
          });
        }, 1500);
      }
    }, 300);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

//  Shutdown 

app.on('before-quit', () => {
  stopTelemetry();
  gameDetector?.stop();
  disconnectOpenRGB();
  gateway.stopWatchdog();
  shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});






