// ============================================================
// Nexus RGB OS — Game Integrations Panel
// F1, CS2, Valorant, Minecraft, Forza — event buttons that
// push real colours to hardware via onApplyRGB callback.
// Real live data: F1 UDP port 20777, CS2 GSI, Valorant log.
// Simulate mode: click any event to preview the RGB effect.
// ============================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { hexWithAlpha } from './color';

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron;

// ── RGB recipes — every game event maps to a color + effect ──
const RGB = {
  // F1
  f1_lights_out:   { color:'#ff0000', effect:'static',       label:'Red Lights On' },
  f1_go:           { color:'#00ff00', effect:'pulse',        label:'Lights Out — GO' },
  f1_drs:          { color:'#00ff88', effect:'pulse',        label:'DRS Open' },
  f1_pit:          { color:'#ffd700', effect:'breathing',    label:'Pit Stop' },
  f1_safety:       { color:'#ffaa00', effect:'breathing',    label:'Safety Car' },
  f1_vsc:          { color:'#ff8800', effect:'pulse',        label:'VSC' },
  f1_fastest:      { color:'#aa00ff', effect:'comet',        label:'Fastest Lap' },
  f1_finish:       { color:'#ffffff', effect:'rainbow_wave', label:'Chequered Flag' },
  f1_sector_green: { color:'#00ff00', effect:'static',       label:'Sector Green' },
  f1_sector_purple:{ color:'#aa00ff', effect:'static',       label:'Sector Purple' },
  // CS2
  cs2_bomb_plant:  { color:'#ff2200', effect:'pulse',        label:'Bomb Planted' },
  cs2_bomb_defuse: { color:'#00ff88', effect:'comet',        label:'Bomb Defused' },
  cs2_bomb_exp:    { color:'#ff6600', effect:'fire',         label:'Explosion' },
  cs2_ct_win:      { color:'#0088ff', effect:'aurora',       label:'CT Win' },
  cs2_t_win:       { color:'#ff8800', effect:'aurora',       label:'T Win' },
  cs2_mvp:         { color:'#ffd700', effect:'rainbow_wave', label:'MVP' },
  cs2_ace:         { color:'#ff00ff', effect:'rainbow_wave', label:'Ace' },
  cs2_knife:       { color:'#aaffaa', effect:'pulse',        label:'Knife Kill' },
  // Valorant
  val_spike_plant: { color:'#ff4400', effect:'pulse',        label:'Spike Planted' },
  val_spike_defuse:{ color:'#00ff88', effect:'comet',        label:'Spike Defused' },
  val_ace:         { color:'#ffd700', effect:'rainbow_wave', label:'Ace' },
  val_clutch:      { color:'#ff00aa', effect:'pulse',        label:'Clutch' },
  val_round_win:   { color:'#00e5ff', effect:'aurora',       label:'Round Win' },
  val_round_loss:  { color:'#440088', effect:'breathing',    label:'Round Loss' },
  val_low_health:  { color:'#ff0000', effect:'heartbeat',    label:'Low Health' },
  val_ultimate:    { color:'#aa00ff', effect:'pulse',        label:'Ultimate Ready' },
  // Minecraft
  mc_ocean:        { color:'#0044ff', effect:'ripple',       label:'Ocean' },
  mc_nether:       { color:'#ff2200', effect:'fire',         label:'Nether' },
  mc_end:          { color:'#8800ff', effect:'aurora',       label:'The End' },
  mc_jungle:       { color:'#00aa22', effect:'breathing',    label:'Jungle' },
  mc_snow:         { color:'#aaddff', effect:'ice_storm',    label:'Snow Biome' },
  mc_cave:         { color:'#001133', effect:'static',       label:'Deep Dark' },
  mc_night:        { color:'#001044', effect:'starfield',    label:'Night Time' },
  mc_thunder:      { color:'#334455', effect:'comet',        label:'Thunderstorm' },
  // Forza
  fz_race_start:   { color:'#00ff00', effect:'pulse',        label:'Race Start' },
  fz_finish:       { color:'#ffffff', effect:'rainbow_wave', label:'Finish Line' },
  fz_drift:        { color:'#ff8800', effect:'comet',        label:'Drift Zone' },
  fz_nitrous:      { color:'#00ffff', effect:'pulse',        label:'Nitrous' },
  fz_crash:        { color:'#ff0000', effect:'pulse',        label:'Collision' },
};

