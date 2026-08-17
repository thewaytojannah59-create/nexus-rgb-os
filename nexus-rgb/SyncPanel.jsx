import { useState, useRef, useEffect, useCallback } from 'react';
import { hexToRgb, hslToHex, rgbToHex, hexWithAlpha } from './color';

const EFFECTS = ['static','breathing','rainbow_wave','color_cycle','pulse','aurora','fire','matrix_rain','comet','ripple','ice_storm','heartbeat','northern_lights','hyperdrive'];
const QUICK   = ['#ff0000','#ff6600','#ffff00','#00ff00','#00ffff','#0066ff','#aa00ff','#ff00ff','#ffffff','#ff6b35','#00e5ff','#22c55e'];

function ColorWheel({ value, onChange, size = 150 }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); const cx = size/2, cy = size/2, r = size/2 - 4;
    for (let a = 0; a < 360; a++) {
      const grd = ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      grd.addColorStop(0,'white'); grd.addColorStop(1,hslToHex(a,100,50));
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,(a-1)*Math.PI/180,(a+1)*Math.PI/180); ctx.closePath();
      ctx.fillStyle = grd; ctx.fill();
    }
  }, [size]);
  const pick = useCallback(e => {
    const c = ref.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * size;
    const y = ((e.clientY - rect.top)  / rect.height) * size;
    if (Math.hypot(x - size/2, y - size/2) > size/2 - 2) return;
    const [r,g,b] = c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data;
    onChange?.(rgbToHex(r,g,b));
  }, [size, onChange]);
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
      <canvas ref={ref} width={size} height={size}
        style={{ borderRadius:'50%', cursor:'crosshair', display:'block' }}
        onMouseDown={e => { setDrag(true); pick(e); }}
        onMouseMove={e => { if (drag) pick(e); }}
        onMouseUp={() => setDrag(false)} onMouseLeave={() => setDrag(false)} />
      <div style={{ width:50, height:18, borderRadius:9, background:value, border:'2px solid rgba(255,255,255,0.15)', boxShadow:`0 0 14px ${value}99` }} />
    </div>
  );
}

export default function SyncPanel({ devices = [], onSyncAll, onApplyColor, notify }) {
  const [color,      setColor]      = useState('#ff6b35');
  const [effect,     setEffect]     = useState('rainbow_wave');
  const [brightness, setBrightness] = useState(80);
  const [speed,      setSpeed]      = useState(50);
  const [syncing,    setSyncing]    = useState(false);
  const connected = devices.filter(d => d.connected !== false);

  const handleSync = async () => {
    if (!connected.length) { notify?.('No connected devices', 'error'); return; }
    setSyncing(true);
    await onSyncAll?.({ color, effect, brightness, speed });
    notify?.(`✓ Synced ${connected.length} devices`);
    setSyncing(false);
  };

  const handleQuickColor = async hex => {
    setColor(hex);
    if (onApplyColor) {
      for (const d of connected) await onApplyColor(d.id, hex);
      notify?.(`✓ ${hex} applied to all`);
    }
  };

  const card = { background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:18, marginBottom:16 };
  const LBL  = ({ c }) => <div style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:10 }}>{c}</div>;
  const sel  = { width:'100%', padding:'9px 12px', background:'#0a0a18', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, color:'#fff', fontSize:13, outline:'none' };

  return (
    <div style={{ flex:1, overflowY:'auto', padding:24 }}>
      <div style={{ maxWidth:680 }}>
        <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>Universal Sync</div>
        <div style={{ fontSize:13, color:'#555', marginBottom:22 }}>Push one colour/effect to all {connected.length} connected devices at once via OpenRGB.</div>

        <div style={card}>
          <LBL c="Quick Colours — instant apply" />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {QUICK.map(c => (
              <button key={c} onClick={() => handleQuickColor(c)}
                style={{ width:34, height:34, borderRadius:8, background:c, border: color===c ? '3px solid #fff' : '2px solid transparent', cursor:'pointer', boxShadow:`0 0 10px ${c}88`, transition:'all 0.15s' }} />
            ))}
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:16, marginBottom:16 }}>
          <div style={{ ...card, marginBottom:0, display:'flex', flexDirection:'column', alignItems:'center' }}>
            <LBL c="Master Colour" />
            <ColorWheel value={color} onChange={setColor} size={148} />
            <input value={color} onChange={e => setColor(e.target.value)}
              style={{ marginTop:12, padding:'6px 10px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#fff', fontSize:12, fontFamily:"'Share Tech Mono',monospace", width:110, textAlign:'center', outline:'none' }} />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ ...card, marginBottom:0 }}>
              <LBL c="Global Effect" />
              <select value={effect} onChange={e => setEffect(e.target.value)} style={sel}>
                {EFFECTS.map(ef => <option key={ef} value={ef}>{ef.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
              </select>
            </div>
            {[['Master Brightness', brightness, setBrightness,'#ffd700'],['Master Speed', speed, setSpeed,'#00e5ff']].map(([lbl,val,set,c]) => (
              <div key={lbl} style={{ ...card, marginBottom:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif" }}>{lbl}</span>
                  <span style={{ fontSize:13, color:c, fontWeight:700 }}>{val}%</span>
                </div>
                <input type="range" min={0} max={100} value={val} onChange={e => set(+e.target.value)} style={{ accentColor:c }} />
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleSync} disabled={syncing || !connected.length}
          style={{ width:'100%', padding:15, borderRadius:12, border:'1px solid rgba(0,229,255,0.3)', background: syncing?'rgba(50,50,50,0.2)':'linear-gradient(135deg,rgba(0,229,255,0.18),rgba(168,85,247,0.14))', color: syncing?'#555':'#fff', fontSize:13, fontWeight:700, cursor: syncing||!connected.length?'not-allowed':'pointer', fontFamily:"'Orbitron',sans-serif", letterSpacing:2, marginBottom:20 }}>
          {syncing ? '⟳ Applying…' : `⟳ SYNC ALL ${connected.length} DEVICES`}
        </button>

        <div style={card}>
          <LBL c="Device Status" />
          {devices.length === 0 && <div style={{ color:'#333', fontSize:12, textAlign:'center', padding:20 }}>No devices — run scan first</div>}
          {devices.map(d => (
            <div key={d.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'rgba(255,255,255,0.02)', borderRadius:7, border:'1px solid rgba(255,255,255,0.04)', marginBottom:5 }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e' }} />
              <span style={{ flex:1, fontSize:12, color:'#bbb' }}>{d.name}</span>
              <span style={{ fontSize:10, color:'#444' }}>{d.vendor}</span>
              <span style={{ fontSize:10, color:'#333' }}>{d.leds} LEDs</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
