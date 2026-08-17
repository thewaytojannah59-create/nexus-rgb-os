import { useState, useRef, useCallback, useEffect } from 'react';
import { useNexusCoreEngine }  from './hooks/useNexusCoreEngine';
import { hslToHex, hexToRgb, rgbToHex, hexWithAlpha, tempToColor, usageToColor, isValidHex } from './color';
import TelemetryPanel         from './TelemetryPanel';
import DigitalTwin            from './DigitalTwin';
import AdaptiveTelemetryRGB  from './AdaptiveTelemetryRGB';
import ProfileSystem     from './ProfileSystem';
import AIStudio          from './AIStudio';
import SyncPanel         from './SyncPanel';
import GameIntegrationsPanel from './GameIntegrationsPanel';
import GameAutoDetect        from './GameAutoDetect';
import ErrorBoundary from './components/ErrorBoundary';
import { useOpenRGBFallback } from './hooks/useOpenRGBFallback';
import { APP_PROFILES }      from './appIntegrations';

// ── Shared tiny components ────────────────────────────────────

function RGBStrip({ color = '#ff6b35', effect = 'static', speed = 50, h = 8 }) {
  const ref = useRef(null); const f = useRef(0);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); const W = c.width; const H = c.height; let raf;
    const draw = () => {
      f.current = (f.current + 1) % 1_000_000; const fr = f.current; const s = speed / 50;
      ctx.clearRect(0,0,W,H);
      const { r, g, b } = hexToRgb(color);
      switch (effect) {
        case 'static':       ctx.fillStyle = color; ctx.fillRect(0,0,W,H); break;
        case 'breathing':    { const t=(Math.sin(fr*0.03*s)+1)/2; ctx.fillStyle=`rgba(${r},${g},${b},${0.08+t*0.92})`; ctx.fillRect(0,0,W,H); break; }
        case 'rainbow_wave':
        case 'color_cycle':  { const grd=ctx.createLinearGradient(0,0,W,0); for(let i=0;i<=8;i++) grd.addColorStop(i/8,hslToHex(((i/8)*360+fr*s*2)%360,100,55)); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); break; }
        case 'pulse':        { const t=(Math.sin(fr*0.05*s)+1)/2; ctx.fillStyle=`rgb(${Math.round(r*t)},${Math.round(g*t)},${Math.round(b*t)})`; ctx.fillRect(0,0,W,H); break; }
        case 'fire':         { const grd=ctx.createLinearGradient(0,0,W,0); grd.addColorStop(0,'#ff0000'); grd.addColorStop(0.4+0.1*Math.sin(fr*0.05*s),'#ff6600'); grd.addColorStop(0.75,'#ffcc00'); grd.addColorStop(1,'#ff0000'); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); break; }
        case 'aurora':       { const grd=ctx.createLinearGradient(0,0,W,0); const t=fr*s*0.8; grd.addColorStop(0,hslToHex((140+t)%360,80,45)); grd.addColorStop(0.5,hslToHex((220+t)%360,90,50)); grd.addColorStop(1,hslToHex((300+t)%360,80,45)); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); break; }
        case 'matrix_rain':  { ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#00ff44'; for(let x=0;x<W;x+=5) if(Math.random()>0.88) ctx.fillRect(x,0,3,H); break; }
        case 'ice_storm':    { const grd=ctx.createLinearGradient(0,0,W,0); const t=(fr*s*1.5)%360; grd.addColorStop(0,hslToHex((190+t*0.1)%360,80,75)); grd.addColorStop(0.5,hslToHex((210+t*0.15)%360,90,85)); grd.addColorStop(1,hslToHex((220+t*0.08)%360,70,70)); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); break; }
        case 'comet':        { ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); const pos=((fr*s*2)%(W+60))-30; const grd=ctx.createLinearGradient(pos-40,0,pos+20,0); grd.addColorStop(0,'transparent'); grd.addColorStop(0.7,color); grd.addColorStop(1,'#fff'); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); break; }
        case 'heartbeat':    { const beat=Math.max(0,Math.sin(fr*0.08*s)**2); ctx.fillStyle=`rgb(${Math.round(r*beat)},${Math.round(g*beat)},${Math.round(b*beat)})`; ctx.fillRect(0,0,W,H); break; }
        default:             { const grd=ctx.createLinearGradient(0,0,W,0); for(let i=0;i<=6;i++) grd.addColorStop(i/6,hslToHex(((i/6)*360+fr*s*2)%360,100,55)); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [color, effect, speed]);
  return <canvas ref={ref} width={200} height={h} style={{ width:'100%', height:h, borderRadius:3, display:'block' }} />;
}

