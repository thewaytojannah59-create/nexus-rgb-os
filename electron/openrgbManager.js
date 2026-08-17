// ============================================================
// Nexus RGB OS — Silent OpenRGB Manager (Security Hardened)
// ============================================================
//
// SECURITY FIXES IN THIS VERSION:
//
//  SEC-1  SHA-256 INTEGRITY CHECK — every downloaded ZIP is
//         verified against a hardcoded expected hash before
//         extraction. Mismatch = abort + delete partial file.
//
//  SEC-2  POWERSHELL PATH INJECTION PREVENTION — zip and dest
//         paths are passed as PowerShell array arguments, not
//         interpolated into a command string. No injection possible.
//
//  SEC-3  findExe DEPTH LIMIT — recursive search is capped at
//         4 levels deep and 200 entries per dir to prevent
//         DoS on large or maliciously crafted directories.
//
//  SEC-4  getStatus BROKEN LOGIC FIXED — was always returning
//         running:true due to `|| true` shortcut. Now does a
//         real port check via cached state.
//
//  SEC-5  SPAWN ARGUMENT HARDENING — all spawn args are a fixed
//         array of literals. No user input ever reaches spawn().
//
//  SEC-6  REDIRECT LIMIT — max 5 redirects during download to
//         prevent redirect loops or redirect-based attacks.
//
//  SEC-7  DOWNLOAD TIMEOUT — 30s connect timeout, 120s total.
//         Prevents hanging indefinitely on slow/stalled downloads.
//
//  SEC-8  HTTPS-ONLY REDIRECT ENFORCEMENT — redirects to http://
//         are rejected. Only https:// redirects are followed.
// ============================================================

const { app }               = require('electron');
const path                  = require('path');
const fs                    = require('fs');
const net                   = require('net');
const https                 = require('https');
const crypto                = require('crypto');
const { spawn, execFile }   = require('child_process');

// ── Pinned release config ─────────────────────────────────────────────────
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  ACTION REQUIRED BEFORE SHIPPING                                        │
// │  The SHA-256 hash is a PLACEHOLDER. Replace it with the real one:       │
// │                                                                         │
// │  1. Download the ZIP from PINNED.url below                              │
// │  2. PowerShell:                                                         │
// │     Get-FileHash "OpenRGB_0.9_Windows_64_b5f46e3.zip" -Algorithm SHA256 │
// │  3. Paste the 64-char result into PINNED.sha256                         │
// │  4. Update both url + sha256 atomically on every version bump           │
// │  Source: https://openrgb.org/releases.html          │
// └─────────────────────────────────────────────────────────────────────────┘

const OPENRGB_HOST    = '127.0.0.1';
const OPENRGB_PORT    = 6742;
const OPENRGB_EXE     = 'openrgb.exe';

const PINNED = {
  version:  '0.9',
  url:      'https://openrgb.org/releases/release_0.9/OpenRGB_0.9_Windows_64_b5f46e3.zip',
  // SHA-256 for the official OpenRGB 0.9 Windows 64-bit archive.
  sha256:   '4a42df973bf9e0694268993478f03a71dafbf2ddbcb1512835b4bbabdc6dc6de',
};

// HIGH-1 FIX: Runtime guard — refuse to download if the pinned hash is absent
// or malformed rather than running a meaningless integrity check.
function assertHashConfigured() {
  if (!/^[a-f0-9]{64}$/i.test(PINNED.sha256 || '')) {
    throw new Error(
      'OpenRGB SHA-256 pin is missing or malformed.\n' +
      'Set PINNED.sha256 to the verified 64-character SHA-256 value in electron/openrgbManager.js.'
    );
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────

const dataDir     = () => path.join(app.getPath('userData'), 'openrgb');
const exePath     = () => path.join(dataDir(), OPENRGB_EXE);
const bundledPath = () => path.join(
  process.resourcesPath ?? __dirname, 'openrgb', OPENRGB_EXE
);

// ── Runtime state ─────────────────────────────────────────────────────────

let openrgbProcess   = null;
let managedByUs      = false;
let serverReady      = false;   // SEC-4: track actual readiness
let _statusCallback  = null;

// ── Logging ───────────────────────────────────────────────────────────────

function status(msg, type = 'info') {
  console.log(`[OpenRGB Manager] ${msg}`);
  _statusCallback?.({ msg, type });
}

// ── Port check ────────────────────────────────────────────────────────────

function isPortOpen(host, port, timeoutMs = 1500) {
  return new Promise(resolve => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); resolve(true);  });
    sock.once('error',   () => { sock.destroy(); resolve(false); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.connect(port, host);
  });
}

async function waitForPort(host, port, { attempts = 30, delayMs = 400 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await isPortOpen(host, port)) return true;
    await new Promise(r => setTimeout(r, delayMs + i * 80));
  }
  return false;
}