// ── RPM bar ───────────────────────────────────────────────────
function RPMBar({ onApply }) {
  const [rpm, setRpm] = useState(6000);
  const max = 12000;
  const pct = rpm / max;
  const color = pct < 0.5 ? '#22c55e' : pct < 0.75 ? '#f59e0b' : pct < 0.9 ? '#ef4444' : '#ff00ff';
  useEffect(() => { onApply?.({ color, effect:'static' }); }, [color, onApply]);
  return (
    <div style={{ padding:'12px 14px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:'1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontSize:10, color:'#555', letterSpacing:1.5, fontFamily:"'Orbitron',sans-serif" }}>RPM</span>
        <span style={{ fontSize:14, fontWeight:800, color, fontFamily:"'Orbitron',sans-serif" }}>{rpm.toLocaleString()}</span>
      </div>
      <input type="range" min={0} max={max} value={rpm} onChange={e => setRpm(+e.target.value)} style={{ accentColor:color }} />
      <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,0.06)', marginTop:8, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct*100}%`, background:color, borderRadius:3, transition:'width 0.1s, background 0.15s', boxShadow:`0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ── Speed bar (Forza) ─────────────────────────────────────────
function SpeedBar({ onApply }) {
  const [speed, setSpeed] = useState(80);
  const max = 320;
  const pct = speed / max;
  const color = pct < 0.33 ? '#22c55e' : pct < 0.66 ? '#f59e0b' : pct < 0.85 ? '#ef4444' : '#ff00ff';
  useEffect(() => { onApply?.({ color, effect:'static' }); }, [color, onApply]);
  return (
    <div style={{ padding:'12px 14px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:'1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
        <span style={{ fontSize:10, color:'#555', letterSpacing:1.5, fontFamily:"'Orbitron',sans-serif" }}>Speed</span>
        <span style={{ fontSize:14, fontWeight:800, color, fontFamily:"'Orbitron',sans-serif" }}>{speed} <span style={{ fontSize:10 }}>km/h</span></span>
      </div>
      <input type="range" min={0} max={max} value={speed} onChange={e => setSpeed(+e.target.value)} style={{ accentColor:color }} />
      <div style={{ height:6, borderRadius:3, background:'rgba(255,255,255,0.06)', marginTop:8, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${pct*100}%`, background:color, borderRadius:3, transition:'width 0.1s', boxShadow:`0 0 8px ${color}` }} />
      </div>
    </div>
  );
}

// ── CS2 Bomb Timer ────────────────────────────────────────────
function BombTimer({ onApply }) {
  const [timer, setTimer] = useState(null);
  const iv = useRef(null);

  const plant = () => {
    let t = 40; setTimer(t);
    clearInterval(iv.current);
    iv.current = setInterval(() => {
      t--;
      setTimer(t);
      const urgency = 1 - (t / 40);
      const r = Math.round(255 * urgency);
      onApply?.({ color: `rgb(${r},0,0)`, effect: t < 10 ? 'heartbeat' : 'pulse' });
      if (t <= 0) { clearInterval(iv.current); setTimer(null); onApply?.({ color:'#ff6600', effect:'fire' }); }
    }, 1000);
  };
  useEffect(() => () => clearInterval(iv.current), []);

  return (
    <div style={{ padding:'12px 14px', background:'rgba(255,34,0,0.06)', borderRadius:8, border:'1px solid rgba(255,34,0,0.2)', marginBottom:10 }}>
      <div style={{ fontSize:10, color:'#888', letterSpacing:1, marginBottom:8, fontFamily:"'Orbitron',sans-serif" }}>BOMB TIMER SIMULATOR</div>
      {timer !== null ? (
        <>
          <div style={{ fontSize:32, fontWeight:900, fontFamily:"'Orbitron',sans-serif", color: timer > 15 ? '#ff4400' : '#ff0000', letterSpacing:3 }}>
            {String(timer).padStart(2,'0')}s
          </div>
          <div style={{ height:4, background:'rgba(255,255,255,0.1)', borderRadius:2, marginTop:8, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${(timer/40)*100}%`, background: timer > 15 ? '#ff4400' : '#ff0000', transition:'width 1s linear', borderRadius:2 }} />
          </div>
        </>
      ) : (
        <button onClick={plant}
          style={{ padding:'8px 16px', borderRadius:8, border:'1px solid rgba(255,34,0,0.4)', background:'rgba(255,34,0,0.12)', color:'#ff4400', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:"'Orbitron',sans-serif" }}>
          💣 PLANT BOMB
        </button>
      )}
    </div>
  );
}

// ── Event button grid ─────────────────────────────────────────
function EventGrid({ eventIds, onApply, lastEvent }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
      {eventIds.map(id => {
        const ev = RGB[id];
        if (!ev) return null;
        const active = lastEvent === id;
        return (
          <button key={id} onClick={() => onApply(id)}
            style={{ padding:'10px 12px', borderRadius:8,
              border:`1px solid ${active ? ev.color : hexWithAlpha(ev.color, 0.2)}`,
              background: active ? hexWithAlpha(ev.color, 0.18) : hexWithAlpha(ev.color, 0.05),
              cursor:'pointer', textAlign:'left', transition:'all 0.15s' }}>
            <div style={{ fontSize:12, fontWeight:600, color: active ? ev.color : '#bbb' }}>{ev.label}</div>
            <div style={{ fontSize:9, color:'#555', marginTop:2 }}>{ev.effect}</div>
          </button>
        );
      })}
    </div>
  );
}