function ColorWheel({ value, onChange, size = 140 }) {
  const ref = useRef(null); const [drag, setDrag] = useState(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); const cx=size/2, cy=size/2, r=size/2-4;
    for (let a=0;a<360;a++) { const grd=ctx.createRadialGradient(cx,cy,0,cx,cy,r); grd.addColorStop(0,'white'); grd.addColorStop(1,hslToHex(a,100,50)); ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,(a-1)*Math.PI/180,(a+1)*Math.PI/180); ctx.closePath(); ctx.fillStyle=grd; ctx.fill(); }
  }, [size]);
  const pick = useCallback(e => {
    const c = ref.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX-rect.left)/rect.width)*size, y=((e.clientY-rect.top)/rect.height)*size;
    if (Math.hypot(x-size/2,y-size/2) > size/2-2) return;
    const [r,g,b] = c.getContext('2d').getImageData(Math.round(x),Math.round(y),1,1).data;
    onChange?.(rgbToHex(r,g,b));
  }, [size, onChange]);
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
      <canvas ref={ref} width={size} height={size} style={{ borderRadius:'50%', cursor:'crosshair', display:'block' }}
        onMouseDown={e=>{setDrag(true);pick(e);}} onMouseMove={e=>{if(drag)pick(e);}}
        onMouseUp={()=>setDrag(false)} onMouseLeave={()=>setDrag(false)} />
      <div style={{ width:48, height:16, borderRadius:8, background:value, border:'2px solid rgba(255,255,255,0.15)', boxShadow:`0 0 12px ${value}88` }} />
    </div>
  );
}

function Toast({ msg, type }) {
  if (!msg) return null;
  const ok = type !== 'error';
  return (
    <div style={{ position:'fixed', top:24, right:24, zIndex:9999, padding:'11px 18px', borderRadius:9,
      background: ok?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)',
      border:`1px solid ${ok?'#22c55e':'#ef4444'}`, color: ok?'#22c55e':'#ef4444',
      fontSize:13, fontWeight:600, backdropFilter:'blur(12px)', fontFamily:"'Rajdhani',sans-serif",
      animation:'slideIn 0.3s ease' }}>
      {msg}
    </div>
  );
}

function Badge({ label, color='#22c55e', pulse=false }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:20, background: hexWithAlpha(color,0.1), border:`1px solid ${hexWithAlpha(color,0.25)}` }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:color, boxShadow:`0 0 8px ${color}`, animation: pulse?'glow 2s infinite':'none' }} />
      <span style={{ fontSize:11, color, fontWeight:600 }}>{label}</span>
    </div>
  );
}

// ── Effects list ──────────────────────────────────────────────
const EFFECTS = [
  {id:'static',name:'Static',cat:'Basic'},{id:'breathing',name:'Breathing',cat:'Basic'},
  {id:'rainbow_wave',name:'Rainbow Wave',cat:'Basic'},{id:'color_cycle',name:'Color Cycle',cat:'Basic'},
  {id:'pulse',name:'Pulse',cat:'Basic'},{id:'heartbeat',name:'Heartbeat',cat:'Basic'},
  {id:'aurora',name:'Aurora',cat:'Dynamic'},{id:'fire',name:'Fire',cat:'Dynamic'},
  {id:'matrix_rain',name:'Matrix Rain',cat:'Dynamic'},{id:'comet',name:'Comet',cat:'Dynamic'},
  {id:'ripple',name:'Ripple',cat:'Dynamic'},{id:'ice_storm',name:'Ice Storm',cat:'Dynamic'},
  {id:'starfield',name:'Starfield',cat:'Premium'},{id:'northern_lights',name:'Northern Lights',cat:'Premium'},
  {id:'hyperdrive',name:'Hyperdrive',cat:'Premium'},{id:'quantum_pulse',name:'Quantum Pulse',cat:'Premium'},
  {id:'supernova',name:'Supernova',cat:'Premium'},{id:'deep_space',name:'Deep Space',cat:'Premium'},
];

// ── Tabs ──────────────────────────────────────────────────────
const TABS = [
  {id:'devices',   label:'Devices',      icon:'◈'},
  {id:'twin',      label:'Digital Twin', icon:'🖥'},
  {id:'effects',   label:'Effects',      icon:'◉'},
  {id:'sync',      label:'Sync All',     icon:'⟳'},
  {id:'games',     label:'Games',        icon:'🎮'},
  {id:'apps',      label:'App RGB',      icon:'📱'},
  {id:'autodetect',label:'Auto Detect',  icon:'🔍'},
  {id:'adaptive',  label:'Adaptive RGB',  icon:'🌡'},
  {id:'telemetry', label:'Telemetry',    icon:'📊'},
  {id:'ai',        label:'AI Studio',    icon:'🤖'},
  {id:'profiles',  label:'Profiles',     icon:'📁'},
  {id:'settings',  label:'Settings',     icon:'⚙'},
];