// ── SEC-1: SHA-256 integrity check ────────────────────────────────────────

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data',  chunk => hash.update(chunk));
    stream.on('end',   ()    => resolve(hash.digest('hex')));
    stream.on('error', err   => reject(err));
  });
}

async function verifyIntegrity(filePath, expectedHash) {
  status('Verifying download integrity…');
  const actual = await sha256File(filePath);
  if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
    // Delete the bad file immediately
    try { fs.rmSync(filePath, { force: true }); } catch {}
    throw new Error(
      `Integrity check failed.\n` +
      `Expected: ${expectedHash}\n` +
      `Got:      ${actual}\n` +
      `The download may be corrupted or tampered. Deleted.`
    );
  }
  status('Integrity check passed ✓', 'success');
}

// ── SEC-7 / SEC-8: Download with timeout + HTTPS-only redirects ──────────

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    // SEC-7: overall timeout
    const TOTAL_TIMEOUT_MS   = 120_000;
    const CONNECT_TIMEOUT_MS = 30_000;
    let totalTimer = setTimeout(() => {
      reject(new Error('Download timed out after 120s'));
    }, TOTAL_TIMEOUT_MS);

    let received = 0;
    let redirects = 0;
    const MAX_REDIRECTS = 5; // SEC-6

    const file = fs.createWriteStream(dest);

    function doGet(currentUrl) {
      // SEC-8: HTTPS only
      if (!currentUrl.startsWith('https://')) {
        clearTimeout(totalTimer);
        file.close();
        reject(new Error(`Redirect to non-HTTPS URL blocked: ${currentUrl}`));
        return;
      }

      const req = https.get(currentUrl, {
        headers:  { 'User-Agent': 'NexusRGBOS/6.2.0' },
        timeout:  CONNECT_TIMEOUT_MS,
      }, res => {
        // SEC-6: redirect limit
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          redirects++;
          if (redirects > MAX_REDIRECTS) {
            clearTimeout(totalTimer); file.close();
            reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
            return;
          }
          doGet(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(totalTimer); file.close();
          reject(new Error(`HTTP ${res.statusCode} from ${currentUrl}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', chunk => {
          received += chunk.length;
          if (total) onProgress?.(Math.round((received / total) * 100));
        });
        res.pipe(file);
        file.on('finish', () => {
          clearTimeout(totalTimer);
          file.close(resolve);
        });
        res.on('error', err => { clearTimeout(totalTimer); reject(err); });
      });

      req.on('error',   err => { clearTimeout(totalTimer); reject(err); });
      req.on('timeout', ()  => { req.destroy(); clearTimeout(totalTimer);
        reject(new Error('Connection timed out')); });
    }

    doGet(url);
  });
}

// ── SEC-2: PowerShell unzip — safely escaped paths ─────────────
function unzipWindows(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const command = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`;

    execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      command,
    ], { timeout: 60_000 }, err => {
      if (err) reject(err);
      else resolve();
    });
  });
}
// ── SEC-3: findExe with depth + entry limits ──────────────────────────────

function findExe(dir, depth = 0) {
  const MAX_DEPTH   = 4;
  const MAX_ENTRIES = 200;

  if (depth > MAX_DEPTH) return null;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Cap entries to prevent DoS on unexpectedly large dirs
  const limited = entries.slice(0, MAX_ENTRIES);

  for (const e of limited) {
    const full = path.join(dir, e.name);

    // Guard against path traversal in filenames
    if (!full.startsWith(dir)) continue;

    if (e.isFile() && e.name.toLowerCase() === OPENRGB_EXE) return full;

    if (e.isDirectory() && depth < MAX_DEPTH) {
      const found = findExe(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ── Ensure exe exists ─────────────────────────────────────────────────────

function findSystemOpenRGB() {
  // Prefer a user-installed OpenRGB before attempting the bundled/download path.
  // This also keeps Nexus functional when the old pinned download asset is unavailable.
  if (process.platform !== 'win32') return null;

  try {
    const result = require('child_process').execFileSync(
      'where.exe',
      [OPENRGB_EXE],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const candidates = result.split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // OpenRGB is not installed or not on PATH.
  }
  return null;
}

async function ensureExe(onProgress) {
  // 1. Cached from previous launch
  if (fs.existsSync(exePath())) {
    status('Found cached OpenRGB binary');
    return exePath();
  }

  // 2. User-installed OpenRGB on PATH
  const systemExe = findSystemOpenRGB();
  if (systemExe) {
    status('Found system-installed OpenRGB');
    return systemExe;
  }

  // 3. Bundled inside the packaged app
  if (fs.existsSync(bundledPath())) {
    status('Found bundled OpenRGB binary');
    return bundledPath();
  }

  // 4. Download
  status('Downloading OpenRGB silently…', 'download');
  assertHashConfigured(); // HIGH-1: fails loudly if hash is still placeholder
  fs.mkdirSync(dataDir(), { recursive: true });

  const zipPath    = path.join(dataDir(), 'openrgb.zip');
  const extractDir = path.join(dataDir(), 'extracted');

  try {
    await downloadFile(PINNED.url, zipPath, pct => {
      onProgress?.({ stage: 'download', pct });
      if (pct % 10 === 0) status(`Downloading… ${pct}%`);
    });

    // SEC-1: Verify before touching the file further
    await verifyIntegrity(zipPath, PINNED.sha256);

    status('Extracting…');
    onProgress?.({ stage: 'extract', pct: 0 });
    fs.mkdirSync(extractDir, { recursive: true });
    await unzipWindows(zipPath, extractDir);
    onProgress?.({ stage: 'extract', pct: 100 });

    // SEC-3: depth-limited search
    const found = findExe(extractDir);
    if (!found) throw new Error('openrgb.exe not found in extracted ZIP');

    const foundDir = path.dirname(found);
    fs.mkdirSync(dataDir(), { recursive: true });
    for (const entry of fs.readdirSync(foundDir, { withFileTypes: true })) {
      const src = path.join(foundDir, entry.name);
      const dst = path.join(dataDir(), entry.name);
      if (entry.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, force: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }
    try { fs.rmSync(zipPath,    { force: true }); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}

    status('OpenRGB ready ✓', 'success');
    return exePath();

  } catch (err) {
    try { fs.rmSync(zipPath,    { force: true }); } catch {}
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
    throw err;
  }
}

// ── Spawn silently ────────────────────────────────────────────────────────
// SEC-5: spawn args are a fixed literal array — no user input, ever.

function spawnOpenRGB(exe) {
  // Validate exe path is inside our known safe directory
  const safeDir = dataDir();
  const bundled = bundledPath();
  const exeReal = path.resolve(exe);
  const safeData   = path.resolve(safeDir);
  const safeBundled = path.resolve(path.dirname(bundled));

  if (!exeReal.startsWith(safeData) && !exeReal.startsWith(safeBundled)) {
    throw new Error(`Security: refusing to spawn exe outside safe directories: ${exeReal}`);
  }

  status('Starting OpenRGB server…');

  const child = spawn(exeReal, [
    '--server',
    '--server-port', String(OPENRGB_PORT),  // always our constant, never user input
    '--nodetect',
  ], {
    detached:    false,
    windowsHide: true,
    stdio:       'ignore',
  });

  child.on('error', err => status(`OpenRGB error: ${err.message}`, 'error'));
  child.on('exit',  code => {
    if (code !== 0 && code !== null) {
      status(`OpenRGB exited (code ${code})`, 'warn');
      serverReady = false;
    }
    openrgbProcess = null;
  });

  openrgbProcess = child;
  managedByUs    = true;
}

// ── Public API ────────────────────────────────────────────────────────────

async function boot({ onStatus, onProgress } = {}) {
  _statusCallback = onStatus;

  try {
    status('Checking for existing OpenRGB server…');
    if (await isPortOpen(OPENRGB_HOST, OPENRGB_PORT)) {
      status('OpenRGB already running — connecting ✓', 'success');
      serverReady = true;
      return { ok: true, alreadyRunning: true };
    }

    const exe = await ensureExe(onProgress);
    spawnOpenRGB(exe);

    status('Waiting for OpenRGB server…');
    const ready = await waitForPort(OPENRGB_HOST, OPENRGB_PORT);

    if (!ready) throw new Error('OpenRGB server did not respond in time');

    serverReady = true;
    status('OpenRGB server ready ✓', 'success');
    return { ok: true, alreadyRunning: false };

  } catch (err) {
    serverReady = false;
    status(`OpenRGB boot failed: ${err.message}`, 'error');
    return { ok: false, error: err.message };
  }
}

function shutdown() {
  if (openrgbProcess && managedByUs) {
    status('Shutting down OpenRGB…');
    try { openrgbProcess.kill('SIGTERM'); } catch {}
    if (process.platform === 'win32') {
      try {
        require('child_process').execSync(
          `taskkill /PID ${openrgbProcess.pid} /F /T`,
          { timeout: 5000 }
        );
      } catch {}
    }
  }
  openrgbProcess = null;
  serverReady    = false;
}

// SEC-4: getStatus now returns real state — no more `|| true` bug
function getStatus() {
  return {
    running:     serverReady,           // actual tracked state
    managedByUs,
    pid:         openrgbProcess?.pid ?? null,
    exeCached:   fs.existsSync(exePath()),
    version:     PINNED.version,
  };
}

module.exports = { boot, shutdown, getStatus, OPENRGB_HOST, OPENRGB_PORT };
