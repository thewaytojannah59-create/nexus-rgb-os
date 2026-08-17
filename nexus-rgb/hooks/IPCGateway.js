// ═══════════════════════════════════════════════════════════════════════════
// IPC GATEWAY — Nexus RGB OS (Hardened)
// ═══════════════════════════════════════════════════════════════════════════
//
// FIXES IN THIS VERSION:
//
//  FIX-8  SECURITY: callLog was storing raw payload in every entry.
//         An ai.query call would log the full API key. Fixed: payloads
//         are NEVER stored in the log. Only channel + status + timestamp.
//
//  FIX-12 SECURITY: store.getAll exposed via _dispatch switch case,
//         allowing renderer to dump entire persistent store. Removed.
//         The channel header comment and dispatcher both cleaned up.
//
//  FIX-13 PERF: RateLimiter._buckets Map grew unbounded — one entry per
//         channel forever, each with a calls[] array that kept old
//         timestamps. Fixed: buckets are pruned on every check, and the
//         Map is capped at 64 channels to prevent unbounded growth.
// ═══════════════════════════════════════════════════════════════════════════

const RATE_LIMITS = {
  'rgb.setColor':    { max: 30, windowMs: 500   },
  'rgb.setMode':     { max: 30, windowMs: 500   },
  'rgb.setAllColor': { max: 15, windowMs: 500   },
  'rgb.scan':        { max: 1,  windowMs: 2000  },
  'rgb.connect':     { max: 3,  windowMs: 5000  },
  'ai.query':        { max: 3,  windowMs: 10000 },
  'store.set':       { max: 20, windowMs: 1000  },
  'store.delete':    { max: 10, windowMs: 1000  },
  'processes.list':  { max: 1,  windowMs: 2000  },
  _default:          { max: 10, windowMs: 1000  },
};

// ── Validators ────────────────────────────────────────────────────────────

const VALIDATORS = {
  'rgb.setColor': ({ id, r, g, b }) => {
    if (typeof id !== 'string' || !id.trim())    return fail('Device ID must be a non-empty string');
    if (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b))
      return fail('RGB values must be integers');
    if ([r, g, b].some(v => v < 0 || v > 255))  return fail('RGB values must be 0–255');
    return ok();
  },
  'rgb.setMode': ({ id, mode }) => {
    if (typeof id   !== 'string' || !id.trim())  return fail('Device ID must be a non-empty string');
    if (typeof mode !== 'string' || !mode.trim()) return fail('Mode must be a non-empty string');
    if (mode.length > 64)                        return fail('Mode name too long (max 64 chars)');
    return ok();
  },
  'rgb.setAllColor': ({ r, g, b }) => {
    if (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b))
      return fail('RGB values must be integers');
    if ([r, g, b].some(v => v < 0 || v > 255))  return fail('RGB values must be 0–255');
    return ok();
  },
  'store.set': ({ key, value }) => {
    if (typeof key !== 'string' || !key.trim())  return fail('Store key must be a non-empty string');
    if (key.length > 128)                        return fail('Store key too long (max 128 chars)');
    if (!/^[a-zA-Z0-9_:.\\-]+$/.test(key))      return fail(`Store key invalid chars: "${key}"`);
    if (value === undefined)                     return fail('Store value cannot be undefined');
    try {
      if (JSON.stringify(value).length > 512_000) return fail('Store value too large (max 512 KB)');
    } catch { return fail('Store value must be JSON-serializable'); }
    return ok();
  },
  'store.delete': ({ key }) => {
    if (typeof key !== 'string' || !key.trim())  return fail('Store key must be a non-empty string');
    if (!/^[a-zA-Z0-9_:.\\-]+$/.test(key))      return fail(`Store key invalid chars: "${key}"`);
    return ok();
  },
  'store.get': ({ key }) => {
    if (typeof key !== 'string' || !key.trim())  return fail('Store key must be a non-empty string');
    return ok();
  },
  'ai.query': ({ prompt, apiKey, provider = 'gemini' }) => {
    if (typeof prompt !== 'string' || !prompt.trim()) return fail('Prompt must be a non-empty string');
    if (prompt.length > 4000)                    return fail('Prompt too long (max 4000 chars)');
    if (typeof apiKey !== 'string' || apiKey.length < 8) return fail('API key appears invalid');
    if (!['gemini', 'groq'].includes(provider)) return fail('Unsupported AI provider');
    return ok();
  },
  'ai.checkKey': ({ apiKey, provider = 'gemini' }) => {
    if (typeof apiKey !== 'string' || apiKey.length < 8) return fail('API key appears invalid');
    if (!['gemini', 'groq'].includes(provider)) return fail('Unsupported AI provider');
    return ok();
  },
};