// ── Game configs ──────────────────────────────────────────────
const GAMES = [
  {
    id:'f1',  name:'F1 2024',       icon:'🏎', color:'#ff0000',
    realIntegration: 'UDP telemetry on port 20777 (F1 game settings → Telemetry → UDP On)',
    events: ['f1_lights_out','f1_go','f1_drs','f1_pit','f1_safety','f1_vsc','f1_fastest','f1_finish','f1_sector_green','f1_sector_purple'],
    extras: ['rpm'],
  },
  {
    id:'cs2', name:'CS2',           icon:'💣', color:'#ff4400',
    realIntegration: 'Game State Integration — add gamestate_integration_nexusrgb.cfg to CS2/cfg/',
    events: ['cs2_bomb_plant','cs2_bomb_defuse','cs2_bomb_exp','cs2_ct_win','cs2_t_win','cs2_mvp','cs2_ace','cs2_knife'],
    extras: ['bomb'],
  },
  {
    id:'val', name:'Valorant',      icon:'🎮', color:'#ff4455',
    realIntegration: 'Valorant event log at %LOCALAPPDATA%/Riot Games/Valorant/Logs/',
    events: ['val_spike_plant','val_spike_defuse','val_ace','val_clutch','val_round_win','val_round_loss','val_low_health','val_ultimate'],
    extras: [],
  },
  {
    id:'mc',  name:'Minecraft',     icon:'⛏', color:'#5a8a3c',
    realIntegration: 'Minecraft mod or log parser — detect biome from game logs',
    events: ['mc_ocean','mc_nether','mc_end','mc_jungle','mc_snow','mc_cave','mc_night','mc_thunder'],
    extras: [],
  },
  {
    id:'fz',  name:'Forza Horizon', icon:'🚗', color:'#00e5ff',
    realIntegration: 'Forza Data Out — Settings → HUD → Data Out → IP 127.0.0.1 port 2001',
    events: ['fz_race_start','fz_finish','fz_drift','fz_nitrous','fz_crash'],
    extras: ['speed'],
  },
];