// ── Main ──────────────────────────────────────────────────────
export default function App() {
  // ── Single source of truth ──────────────────────────────────
  const engine = useNexusCoreEngine();
  const {
    state, bridge, notify,
    setTab, setSelectedId, setBrightness,
    doScan, reconnect, disconnect,
    applyColor, applyEffect,
    syncAll, applyGameRGB, setActiveGame, loadProfile, applyScene, applyTelemetryColor,
    getDeviceStatus, retryDevice, disconnectedCount,
    appIntegrations, verifier, cre, rendererHealth,
  } = engine;

  const fallback = useOpenRGBFallback(bridge);

  const {
    tab, devices, selectedId, rgbConnected,
    scanning, scanPct, telemetry, toast,
    devColors, devEffects, devBrightness, activeGame,
  } = state;

  const sel       = devices.find(d => d.id === selectedId) || null;
  const selColor  = sel ? (devColors[sel.id]  || '#ff6b35') : '#ff6b35';
  const selEffect = sel ? (devEffects[sel.id] || 'static')  : 'static';

  const card = { background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:16, marginBottom:14 };
  const LBL  = ({ children }) => <div style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:9 }}>{children}</div>;
  const inp  = { width:'100%', padding:'9px 12px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:13, fontFamily:"'Rajdhani',sans-serif", outline:'none' };
  const selSt= { width:'100%', padding:'8px 12px', background:'#0a0a18', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:13, outline:'none' };

  return (
    <div style={{ minHeight:'100vh', background:'#030308', color:'#e0e0e0', fontFamily:"'Rajdhani',sans-serif", display:'flex', flexDirection:'column', overflow:'hidden',
      backgroundImage:'radial-gradient(ellipse at 15% 20%,#0d0d2b 0%,transparent 55%),radial-gradient(ellipse at 85% 80%,#100818 0%,transparent 50%)' }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0a14}::-webkit-scrollbar-thumb{background:#1e1e3a;border-radius:2px}
        input[type=range]{-webkit-appearance:none;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);outline:none;cursor:pointer}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#00e5ff;cursor:pointer;border:2px solid #030308;box-shadow:0 0 8px #00e5ff}
        select option{background:#0a0a18} textarea{resize:vertical;font-family:'Rajdhani',sans-serif}
        @keyframes glow{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes slideIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
      `}</style>

      <Toast msg={toast?.msg} type={toast?.type} />

      {/* OpenRGB availability banner — shown when verifier detects issues */}
      {verifier && (verifier.status === 'version_mismatch' || verifier.status === 'degraded') && (
        <div style={{ padding:'8px 24px', background: verifier.isDegraded ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', borderBottom:`1px solid ${verifier.isDegraded ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:12, color: verifier.isDegraded ? '#f59e0b' : '#ef4444' }}>
            {verifier.isDegraded ? '⚠' : '✕'} {verifier.reason}
          </span>
          <button onClick={verifier.verify} style={{ fontSize:10, padding:'4px 12px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)', color:'#888', cursor:'pointer' }}>
            Re-verify
          </button>
        </div>
      )}

      {/* Header */}
      <header style={{ padding:'0 24px', borderBottom:'1px solid rgba(255,255,255,0.06)', background:'rgba(3,3,8,0.85)', backdropFilter:'blur(20px)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', height:58 }}>
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <span style={{ fontSize:20, fontWeight:900, fontFamily:"'Orbitron',sans-serif", background:'linear-gradient(135deg,#00e5ff,#ff6b35,#a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', letterSpacing:3 }}>NEXUS RGB OS</span>
            <span style={{ fontSize:10, color:'#333', letterSpacing:2, fontFamily:"'Orbitron',sans-serif" }}>v6.0</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Badge label={rgbConnected?'OpenRGB ✓':'OpenRGB ✗'} color={rgbConnected?'#22c55e':'#555'} pulse={rgbConnected} />
            {verifier && verifier.status !== 'unknown' && verifier.status !== 'no_electron' && (
              <Badge
                label={verifier.isOk ? `v${verifier.version ?? '?'} ✓` : verifier.isDegraded ? 'Degraded' : 'Incompatible'}
                color={verifier.isOk ? '#22c55e' : verifier.isDegraded ? '#f59e0b' : '#ef4444'}
              />
            )}
            <Badge
              label={disconnectedCount > 0 ? `${devices.length - disconnectedCount}/${devices.length} Devices` : `${devices.length} Devices`}
              color={disconnectedCount > 0 ? '#f59e0b' : '#00e5ff'}
              pulse={disconnectedCount > 0}
            />
            {/* CRE status badge — shows recovery engine health */}
            {cre && cre.creStatus !== 'healthy' && cre.creStatus !== 'initializing' && (
              <Badge
                label={cre.creStatus === 'recovering' ? '⟳ Recovering' : '⚠ Degraded'}
                color={cre.creStatus === 'recovering' ? '#f59e0b' : '#ef4444'}
                pulse={cre.creStatus === 'recovering'}
              />
            )}
            {activeGame && (
              <Badge label={`${activeGame.icon ?? '🎮'} ${activeGame.name}`} color={activeGame.accentColor ?? '#a855f7'} pulse />
            )}
            {!activeGame && appIntegrations?.activeApp && (
              <Badge label={`${appIntegrations.activeApp.icon} ${appIntegrations.activeApp.name}`} color={appIntegrations.activeApp.rgb.color} pulse={false} />
            )}
            <button onClick={doScan} disabled={scanning}
              style={{ padding:'8px 16px', borderRadius:8, border:'1px solid rgba(0,229,255,0.3)', background:'rgba(0,229,255,0.1)', color:'#00e5ff', fontSize:11, fontWeight:700, cursor: scanning?'not-allowed':'pointer', fontFamily:"'Orbitron',sans-serif", opacity: scanning?0.7:1 }}>
              {scanning ? `Scanning ${Math.round(scanPct)}%` : '⟳ Re-scan'}
            </button>
          </div>
        </div>
        {/* Scan bar */}
        {scanning && (
          <div style={{ height:2, background:'rgba(255,255,255,0.05)', position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, height:'100%', background:'linear-gradient(90deg,#00e5ff,#a855f7)', width:`${scanPct}%`, transition:'width 0.1s' }} />
          </div>
        )}
        {/* Nav */}
        <nav style={{ display:'flex', borderTop:'1px solid rgba(255,255,255,0.04)', overflowX:'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:'9px 14px', background:'none', border:'none', cursor:'pointer', color: tab===t.id?'#fff':'#444', fontSize:10, fontWeight:700, letterSpacing:1.2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", position:'relative', transition:'color 0.2s', whiteSpace:'nowrap' }}>
              <span style={{ marginRight:4 }}>{t.icon}</span>{t.label}
              {tab===t.id && <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:'linear-gradient(90deg,#00e5ff,#a855f7)', borderRadius:'2px 2px 0 0' }} />}
            </button>
          ))}
        </nav>
      </header>

      {/* ── OpenRGB unavailable banner ── */}
      {fallback.show && (
        <div style={{ position:'relative', zIndex:50,
          background: 'rgba(245,158,11,0.08)',
          borderBottom: '1px solid rgba(245,158,11,0.2)',
          padding: '12px 24px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20 }}>{fallback.copy.icon}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 2 }}>
              {fallback.copy.title}
            </div>
            <div style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
              {fallback.copy.detail}
            </div>
            {fallback.retryStatus && (
              <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                ⟳ {fallback.retryStatus}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {fallback.canRetry && (
              <button onClick={fallback.retry} disabled={fallback.retrying}
                style={{ padding: '7px 16px', borderRadius: 8,
                  border: '1px solid rgba(245,158,11,0.4)',
                  background: 'rgba(245,158,11,0.12)',
                  color: '#f59e0b', fontSize: 11, fontWeight: 700,
                  cursor: fallback.retrying ? 'not-allowed' : 'pointer',
                  fontFamily: "'Orbitron',sans-serif", letterSpacing: 1,
                  opacity: fallback.retrying ? 0.5 : 1 }}>
                {fallback.retrying ? '⟳ Retrying…' : '↺ Retry'}
              </button>
            )}
            <button onClick={fallback.dismiss}
              style={{ padding: '7px 14px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.03)',
                color: '#444', fontSize: 11, cursor: 'pointer',
                fontFamily: "'Orbitron',sans-serif" }}>
              Use Without RGB
            </button>
          </div>
        </div>
      )}

      {/* ── Recovered flash ── */}
      {fallback.recovered && (
        <div style={{ position:'relative', zIndex:50,
          background: 'rgba(34,197,94,0.08)',
          borderBottom: '1px solid rgba(34,197,94,0.2)',
          padding: '10px 24px',
          display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%',
            background: '#22c55e', boxShadow: '0 0 8px #22c55e' }} />
          <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>
            RGB hardware connected successfully
          </span>
        </div>
      )}

      {/* Body */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      <ErrorBoundary label="App" autoRecover={false}>

        {/* ── DEVICES ── */}
        {tab === 'devices' && (
          <>
            {/* Sidebar */}
            <div style={{ width:300, flexShrink:0, borderRight:'1px solid rgba(255,255,255,0.06)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
              {!rgbConnected && (
                <div style={{ margin:12, padding:12, borderRadius:9, background:'rgba(239,180,68,0.07)', border:'1px solid rgba(239,180,68,0.2)', fontSize:11, color:'#f59e0b', lineHeight:1.7 }}>
                  {bridge.isElectron
                    ? <>Start OpenRGB with <code style={{ background:'rgba(0,0,0,0.3)', padding:'1px 5px', borderRadius:4 }}>--server</code> on port 6742, then Re-scan.</>
                    : <>Browser preview — run <code style={{ background:'rgba(0,0,0,0.3)', padding:'1px 5px', borderRadius:4 }}>npm start</code> for real devices.</>}
                </div>
              )}
              <div style={{ overflowY:'auto', flex:1, padding:'10px 12px', display:'flex', flexDirection:'column', gap:8 }}>
                {scanning && <div style={{ textAlign:'center', marginTop:50, color:'#00e5ff', fontSize:12 }}><div style={{ fontSize:24, animation:'spin 1s linear infinite', display:'inline-block', marginBottom:8 }}>⟳</div><div>Scanning hardware…</div></div>}
                {!scanning && devices.length === 0 && <div style={{ color:'#333', fontSize:12, textAlign:'center', marginTop:50, lineHeight:2 }}>{rgbConnected?'No devices found.\nCheck OpenRGB detects your hardware.':'Connect to OpenRGB first.'}</div>}
                {devices.map(d => {
                  const dc     = devColors[d.id]  || '#ff6b35';
                  const de     = devEffects[d.id] || 'static';
                  const active = selectedId === d.id;
                  const dState = getDeviceStatus(d.id);
                  const status = dState?.status || 'connected';
                  const isDown = status === 'disconnected' || status === 'reconnecting' || status === 'error';

                  const statusColor = status === 'connected'    ? '#22c55e'
                                    : status === 'reconnecting' ? '#f59e0b'
                                    : status === 'error'        ? '#ef4444'
                                    :                             '#555';
                  const statusLabel = status === 'connected'    ? '● live'
                                    : status === 'reconnecting' ? `↺ retry ${(dState?.retryAttempt||0)+1}/8`
                                    : status === 'error'        ? '✕ failed'
                                    :                             '○ offline';

                  return (
                    <div key={d.id}
                      onClick={() => !isDown && setSelectedId(active ? null : d.id)}
                      style={{ cursor: isDown?'default':'pointer', borderRadius:11, padding:'12px 13px',
                        background: isDown?'rgba(0,0,0,0.2)': active?'rgba(255,255,255,0.07)':'rgba(255,255,255,0.025)',
                        border: isDown?`1.5px solid ${statusColor}44`: active?`1.5px solid ${dc}`:'1.5px solid rgba(255,255,255,0.05)',
                        transition:'all 0.2s', position:'relative', overflow:'hidden',
                        opacity: isDown ? 0.65 : 1 }}>
                      <div style={{ position:'absolute', top:0, left:0, right:0, height:2,
                        background:`linear-gradient(90deg,transparent,${isDown?statusColor:dc},transparent)`,
                        opacity: active||isDown?1:0.4 }} />
                      <div style={{ fontSize:13, fontWeight:600, color: isDown?'#666':'#ddd', marginBottom:2 }}>{d.name}</div>
                      <div style={{ fontSize:10, color:'#555', marginBottom:7 }}>{d.vendor} · {d.leds} LEDs · {d.zones?.length} zone{d.zones?.length!==1?'s':''}</div>
                      <RGBStrip color={isDown?'#333':dc} effect={isDown?'static':de} speed={50} h={6} />
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
                        <span style={{ fontSize:9, color:'#444' }}>{isDown ? (dState?.snapshot?.effect||de) : de}</span>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          {status === 'error' && (
                            <button
                              onClick={e => { e.stopPropagation(); retryDevice(d.id); }}
                              style={{ fontSize:8, padding:'2px 7px', borderRadius:5, border:`1px solid ${statusColor}55`,
                                background:`${statusColor}18`, color:statusColor, cursor:'pointer',
                                fontFamily:"'Orbitron',sans-serif", fontWeight:700, letterSpacing:1 }}>
                              RETRY
                            </button>
                          )}
                          <span style={{ fontSize:9, color:statusColor,
                            animation: status==='reconnecting'?'glow 1s infinite':'none' }}>
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding:'8px 14px', borderTop:'1px solid rgba(255,255,255,0.05)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:10, color:'#444' }}>{devices.length} devices</span>
                {disconnectedCount > 0
                  ? <span style={{ fontSize:10, color:'#f59e0b', fontWeight:700 }}>⚠ {disconnectedCount} offline</span>
                  : <span style={{ fontSize:10, color:'#333' }}>source: OpenRGB</span>
                }
              </div>
            </div>

            {/* Editor */}
            <div style={{ flex:1, overflowY:'auto', padding:24 }}>
              {!sel ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', color:'#222', gap:10 }}>
                  <div style={{ fontSize:72 }}>◈</div>
                  <div style={{ fontSize:14, letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", color:'#333' }}>{devices.length > 0 ? 'Select a device' : 'No devices detected'}</div>
                  {!rgbConnected && <div style={{ fontSize:12, color:'#333', marginTop:8, textAlign:'center', maxWidth:360, lineHeight:1.8 }}>Start OpenRGB with <code style={{ background:'rgba(255,255,255,0.06)', padding:'1px 6px', borderRadius:4 }}>--server</code> on port 6742, then click Re-scan.</div>}
                </div>
              ) : (
                <div style={{ maxWidth:700 }}>
                  <div style={{ marginBottom:22 }}>
                    <div style={{ fontSize:22, fontWeight:700, color:'#fff', marginBottom:4 }}>{sel.name}</div>
                    <div style={{ fontSize:12, color:'#555' }}>{sel.vendor} · {sel.leds} LEDs · {sel.location||'USB'} · source: OpenRGB</div>
                  </div>

                  {sel.zones?.length > 0 && (
                    <div style={card}>
                      <LBL>Lighting Zones</LBL>
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        {sel.zones.map(z => (
                          <div key={z.id} style={{ padding:'7px 13px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:`1px solid ${selColor}44`, display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:8, height:8, borderRadius:'50%', background:selColor, boxShadow:`0 0 6px ${selColor}` }} />
                            <span style={{ fontSize:12 }}>{z.name}</span>
                            <span style={{ fontSize:10, color:'#555' }}>{z.ledCount} LEDs</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {sel.modes?.length > 0 && (
                    <div style={card}>
                      <LBL>Native Modes (from OpenRGB)</LBL>
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {sel.modes.map(m => (
                          <button key={m} onClick={() => { applyEffect(sel.id, m); notify(`✓ "${m}" → ${sel.name}`); }}
                            style={{ padding:'5px 11px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background: selEffect===m?'rgba(0,229,255,0.12)':'rgba(255,255,255,0.04)', color: selEffect===m?'#00e5ff':'#888', fontSize:11, cursor:'pointer' }}>
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                    <div style={card}>
                      <LBL>Colour</LBL>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
                        <ColorWheel value={selColor} onChange={c => applyColor(sel.id, c)} size={140} />
                        <input type="text" value={selColor} style={{ ...inp, textAlign:'center', width:120 }}
                          onChange={e => { if (isValidHex(e.target.value)) applyColor(sel.id, e.target.value); }} />
                      </div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                      <div style={card}>
                        <LBL>Effect Preview</LBL>
                        <select value={selEffect} onChange={e => applyEffect(sel.id, e.target.value)} style={selSt}>
                          {EFFECTS.map(ef => <option key={ef.id} value={ef.id}>{ef.name}</option>)}
                        </select>
                        <div style={{ marginTop:10 }}><RGBStrip color={selColor} effect={selEffect} speed={50} h={10} /></div>
                      </div>
                      <div style={card}>
                        <LBL>Brightness</LBL>
                        <input type="range" min={0} max={100} value={devBrightness[sel.id]||80}
                          onChange={e => setBrightness(sel.id, +e.target.value)}
                          style={{ accentColor:'#ffd700' }} />
                      </div>
                    </div>
                  </div>

                  <button onClick={() => { applyColor(sel.id, selColor); notify(`✓ Applied to ${sel.name}`); }}
                    style={{ width:'100%', padding:13, borderRadius:10, border:'1px solid rgba(0,229,255,0.3)', background:'rgba(0,229,255,0.1)', color:'#00e5ff', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:"'Orbitron',sans-serif", letterSpacing:2, marginTop:4 }}>
                    ✓ APPLY TO HARDWARE
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── DIGITAL TWIN ── */}
        {tab === 'twin' && (
          <DigitalTwin devices={devices} devColors={devColors} selectedDeviceId={selectedId}
            onSelectDevice={id => { setSelectedId(id); setTab('devices'); }} />
        )}

        {/* ── EFFECTS ── */}
        {tab === 'effects' && (
          <div style={{ flex:1, overflowY:'auto', padding:28 }}>
            <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Effects Library</div>
            <div style={{ fontSize:13, color:'#555', marginBottom:22 }}>Click Device to apply to selected device, All to apply everywhere.</div>
            {['Basic','Dynamic','Premium'].map(cat => (
              <div key={cat} style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, color:'#555', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:12 }}>{cat}</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:12 }}>
                  {EFFECTS.filter(e => e.cat === cat).map(ef => (
                    <div key={ef.id} style={card}>
                      <RGBStrip color={sel ? selColor : '#ff6b35'} effect={ef.id} speed={50} h={10} />
                      <div style={{ fontSize:13, fontWeight:600, color:'#ddd', margin:'10px 0' }}>{ef.name}</div>
                      <div style={{ display:'flex', gap:6 }}>
                        <button onClick={() => { if (!sel) { notify('Select a device first','error'); return; } applyEffect(sel.id, ef.id); notify(`✓ "${ef.name}" → ${sel.name}`); }}
                          style={{ flex:1, padding:'6px 0', borderRadius:6, border:'none', cursor:'pointer', background:'rgba(0,229,255,0.1)', color:'#00e5ff', fontSize:9, fontWeight:700, fontFamily:"'Orbitron',sans-serif" }}>Device</button>
                        <button onClick={async () => { for (const d of devices) await applyEffect(d.id, ef.id); notify(`✓ "${ef.name}" → all`); }}
                          style={{ flex:1, padding:'6px 0', borderRadius:6, border:'none', cursor:'pointer', background:'rgba(168,85,247,0.1)', color:'#a855f7', fontSize:9, fontWeight:700, fontFamily:"'Orbitron',sans-serif" }}>All</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── SYNC ── */}
        {tab === 'sync' && (
          <SyncPanel devices={devices} onSyncAll={syncAll} onApplyColor={applyColor} notify={notify} />
        )}

        {/* ── GAMES ── */}
        {tab === 'games' && (
          <GameIntegrationsPanel onApplyRGB={applyGameRGB} onSetActiveGame={setActiveGame} devices={devices} />
        )}

        {/* ── APP RGB ── */}
        {tab === 'apps' && (
          <div style={{ flex:1, overflowY:'auto', padding:28 }}>
            <div style={{ maxWidth:680 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <div style={{ fontSize:20, fontWeight:700 }}>App RGB</div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  {appIntegrations.activeApp && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:20,
                      background:`${appIntegrations.activeApp.rgb.color}18`, border:`1px solid ${appIntegrations.activeApp.rgb.color}44` }}>
                      <span style={{ fontSize:14 }}>{appIntegrations.activeApp.icon}</span>
                      <span style={{ fontSize:11, color: appIntegrations.activeApp.rgb.color, fontWeight:700 }}>
                        {appIntegrations.activeApp.name} active
                      </span>
                    </div>
                  )}
                  {activeGame && (
                    <div style={{ padding:'4px 12px', borderRadius:20, background:'rgba(239,68,68,0.1)',
                      border:'1px solid rgba(239,68,68,0.3)', fontSize:11, color:'#ef4444', fontWeight:700 }}>
                      ⏸ Paused — game running
                    </div>
                  )}
                  <button
                    onClick={() => appIntegrations.setAppEnabled(!appIntegrations.appEnabled)}
                    style={{ padding:'6px 14px', borderRadius:8, border:`1px solid ${appIntegrations.appEnabled ? 'rgba(34,197,94,0.3)' : 'rgba(100,100,100,0.3)'}`,
                      background: appIntegrations.appEnabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,100,100,0.1)',
                      color: appIntegrations.appEnabled ? '#22c55e' : '#555', fontSize:10, fontWeight:700,
                      cursor:'pointer', fontFamily:"'Orbitron',sans-serif", letterSpacing:1 }}>
                    {appIntegrations.appEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
              <div style={{ fontSize:13, color:'#555', marginBottom:22, lineHeight:1.8 }}>
                Auto-applies RGB profiles when these apps are detected. Game profiles take priority.
                {!bridge.isElectron && <span style={{ color:'#f59e0b' }}> · Detection requires Electron (desktop app).</span>}
              </div>

              {/* Running apps row */}
              {appIntegrations.runningApps.length > 0 && (
                <div style={{ marginBottom:20, padding:14, borderRadius:10, background:'rgba(0,229,255,0.04)', border:'1px solid rgba(0,229,255,0.12)' }}>
                  <div style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:10 }}>Detected right now</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {appIntegrations.runningApps.map(app => (
                      <div key={app.id} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:20,
                        background:`${app.rgb.color}14`, border:`1px solid ${app.rgb.color}55` }}>
                        <span>{app.icon}</span>
                        <span style={{ fontSize:11, color: app.rgb.color, fontWeight:600 }}>{app.name}</span>
                        {app.id === appIntegrations.activeApp?.id && (
                          <span style={{ fontSize:9, color: app.rgb.color, opacity:0.7 }}>● live</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All profiles grid */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:12 }}>
                {APP_PROFILES.map(app => {
                  const isActive  = appIntegrations.activeApp?.id === app.id;
                  const isRunning = appIntegrations.runningApps.some(r => r.id === app.id);
                  return (
                    <div key={app.id} style={{ borderRadius:11, padding:14,
                      background: isActive ? `${app.rgb.color}0e` : 'rgba(255,255,255,0.025)',
                      border: isActive ? `1.5px solid ${app.rgb.color}66` : isRunning ? `1.5px solid ${app.rgb.color}33` : '1.5px solid rgba(255,255,255,0.06)',
                      transition:'all 0.2s', position:'relative', overflow:'hidden' }}>
                      {isActive && <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${app.rgb.color},transparent)` }} />}
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:20 }}>{app.icon}</span>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600, color:'#ddd' }}>{app.name}</div>
                            <div style={{ fontSize:9, color:'#444', marginTop:2 }}>{app.processes[0]}</div>
                          </div>
                        </div>
                        <div style={{ width:10, height:10, borderRadius:'50%', background: app.rgb.color,
                          boxShadow: isActive ? `0 0 10px ${app.rgb.color}` : 'none', flexShrink:0, marginTop:4 }} />
                      </div>
                      <RGBStrip color={app.rgb.color} effect={app.rgb.effect} speed={app.rgb.speed ?? 40} h={6} />
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
                        <span style={{ fontSize:10, color:'#444' }}>{app.rgb.effect} · {app.rgb.brightness}%</span>
                        <button
                          onClick={() => appIntegrations.forceApply(app)}
                          style={{ fontSize:8, padding:'3px 9px', borderRadius:5, cursor:'pointer', fontWeight:700,
                            fontFamily:"'Orbitron',sans-serif", letterSpacing:0.8,
                            border:`1px solid ${app.rgb.color}44`, background:`${app.rgb.color}18`, color: app.rgb.color }}>
                          APPLY
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── ADAPTIVE TELEMETRY RGB ── */}
        {tab === 'adaptive' && (
          <AdaptiveTelemetryRGB
            devices={devices}
            bridge={bridge}
            onApplyColor={applyColor}
            onApplyEffect={applyEffect}
            notify={notify}
          />
        )}

        {/* ── AUTO DETECT ── */}
        {tab === 'autodetect' && (
          <GameAutoDetect onApplyRGB={applyGameRGB} onSetActiveGame={setActiveGame} notify={notify} />
        )}

        {/* ── TELEMETRY ── */}
        {tab === 'telemetry' && (
          <ErrorBoundary label="Telemetry" tab autoRecoverMs={5000}>
            <TelemetryPanel telemetry={telemetry} onApplyAll={applyTelemetryColor} />
          </ErrorBoundary>
        )}

        {/* ── AI STUDIO ── */}
        {tab === 'ai' && (
          <ErrorBoundary label="AI Studio" tab autoRecoverMs={6000}>
          <AIStudio
            devices={devices}
            selectedDevice={sel}
            telemetry={telemetry}
            onApplyAll={(scene) => applyScene(scene)}
            onApplyDevice={(scene, dev) => applyScene(scene, dev)}
          />
          </ErrorBoundary>
        )}

        {/* ── PROFILES ── */}
        {tab === 'profiles' && (
          <ProfileSystem
            devices={devices}
            devColors={devColors}
            devEffects={devEffects}
            devBrightness={devBrightness}
            onLoadProfile={loadProfile}
            bridge={bridge}
            notify={notify}
          />
        )}

        {/* ── SETTINGS ── */}
        {tab === 'settings' && (
          <div style={{ flex:1, overflowY:'auto', padding:28 }}>
            <div style={{ maxWidth:560 }}>
              <div style={{ fontSize:20, fontWeight:700, marginBottom:20 }}>Settings</div>
              <div style={card}>
                <LBL>OpenRGB</LBL>
                <div style={{ fontSize:13, color:'#666', marginBottom:12, lineHeight:1.8 }}>
                  Status: <span style={{ color: rgbConnected?'#22c55e':'#ef4444', fontWeight:700 }}>{rgbConnected?'Connected':'Disconnected'}</span><br/>
                  Connects to OpenRGB on <code style={{ background:'rgba(255,255,255,0.06)', padding:'1px 5px', borderRadius:4 }}>localhost:6742</code>
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={reconnect}
                    style={{ padding:'9px 18px', borderRadius:8, border:'1px solid rgba(34,197,94,0.3)', background:'rgba(34,197,94,0.1)', color:'#22c55e', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:"'Orbitron',sans-serif" }}>Connect</button>
                  <button onClick={disconnect}
                    style={{ padding:'9px 18px', borderRadius:8, border:'1px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.1)', color:'#ef4444', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:"'Orbitron',sans-serif" }}>Disconnect</button>
                </div>
              </div>
              <div style={card}>
                <LBL>About</LBL>
                {[['App','Nexus RGB OS v6.0'],['Hardware','OpenRGB SDK (port 6742)'],['AI','Google Gemini 3.5 Flash — free API key at aistudio.google.com'],['Telemetry','systeminformation (Node.js)'],['Games','F1 UDP · CS2 GSI · Valorant event log'],['Platform','Windows 10/11 · Electron']].map(([k,v]) => (
                  <div key={k} style={{ display:'flex', gap:12, fontSize:12, marginBottom:6 }}>
                    <span style={{ color:'#444', minWidth:120 }}>{k}</span>
                    <span style={{ color:'#777' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </ErrorBoundary>
      </div>
    </div>
  );
}


