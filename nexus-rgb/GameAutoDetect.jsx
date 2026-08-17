// ============================================================
// Nexus RGB OS — Game Auto Detection
// Monitors real Windows processes every 3 seconds.
// When a game launches → automatically applies its RGB preset.
// Shows which games are currently running.
// ============================================================
import { useState, useEffect, useCallback } from 'react';
import { hexWithAlpha } from './color';
import GAME_PROFILES from '../shared/gameProfiles.json';

const isElectron = typeof window !== 'undefined' && window.NexusOS?.isElectron;

export default function GameAutoDetect({ onApplyRGB, notify }) {
  const [enabled,      setEnabled]      = useState(false);
  const [activeGames,  setActiveGames]  = useState([]);
  const [allProfiles,  setAllProfiles]  = useState(GAME_PROFILES);
  const [log,          setLog]          = useState([]);
  const [autoApply,    setAutoApply]    = useState(true);  // auto push RGB on detect

  const addLog = useCallback((msg, color = '#888') => {
    setLog(l => [{ msg, color, ts: Date.now() }, ...l.slice(0, 49)]);
  }, []);

  // Start/stop detector
  useEffect(() => {
    if (!isElectron || !window.NexusOS?.detector) return;

    if (enabled) {
      // Access detector through safe accessor — never assume it exists
      const detector = window.NexusOS?.detector;
      if (!detector) {
        addLog('● Detector API not available in this build', '#f59e0b');
        return;
      }

      detector.start();
      addLog('● Process monitor started — scanning every 3s', '#22c55e');

      const unsubUpdate    = detector.onUpdate(games => setActiveGames(games));
      const unsubDetected  = detector.onDetected(profile => {
        addLog(`▶ ${profile.name} detected`, profile.rgb.color);
        notify?.(`🎮 ${profile.name} detected — applying RGB`);
        if (autoApply) onApplyRGB?.({ color: profile.rgb.color, effect: profile.rgb.effect });
      });
      const unsubStopped   = detector.onStopped(profile => {
        addLog(`■ ${profile.name} closed`, '#555');
        notify?.(`${profile.name} closed`);
      });

      return () => {
        detector.stop();
        unsubUpdate?.(); unsubDetected?.(); unsubStopped?.();
        addLog('● Process monitor stopped', '#555');
      };
    }
  }, [enabled, autoApply, onApplyRGB, notify, addLog]);

  const card = { background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, padding:18, marginBottom:16 };
  const LBL  = ({ c }) => <div style={{ fontSize:9, color:'#444', letterSpacing:2, textTransform:'uppercase', fontFamily:"'Orbitron',sans-serif", marginBottom:10 }}>{c}</div>;

  return (
    <div style={{ flex:1, overflowY:'auto', padding:24 }}>
      <div style={{ maxWidth:760 }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:800, marginBottom:6 }}>🎮 Game Auto Detection</div>
            <div style={{ fontSize:13, color:'#666', lineHeight:1.7, maxWidth:500 }}>
              Watches your Windows process list in real time. When a game starts, Nexus automatically loads that game's RGB preset. No manual switching needed.
              {!isElectron && <span style={{ color:'#f59e0b' }}> Requires Electron app (npm start).</span>}
            </div>
          </div>
          {/* Master toggle */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flexShrink:0, marginLeft:20 }}>
            <div onClick={() => setEnabled(e => !e)}
              style={{ width:56, height:28, borderRadius:14, background: enabled?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.06)', border:`1px solid ${enabled?'#22c55e':'rgba(255,255,255,0.1)'}`, position:'relative', cursor:'pointer', transition:'all 0.3s', boxShadow: enabled?'0 0 16px rgba(34,197,94,0.3)':'none' }}>
              <div style={{ position:'absolute', top:3, left: enabled?29:3, width:20, height:20, borderRadius:'50%', background: enabled?'#22c55e':'#444', transition:'all 0.3s', boxShadow: enabled?'0 0 10px #22c55e':'none' }} />
            </div>
            <span style={{ fontSize:10, color: enabled?'#22c55e':'#555', fontWeight:700, fontFamily:"'Orbitron',sans-serif" }}>{enabled?'ON':'OFF'}</span>
          </div>
        </div>

        {/* Options */}
        <div style={card}>
          <LBL c="Options" />
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'rgba(255,255,255,0.02)', borderRadius:9, border:'1px solid rgba(255,255,255,0.06)' }}>
            <div onClick={() => setAutoApply(a => !a)}
              style={{ width:36, height:20, borderRadius:10, background: autoApply?'rgba(0,229,255,0.3)':'rgba(255,255,255,0.06)', border:`1px solid ${autoApply?'#00e5ff':'rgba(255,255,255,0.1)'}`, position:'relative', cursor:'pointer', transition:'all 0.2s', flexShrink:0 }}>
              <div style={{ position:'absolute', top:2, left: autoApply?17:2, width:14, height:14, borderRadius:'50%', background: autoApply?'#00e5ff':'#444', transition:'all 0.2s' }} />
            </div>
            <div>
              <div style={{ fontSize:13, color:'#ccc', fontWeight:500 }}>Auto-apply RGB on game launch</div>
              <div style={{ fontSize:11, color:'#555' }}>Automatically push the game's colour preset to all devices when detected</div>
            </div>
          </div>
        </div>

        {/* Currently running */}
        <div style={card}>
          <LBL c={`Currently Running (${activeGames.length})`} />
          {activeGames.length === 0 ? (
            <div style={{ fontSize:12, color:'#333', textAlign:'center', padding:'20px 0' }}>
              {enabled ? 'No known games detected — waiting…' : 'Enable detection above to start scanning'}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {activeGames.map(p => (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:10, background:hexWithAlpha(p.rgb.color, 0.08), border:`1px solid ${hexWithAlpha(p.rgb.color, 0.35)}` }}>
                  <span style={{ fontSize:24 }}>{p.icon || '🎮'}</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:p.rgb.color }}>{p.name}</div>
                    <div style={{ fontSize:11, color:'#555' }}>Effect: {p.rgb.effect} · {p.rgb.brightness}% brightness</div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 8px #22c55e', animation:'glow 1.5s infinite' }} />
                  <button onClick={() => { onApplyRGB?.({ color:p.rgb.color, effect:p.rgb.effect }); notify?.(`✓ Applied ${p.name} preset`); }}
                    style={{ padding:'6px 14px', borderRadius:7, border:`1px solid ${hexWithAlpha(p.rgb.color,0.4)}`, background:hexWithAlpha(p.rgb.color,0.15), color:p.rgb.color, fontSize:10, fontWeight:700, cursor:'pointer', fontFamily:"'Orbitron',sans-serif" }}>
                    Apply
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* All supported games grid */}
        <div style={card}>
          <LBL c={`Supported Games & Apps (${allProfiles.length})`} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:8 }}>
            {allProfiles.map(p => {
              const isActive = activeGames.some(g => g.id === p.id);
              return (
                <div key={p.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:9,
                  background: isActive ? hexWithAlpha(p.rgb.color,0.1) : 'rgba(255,255,255,0.02)',
                  border: isActive ? `1px solid ${hexWithAlpha(p.rgb.color,0.4)}` : '1px solid rgba(255,255,255,0.05)',
                  transition:'all 0.2s' }}>
                  <span style={{ fontSize:18, flexShrink:0 }}>{p.icon || '🎮'}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color: isActive ? p.rgb.color : '#888', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize:9, color:'#444' }}>{p.processes[0]}</div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background: isActive?'#22c55e':'#222', boxShadow: isActive?'0 0 6px #22c55e':'none', transition:'all 0.3s' }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Event log */}
        {log.length > 0 && (
          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <LBL c="Detection Log" />
              <button onClick={() => setLog([])} style={{ fontSize:10, color:'#444', background:'none', border:'none', cursor:'pointer' }}>Clear</button>
            </div>
            <div style={{ maxHeight:200, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
              {log.map((entry, i) => (
                <div key={i} style={{ display:'flex', gap:10, fontSize:11, padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ color:'#333', flexShrink:0, fontFamily:"'Share Tech Mono',monospace" }}>
                    {new Date(entry.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                  </span>
                  <span style={{ color:entry.color }}>{entry.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How it works */}
        <div style={{ ...card, border:'1px solid rgba(255,255,255,0.05)' }}>
          <LBL c="How It Works" />
          <div style={{ fontSize:12, color:'#555', lineHeight:2 }}>
            1. Toggle ON above — Nexus runs <code style={{ background:'rgba(255,255,255,0.06)', padding:'1px 5px', borderRadius:4, color:'#aaa' }}>tasklist /fo csv</code> every 3 seconds<br/>
            2. When a matching process appears → instantly applies that game's RGB preset<br/>
            3. When the process closes → logs it (keeps last profile active)<br/>
            4. Windows only — uses native process list, no game modification needed<br/>
            5. Add custom games to <code style={{ background:'rgba(255,255,255,0.06)', padding:'1px 5px', borderRadius:4, color:'#a855f7' }}>shared/gameProfiles.json</code>
          </div>
        </div>
      </div>
      <style>{`@keyframes glow{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
}