// ── Main ──────────────────────────────────────────────────────
export default function GameIntegrationsPanel({ onApplyRGB, devices = [] }) {
  const [activeGame, setActiveGame] = useState('f1');
  const [lastEvent,  setLastEvent]  = useState(null);
  const [liveStatus, setLiveStatus] = useState({}); // gameId → true/false

  // Check which games are actually running (Electron only)
  useEffect(() => {
    if (!isElectron || !window.NexusOS?.games) return;
    window.NexusOS?.games?.status?.().then(s => setLiveStatus(s || {}));
  }, []);

  const handleApply = useCallback((eventId) => {
    const recipe = RGB[eventId];
    if (!recipe) return;
    setLastEvent(eventId);
    onApplyRGB?.({ color: recipe.color, effect: recipe.effect });
  }, [onApplyRGB]);

  const game = GAMES.find(g => g.id === activeGame);
  const LBL  = ({ c }) => <div style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:10 }}>{c}</div>;
  const card  = { background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:16, marginBottom:14 };

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

      {/* Sidebar */}
      <div style={{ width:180, flexShrink:0, borderRight:'1px solid rgba(255,255,255,0.06)', padding:'16px 10px', display:'flex', flexDirection:'column', gap:6 }}>
        <LBL c="Games" />
        {GAMES.map(g => (
          <button key={g.id} onClick={() => setActiveGame(g.id)}
            style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:9,
              border: activeGame===g.id ? `1px solid ${hexWithAlpha(g.color,0.5)}` : '1px solid rgba(255,255,255,0.05)',
              background: activeGame===g.id ? hexWithAlpha(g.color,0.1) : 'rgba(255,255,255,0.02)',
              cursor:'pointer', textAlign:'left', transition:'all 0.2s' }}>
            <span style={{ fontSize:20 }}>{g.icon}</span>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color: activeGame===g.id ? g.color : '#666', fontFamily:"'Orbitron',sans-serif", letterSpacing:0.5 }}>{g.name}</div>
              {liveStatus[g.id] && (
                <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                  <div style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e' }} />
                  <span style={{ fontSize:9, color:'#22c55e' }}>LIVE</span>
                </div>
              )}
            </div>
          </button>
        ))}

        <div style={{ marginTop:'auto', paddingTop:12 }}>
          <LBL c="Devices" />
          <div style={{ fontSize:10, color:'#444' }}>
            {devices.length > 0
              ? `${devices.length} device${devices.length>1?'s':''} connected — events apply to all`
              : 'No devices — scan first'}
          </div>
        </div>
      </div>

      {/* Main panel */}
      <div style={{ flex:1, overflowY:'auto', padding:24 }}>
        {game && (
          <>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <span style={{ fontSize:32 }}>{game.icon}</span>
              <div>
                <div style={{ fontSize:20, fontWeight:700, color:'#fff' }}>{game.name}</div>
                <div style={{ fontSize:11, color:'#555', marginTop:2 }}>
                  {liveStatus[game.id]
                    ? <span style={{ color:'#22c55e' }}>● Live integration active</span>
                    : <span style={{ color:'#555' }}>● Simulate mode — click any event to trigger RGB</span>}
                </div>
              </div>
            </div>

            {/* Last event indicator */}
            {lastEvent && RGB[lastEvent] && (
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, padding:'9px 14px', borderRadius:8,
                background:hexWithAlpha(RGB[lastEvent].color,0.1), border:`1px solid ${hexWithAlpha(RGB[lastEvent].color,0.3)}` }}>
                <div style={{ width:10, height:10, borderRadius:'50%', background:RGB[lastEvent].color, boxShadow:`0 0 8px ${RGB[lastEvent].color}`, animation:'glow 1s infinite' }} />
                <span style={{ fontSize:12, color:RGB[lastEvent].color, fontWeight:600 }}>{RGB[lastEvent].label}</span>
                <span style={{ fontSize:10, color:'#555', marginLeft:'auto' }}>
                  {devices.length > 0 ? `→ sent to ${devices.length} device${devices.length>1?'s':''}` : '→ no devices connected'}
                </span>
              </div>
            )}

            {/* Extras (RPM, bomb timer, speed) */}
            {game.extras.includes('rpm')  && <div style={{ marginBottom:14 }}><LBL c="RPM Visualizer" /><RPMBar onApply={onApplyRGB} /></div>}
            {game.extras.includes('bomb') && <div style={{ marginBottom:14 }}><LBL c="Bomb Timer" /><BombTimer onApply={r=>onApplyRGB?.(r)} /></div>}
            {game.extras.includes('speed')&& <div style={{ marginBottom:14 }}><LBL c="Speed Visualizer" /><SpeedBar onApply={onApplyRGB} /></div>}

            {/* Event buttons */}
            <div style={card}>
              <LBL c="Events — click to trigger RGB" />
              <EventGrid eventIds={game.events} onApply={handleApply} lastEvent={lastEvent} />
            </div>

            {/* Real integration info */}
            <div style={{ padding:'12px 14px', borderRadius:9, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize:9, color:'#444', letterSpacing:1.5, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:6 }}>Real Integration</div>
              <div style={{ fontSize:11, color:'#555', lineHeight:1.8 }}>{game.realIntegration}</div>
              <div style={{ fontSize:10, color:'#333', marginTop:6 }}>See SETUP.md for step-by-step instructions.</div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes glow { 0%,100%{opacity:1}50%{opacity:.3} }`}</style>
    </div>
  );
}