// ── Sanitizers ────────────────────────────────────────────────────────────

const SANITIZERS = {
  'rgb.setColor':    (p) => ({
    id: String(p.id).trim(),
    r:  Math.round(Math.max(0, Math.min(255, p.r))),
    g:  Math.round(Math.max(0, Math.min(255, p.g))),
    b:  Math.round(Math.max(0, Math.min(255, p.b))),
  }),
  'rgb.setAllColor': (p) => ({
    r: Math.round(Math.max(0, Math.min(255, p.r))),
    g: Math.round(Math.max(0, Math.min(255, p.g))),
    b: Math.round(Math.max(0, Math.min(255, p.b))),
  }),
  'rgb.setMode':  (p) => ({ id: String(p.id).trim(), mode: String(p.mode).trim().slice(0, 64) }),
  'store.set':    (p) => ({ key: String(p.key).trim(), value: p.value }),
  'store.get':    (p) => ({ key: String(p.key).trim() }),
  'store.delete': (p) => ({ key: String(p.key).trim() }),
  'ai.query':     (p) => ({
    prompt:   String(p.prompt).trim().slice(0, 4000),
    apiKey:   String(p.apiKey).trim(),       // sanitized but NEVER logged
    system:   p.system ? String(p.system).trim().slice(0, 2000) : undefined,
    provider: ['gemini', 'groq'].includes(p.provider) ? p.provider : 'gemini',
  }),
  'ai.checkKey': (p) => ({
    apiKey: String(p.apiKey).trim(),
    provider: ['gemini', 'groq'].includes(p.provider) ? p.provider : 'gemini',
  }),
};

// ── FIX-13: Rate limiter with bounded bucket map ──────────────────────────

class RateLimiter {
  constructor() {
    this._buckets  = new Map();
    this._MAX_KEYS = 64; // prevent unbounded growth
  }

  check(channel) {
    const config = RATE_LIMITS[channel] ?? RATE_LIMITS._default;
    const now    = Date.now();

    // FIX-13: cap number of tracked channels
    if (!this._buckets.has(channel)) {
      if (this._buckets.size >= this._MAX_KEYS) {
        // Evict the oldest entry (first inserted — Maps preserve insertion order)
        const firstKey = this._buckets.keys().next().value;
        this._buckets.delete(firstKey);
      }
      this._buckets.set(channel, []);
    }

    let calls = this._buckets.get(channel);

    // Prune expired timestamps — keeps array tiny between calls
    calls = calls.filter(ts => now - ts < config.windowMs);
    this._buckets.set(channel, calls); // write pruned array back

    if (calls.length >= config.max) {
      const resetInMs = config.windowMs - (now - calls[0]);
      return {
        allowed: false, resetInMs,
        reason: `Rate limit: ${config.max}/${config.windowMs}ms on "${channel}" (resets in ${Math.ceil(resetInMs)}ms)`,
      };
    }

    calls.push(now);
    return { allowed: true };
  }

  remaining(channel) {
    const config = RATE_LIMITS[channel] ?? RATE_LIMITS._default;
    const now    = Date.now();
    const calls  = (this._buckets.get(channel) ?? []).filter(ts => now - ts < config.windowMs);
    return Math.max(0, config.max - calls.length);
  }
}

// ── FIX-8: Call log — NO payload stored, ever ────────────────────────────

class CallLog {
  constructor(maxEntries = 200) {
    this._log = [];
    this._max = maxEntries;
  }

