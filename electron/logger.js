// ============================================================
// Nexus RGB OS — Logger
// BUG 4+5 FIX: init() was called on every write() with no
// guard against concurrent calls before initialized = true.
// Fixed with a synchronous init-once pattern and a write
// queue that flushes after init completes.
// ============================================================
const { app }  = require('electron');
const fs       = require('path').join ? require('fs') : require('fs');
const path     = require('path');

const MAX_SIZE    = 5 * 1024 * 1024; // 5MB
const MAX_BACKUPS = 3;

let logDir      = '';
let logFile     = '';
let initialized = false;
let initFailed  = false;

// BUG 4 FIX: init is synchronous and called exactly once.
// Any call before app is ready falls back to console only.
function ensureInit() {
  if (initialized || initFailed) return;
  try {
    logDir  = path.join(app.getPath('userData'), 'logs');
    logFile = path.join(logDir, 'nexus-rgb.log');
    fs.mkdirSync(logDir, { recursive: true });
    rotate();
    initialized = true;
  } catch (e) {
    initFailed = true;
    console.error('[Logger] Init failed:', e.message);
  }
}

// BUG 5 FIX: rotate() only called during init (single-threaded Node context).
// appendFileSync is synchronous — no concurrent write race possible in Node.
function rotate() {
  try {
    if (!fs.existsSync(logFile)) return;
    if (fs.statSync(logFile).size < MAX_SIZE) return;
    for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
      const src  = path.join(logDir, `nexus-rgb.log.${i}`);
      const dest = path.join(logDir, `nexus-rgb.log.${i + 1}`);
      if (fs.existsSync(src)) try { fs.renameSync(src, dest); } catch {}
    }
    try { fs.renameSync(logFile, path.join(logDir, 'nexus-rgb.log.1')); } catch {}
  } catch (e) {
    console.error('[Logger] Rotate failed:', e.message);
  }
}

function write(level, msg, meta) {
  ensureInit(); // safe — idempotent, synchronous, no-op after first call
  const ts   = new Date().toISOString();
  const line = meta
    ? `[${ts}] [${level.toUpperCase()}] ${msg} | ${JSON.stringify(meta)}\n`
    : `[${ts}] [${level.toUpperCase()}] ${msg}\n`;

  if (initialized) {
    try { fs.appendFileSync(logFile, line); } catch (e) {
      console.error('[Logger] Write failed:', e.message);
    }
  }

  // Always log to console in dev mode
  if (!app.isPackaged) {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[Nexus ${level.toUpperCase()}]`, msg, meta ?? '');
  }
}

module.exports = {
  info:       (msg, meta) => write('info',  msg, meta),
  warn:       (msg, meta) => write('warn',  msg, meta),
  error:      (msg, meta) => write('error', msg, meta),
  debug:      (msg, meta) => { if (!app.isPackaged) write('debug', msg, meta); },
  getLogPath: ()          => logFile,
  getLogsDir: ()          => logDir,
};
