// ============================================================
// Nexus RGB OS — Profile System
// Save, load, export, import lighting profiles.
// Persisted via Electron Store (real disk) or localStorage fallback.
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron;

// Storage helpers
// Store operations are passed in as callbacks from App/engine
// so ProfileSystem never calls window.NexusOS directly.
// See: loadProfiles / saveProfilesToDisk / deleteProfileFromDisk below — 
// these are now factory functions that accept bridge methods.

function makeStoreOps(bridge) {
  // Known profile index key — we maintain a list of profile IDs
  // rather than dumping the whole store (storeGetAll was removed for security)
  const INDEX_KEY = 'profile:__index';

  return {
    async load() {
      if (isElectron && bridge?.storeGet) {
        // Load the index of profile IDs first, then load each profile individually
        const index = await bridge.storeGet(INDEX_KEY) ?? [];
        const profiles = await Promise.all(
          index.map(id => bridge.storeGet(`profile:${id}`))
        );
        return profiles.filter(Boolean);
      }
      try { return JSON.parse(localStorage.getItem('nexus-profiles') || '[]'); }
      catch { return []; }
    },
    async save(profiles) {
      if (isElectron && bridge?.storeSet) {
        // Save each profile + update the index
        for (const p of profiles) await bridge.storeSet(`profile:${p.id}`, p);
        await bridge.storeSet(INDEX_KEY, profiles.map(p => p.id));
      } else {
        localStorage.setItem('nexus-profiles', JSON.stringify(profiles));
      }
    },
    async remove(profileId) {
      if (isElectron && bridge?.storeDelete) {
        await bridge.storeDelete(`profile:${profileId}`);
      }
    },
  };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
// ── Profile schema validator ───────────────────────────────────────────────
// Rejects malformed or tampered profile data before it reaches the engine.

const HEX_RE = /^#[0-9a-fA-F]{3,6}$/;
const SAFE_EFFECT_IDS = new Set([
  'static','breathing','rainbow_wave','color_cycle','pulse','heartbeat',
  'aurora','fire','matrix_rain','comet','ripple','ice_storm',
  'starfield','northern_lights','hyperdrive','quantum_pulse','supernova','deep_space',
]);

function validateProfile(p) {
  if (!p || typeof p !== 'object') return 'Not an object';
  if (typeof p.id !== 'string' || !p.id.trim()) return 'Missing id';
  if (typeof p.name !== 'string' || !p.name.trim()) return 'Missing name';
  if (p.name.length > 64) return 'Name too long (max 64 chars)';
  if (!Array.isArray(p.deviceStates)) return 'deviceStates must be an array';
  for (const ds of p.deviceStates) {
    if (typeof ds.id !== 'string') return `Device state missing id`;
    if (ds.color && !HEX_RE.test(ds.color)) return `Invalid hex color: ${ds.color}`;
    if (ds.effect && !SAFE_EFFECT_IDS.has(ds.effect)) return `Unknown effect: ${ds.effect}`;
    if (ds.brightness != null) {
      const b = Number(ds.brightness);
      if (isNaN(b) || b < 0 || b > 100) return `Brightness out of range: ${ds.brightness}`;
    }
  }
  return null; // null = valid
}

function sanitizeProfile(p) {
  return {
    ...p,
    id:           String(p.id).trim().slice(0, 64),
    name:         String(p.name).trim().slice(0, 64),
    icon:         typeof p.icon === 'string' ? p.icon.slice(0, 8) : '🎮',
    deviceStates: p.deviceStates.map(ds => ({
      id:         String(ds.id).trim(),
      color:      HEX_RE.test(ds.color) ? ds.color : '#ff6b35',
      effect:     SAFE_EFFECT_IDS.has(ds.effect) ? ds.effect : 'static',
      brightness: Math.max(0, Math.min(100, Number(ds.brightness) || 80)),
    })),
  };
}



const PROFILE_ICONS = ['🎮','🌊','⚡','🌑','🍭','💻','🌅','❄️','🚀','🎬','📚','💪','🎉','🎨','🔥'];

function ProfileCard({ profile, isActive, onLoad, onDelete, onExport, onRename }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(profile.name);

  return (
    <div style={{
      padding: 16, borderRadius: 12,
      background: isActive ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.03)',
      border: isActive ? '1px solid rgba(0,229,255,0.35)' : '1px solid rgba(255,255,255,0.07)',
      transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 28, flexShrink: 0 }}>{profile.icon || '🎮'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { onRename(profile.id, newName); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }}
                style={{ flex: 1, padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(0,229,255,0.4)', borderRadius: 6, color: '#fff', fontSize: 13, outline: 'none' }}
              />
              <button onClick={() => { onRename(profile.id, newName); setRenaming(false); }} style={smBtn('#00e5ff')}>✓</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{profile.name}</div>
              {isActive && <span style={{ fontSize: 9, color: '#00e5ff', letterSpacing: 1, fontFamily: "'Orbitron',sans-serif" }}>ACTIVE</span>}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
            {profile.deviceCount} device{profile.deviceCount !== 1 ? 's' : ''} · {new Date(profile.savedAt).toLocaleDateString()} {new Date(profile.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          {profile.description && (
            <div style={{ fontSize: 11, color: '#666', marginBottom: 8, fontStyle: 'italic' }}>{profile.description}</div>
          )}
          {/* Colour swatches */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {(profile.colorPreview || []).slice(0, 8).map((color, i) => (
              <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: color, boxShadow: `0 0 4px ${color}88` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => onLoad(profile)} style={smBtn('#00e5ff')}>Load</button>
        <button onClick={() => setRenaming(true)} style={smBtn('#a855f7')}>Rename</button>
        <button onClick={() => onExport(profile)} style={smBtn('#22c55e')}>Export</button>
        {confirmDelete ? (
          <>
            <button onClick={() => { onDelete(profile.id); setConfirmDelete(false); }} style={smBtn('#ef4444')}>Confirm Delete</button>
            <button onClick={() => setConfirmDelete(false)} style={smBtn('#555')}>Cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={smBtn('#666')}>Delete</button>
        )}
      </div>
    </div>
  );
}

function smBtn(color) {
  return {
    padding: '5px 12px', borderRadius: 6, border: `1px solid ${color}44`,
    background: `${color}15`, color, fontSize: 10, fontWeight: 700, cursor: 'pointer',
    fontFamily: "'Orbitron',sans-serif", letterSpacing: 0.5,
  };
}

export default function ProfileSystem({ devices = [], devColors = {}, devEffects = {}, devBrightness = {}, onLoadProfile, notify, bridge = null }) {
  // All store I/O goes through bridge (which routes through IPCGateway)
  const storeOps = React.useMemo(() => makeStoreOps(bridge), [bridge]);

  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newIcon, setNewIcon] = useState('🎮');
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState('');

  useEffect(() => {
    storeOps.load().then(setProfiles);
  }, []);

  const saveProfiles = useCallback(async (updated) => {
    setProfiles(updated);
    await storeOps.save(updated);
  }, []);

  const handleSave = async () => {
    if (!newName.trim()) { notify('Enter a profile name', 'error'); return; }
    setSaving(true);

    const colorPreview = [...new Set(Object.values(devColors))].filter(Boolean);
    const deviceStates = devices.map(d => ({
      id: d.id,
      name: d.name,
      vendor: d.vendor,
      color: devColors[d.id] || '#ff6b35',
      effect: devEffects[d.id] || 'static',
      brightness: devBrightness[d.id] || 80,
    }));

    const profile = {
      id: generateId(),
      name: newName.trim(),
      description: newDesc.trim(),
      icon: newIcon,
      savedAt: Date.now(),
      deviceCount: devices.length,
      colorPreview,
      deviceStates,
      version: '4.0',
    };

    const updated = [...profiles, profile];
    await saveProfiles(updated);
    setActiveProfileId(profile.id);
    setNewName(''); setNewDesc('');
    notify(`✓ Profile "${profile.name}" saved`);
    setSaving(false);
  };

  const handleLoad = useCallback(async (profile) => {
    const error = validateProfile(profile);
    if (error) {
      notify(`Cannot load profile: ${error}`, 'error');
      console.warn('[ProfileSystem] Rejected profile:', error, profile);
      return;
    }
    const safe = sanitizeProfile(profile);
    setActiveProfileId(safe.id);
    onLoadProfile?.(safe.deviceStates);
    notify(`✓ Profile "${safe.name}" loaded`);
  }, [onLoadProfile, notify]);

  const handleDelete = useCallback(async (profileId) => {
    await storeOps.remove(profileId);
    const updated = profiles.filter(p => p.id !== profileId);
    setProfiles(updated);
    if (activeProfileId === profileId) setActiveProfileId(null);
    notify('Profile deleted');
  }, [profiles, activeProfileId, notify]);

  const handleRename = useCallback(async (profileId, name) => {
    const updated = profiles.map(p => p.id === profileId ? { ...p, name } : p);
    await saveProfiles(updated);
    notify(`✓ Renamed to "${name}"`);
  }, [profiles, saveProfiles, notify]);

  const handleExport = useCallback((profile) => {
    const json = JSON.stringify(profile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-profile-${profile.name.replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`✓ Exported "${profile.name}"`);
  }, [notify]);

  const handleExportAll = useCallback(() => {
    const json = JSON.stringify(profiles, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-all-profiles-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`✓ Exported ${profiles.length} profiles`);
  }, [profiles, notify]);

  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const toImport = Array.isArray(data) ? data : [data];
        // Full schema validation — reject any profile that fails
        const valid = toImport.filter(p => {
          const err = validateProfile(p);
          if (err) console.warn('[ProfileSystem] Import rejected:', err, p);
          return !err;
        }).map(sanitizeProfile);
        if (valid.length === 0) { setImportError('No valid profiles found in file.'); return; }
        // Restamp IDs to avoid collision
        const imported = valid.map(p => ({ ...p, id: generateId(), savedAt: Date.now() }));
        const updated = [...profiles, ...imported];
        await saveProfiles(updated);
        setImportError('');
        notify(`✓ Imported ${imported.length} profile${imported.length > 1 ? 's' : ''}`);
      } catch (err) {
        setImportError('Invalid file format: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset
  }, [profiles, saveProfiles, notify]);

  const label = { fontSize: 9, color: '#444', letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Orbitron',sans-serif", display: 'block', marginBottom: 10 };
  const inputStyle = { width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none', fontFamily: "'Rajdhani',sans-serif" };
  const cardStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 18, marginBottom: 16 };

  const filtered = profiles.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 700 }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Profile System</div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 22 }}>
          Save and restore complete lighting configurations. Profiles are stored {isElectron ? 'on disk via Electron Store.' : 'in browser localStorage.'}
        </div>

        {/* Save new profile */}
        <div style={cardStyle}>
          <span style={label}>Save Current Lighting as Profile</span>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            {/* Icon picker */}
            <select value={newIcon} onChange={e => setNewIcon(e.target.value)}
              style={{ ...inputStyle, width: 60, padding: '8px 6px', textAlign: 'center', cursor: 'pointer' }}>
              {PROFILE_ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
            </select>
            <input placeholder="Profile name *" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              style={{ ...inputStyle, flex: 1 }} />
          </div>
          <input placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)}
            style={{ ...inputStyle, marginBottom: 12 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: '#555' }}>
              {devices.length} device{devices.length !== 1 ? 's' : ''} will be saved
            </div>
            <button onClick={handleSave} disabled={saving || !newName.trim()}
              style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(0,229,255,0.3)', background: 'rgba(0,229,255,0.1)', color: '#00e5ff', fontSize: 11, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'Orbitron',sans-serif", opacity: !newName.trim() ? 0.4 : 1 }}>
              {saving ? 'Saving…' : '✓ Save Profile'}
            </button>
          </div>
        </div>

        {/* Import / Export all */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <label style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.06)', color: '#22c55e', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Orbitron',sans-serif", textAlign: 'center' }}>
            📂 Import Profile(s)
            <input type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          </label>
          {profiles.length > 0 && (
            <button onClick={handleExportAll} style={{ flex: 1, padding: '10px 16px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.25)', background: 'rgba(168,85,247,0.06)', color: '#a855f7', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'Orbitron',sans-serif" }}>
              📤 Export All ({profiles.length})
            </button>
          )}
        </div>
        {importError && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>⚠ {importError}</div>}

        {/* Profile list */}
        {profiles.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={label}>Saved Profiles ({profiles.length})</span>
              <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, width: 180, fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(p => (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  isActive={activeProfileId === p.id}
                  onLoad={handleLoad}
                  onDelete={handleDelete}
                  onExport={handleExport}
                  onRename={handleRename}
                />
              ))}
              {filtered.length === 0 && search && (
                <div style={{ color: '#333', fontSize: 12, textAlign: 'center', padding: 20 }}>No profiles match "{search}"</div>
              )}
            </div>
          </div>
        )}

        {profiles.length === 0 && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: 40, color: '#333' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
            <div style={{ fontSize: 14 }}>No profiles yet</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Set up your lighting and save your first profile above</div>
          </div>
        )}
      </div>
    </div>
  );
}
