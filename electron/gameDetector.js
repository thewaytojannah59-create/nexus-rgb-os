const si = require('systeminformation');
const GAME_PROFILES = require('../shared/gameProfiles.json');

const POLL_INTERVAL_MS = 3000;

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

class GameDetector {
  constructor() {
    this.timer = null;
    this.running = false;
    this.activeIds = new Set();
    this.onUpdate = null;
    this.onDetected = null;
    this.onStopped = null;
  }

  async scan() {
    let names;
    try {
      const result = await si.processes();
      names = new Set((result.list || [])
        .map(p => normalizeName(p.name))
        .filter(Boolean));
    } catch (err) {
      return { ok: false, error: `Process scan failed: ${String(err?.message || err).slice(0, 160)}` };
    }

    const active = GAME_PROFILES.filter(profile =>
      profile.processes.some(proc => names.has(normalizeName(proc)))
    );
    const nextIds = new Set(active.map(p => p.id));

    for (const profile of active) {
      if (!this.activeIds.has(profile.id)) this.onDetected?.(profile);
    }
    for (const id of this.activeIds) {
      if (!nextIds.has(id)) {
        const profile = GAME_PROFILES.find(p => p.id === id);
        if (profile) this.onStopped?.(profile);
      }
    }

    this.activeIds = nextIds;
    this.onUpdate?.(active);
    return { ok: true, games: active };
  }

  start(callbacks = {}) {
    if (this.running) return { ok: true, alreadyRunning: true };
    this.running = true;
    this.onUpdate = callbacks.onUpdate;
    this.onDetected = callbacks.onDetected;
    this.onStopped = callbacks.onStopped;

    this.scan();
    this.timer = setInterval(() => this.scan(), POLL_INTERVAL_MS);
    return { ok: true };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.activeIds.clear();
    this.onUpdate = null;
    this.onDetected = null;
    this.onStopped = null;
    return { ok: true };
  }

  status() {
    return { running: this.running, activeIds: [...this.activeIds] };
  }

  async liveStatus() {
    let names;
    try {
      const result = await si.processes();
      names = new Set((result.list || [])
        .map(p => normalizeName(p.name))
        .filter(Boolean));
    } catch (err) {
      return { ok: false, error: `Process scan failed: ${String(err?.message || err).slice(0, 160)}` };
    }

    // Keep the UI's historical IDs stable while the shared detector profiles
    // use their own canonical IDs. This prevents a backend/profile rename
    // from breaking GameIntegrationsPanel.
    const aliases = {
      f1_24: 'f1',
      valorant: 'val',
      minecraft: 'mc',
      forza: 'fz',
    };

    const status = {};
    for (const profile of GAME_PROFILES) {
      const running = profile.processes.some(proc => names.has(normalizeName(proc)));
      status[aliases[profile.id] || profile.id] = running;
    }
    return { ok: true, status };
  }
}

module.exports = { GameDetector, GAME_PROFILES };