  // FIX-8: only channel + status + timestamp logged.
  // Payload is NEVER stored — prevents API key / color data leaks.
  push(channel, status, error = null) {
    const entry = { ts: Date.now(), channel, status };
    if (error) entry.error = error;
    this._log.push(entry);
    if (this._log.length > this._max) this._log.shift();
  }

  getLast(n = 20) { return this._log.slice(-n); }
  getAll()        { return [...this._log]; }
}

// ── Gateway ───────────────────────────────────────────────────────────────

class IPCGateway {
  constructor() {
    this._rl      = new RateLimiter();
    this._log     = new CallLog(200);
    this._enabled = true;
  }

  async call(channel, payload = {}) {
    if (!this._enabled)
      return { ok: false, error: 'Gateway disabled' };

    // Rate limit
    const rl = this._rl.check(channel);
    if (!rl.allowed) {
      this._log.push(channel, 'rate_limited', rl.reason); // FIX-8: no payload
      console.warn(`[IPCGateway] ${rl.reason}`);
      return { ok: false, error: rl.reason, rateLimited: true, resetInMs: rl.resetInMs };
    }

    // Validate
    const validator = VALIDATORS[channel];
    if (validator) {
      const result = validator(payload);
      if (!result.ok) {
        this._log.push(channel, 'rejected', result.reason); // FIX-8: no payload
        console.warn(`[IPCGateway] Rejected "${channel}": ${result.reason}`);
        return { ok: false, error: result.reason, validationFailed: true };
      }
    }

    // Sanitize
    const safe = (SANITIZERS[channel] ?? (p => p))(payload);

    this._log.push(channel, 'dispatched'); // FIX-8: no payload

    try {
      const result = await this._dispatch(channel, safe);
      this._log.push(channel, 'ok');
      return result;
    } catch (err) {
      this._log.push(channel, 'error', err.message);
      console.error(`[IPCGateway] "${channel}" threw:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  _dispatch(channel, p) {
    const nx = typeof window !== 'undefined' ? window.NexusOS : null;
    if (!nx) return Promise.resolve({ ok: false, error: 'NexusOS not available (not in Electron)' });

    switch (channel) {
      case 'rgb.connect':     return nx.rgb.connect();
      case 'rgb.disconnect':  return nx.rgb.disconnect();
      case 'rgb.scan':        return nx.rgb.scan();
      case 'rgb.setColor':    return nx.rgb.setColor(p.id, p.r, p.g, p.b);
      case 'rgb.setMode':     return nx.rgb.setMode(p.id, p.mode);
      case 'rgb.setAllColor': return nx.rgb.setAllColor(p.r, p.g, p.b);
      case 'telemetry.start': return Promise.resolve(nx.telemetry.start(p.intervalMs ?? 1500));
      case 'telemetry.stop':  return Promise.resolve(nx.telemetry.stop());
      case 'store.get':       return nx.store.get(p.key);
      case 'store.set':       return nx.store.set(p.key, p.value);
      case 'store.delete':    return nx.store.delete?.(p.key) ?? Promise.resolve({ ok: true });
      // FIX-12: store.getAll REMOVED — renderer cannot dump the full store
      case 'processes.list':  return nx.processes.list();
      case 'ai.query':        return nx.ai.query(p.prompt, p.apiKey, p.system, p.provider);
      case 'ai.checkKey':     return nx.ai.checkKey(p.apiKey, p.provider);
      case 'gateway.state':   return nx.gateway.getState();
      case 'gateway.reset':   return nx.gateway.resetCircuit();
      case 'window.minimize': return Promise.resolve(nx.window.minimize());
      case 'window.maximize': return Promise.resolve(nx.window.maximize());
      case 'window.close':    return Promise.resolve(nx.window.close());
      default:
        return Promise.resolve({ ok: false, error: `Unknown channel: "${channel}"` });
    }
  }

  getLog()             { return this._log.getAll(); }
  getRecentLog(n = 20) { return this._log.getLast(n); }
  remaining(channel)   { return this._rl.remaining(channel); }
  disable()            { this._enabled = false; }
  enable()             { this._enabled = true; }
}

function ok()         { return { ok: true }; }
function fail(reason) { return { ok: false, reason }; }

export const Gateway = new IPCGateway();
export default Gateway;
