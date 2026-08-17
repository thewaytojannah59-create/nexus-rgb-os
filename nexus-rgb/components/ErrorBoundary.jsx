// ============================================================
// Nexus RGB OS — Error Boundary (Upgraded)
// ============================================================
// - Wraps the whole app AND each tab individually
// - Tab crash = only that tab shows error, rest of app works
// - Auto-recovers after 8 seconds (configurable)
// - Hard reload button as last resort
// - Crash counter — 3+ crashes → suggests hard reload
// - Clean on-brand UI, not a white screen of death
// ============================================================
import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError:     false,
      error:        null,
      errorInfo:    null,
      errorCount:   0,
      isRecovering: false,
      countdown:    null,
    };
    this._countdownInterval = null;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState(prev => ({
      error,
      errorInfo,
      errorCount: prev.errorCount + 1,
    }));

    console.error('[Nexus ErrorBoundary] Crash caught:', error);
    console.error('[Nexus ErrorBoundary] Stack:', errorInfo?.componentStack);

    // Auto-recover after `autoRecoverMs` ms (default 8s) unless disabled
    const delay = this.props.autoRecoverMs ?? 8000;
    if (this.props.autoRecover !== false && delay > 0) {
      let secs = Math.round(delay / 1000);
      this.setState({ countdown: secs });
      this._countdownInterval = setInterval(() => {
        secs -= 1;
        if (secs <= 0) {
          clearInterval(this._countdownInterval);
          this.handleRecover();
        } else {
          this.setState({ countdown: secs });
        }
      }, 1000);
    }
  }

  componentWillUnmount() {
    clearInterval(this._countdownInterval);
  }

  handleRecover = () => {
    clearInterval(this._countdownInterval);
    this.setState({ isRecovering: true, countdown: null });
    setTimeout(() => {
      this.setState({
        hasError: false, error: null, errorInfo: null,
        isRecovering: false, countdown: null,
      });
    }, 400);
  };

  handleHardReload = () => {
    try { window.NexusOS?.window?.reload?.(); } catch {}
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo, errorCount, isRecovering, countdown } = this.state;
    const { children, label = 'component' } = this.props;

    if (!hasError) return children;

    const repeated = errorCount >= 3;
    const isTab    = this.props.tab === true;

    return (
      <div style={{
        flex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: isTab ? 'transparent' : '#030308',
        minHeight: isTab ? 320 : '100vh',
        padding: 32,
        fontFamily: "'Rajdhani', sans-serif",
      }}>
        {/* Icon */}
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: repeated ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
          border: `1.5px solid ${repeated ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, marginBottom: 20,
        }}>
          {repeated ? '🔴' : '⚠️'}
        </div>

        {/* Title */}
        <div style={{ fontSize: 18, fontWeight: 700, color: '#ddd', marginBottom: 8, textAlign: 'center' }}>
          {repeated ? 'Repeated Crash Detected' : `${label} crashed`}
        </div>

        {/* Subtitle */}
        <div style={{ fontSize: 13, color: '#555', marginBottom: 24,
          textAlign: 'center', maxWidth: 380, lineHeight: 1.7 }}>
          {isTab
            ? 'This tab ran into an error. The rest of the app is still running.'
            : 'Something went wrong. Your RGB settings and profiles are safe.'}
          {repeated && ' Consider a hard reload if this keeps happening.'}
        </div>

        {/* Error message (collapsed by default) */}
        <details style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 10, padding: '10px 16px',
          marginBottom: 22, maxWidth: 480, width: '100%',
          fontSize: 11, textAlign: 'left',
        }}>
          <summary style={{ cursor: 'pointer', color: '#f59e0b',
            fontWeight: 600, marginBottom: 6, fontFamily: "'Orbitron',sans-serif",
            fontSize: 9, letterSpacing: 1 }}>
            ERROR DETAILS
          </summary>
          <pre style={{ color: '#666', overflow: 'auto', maxHeight: 180,
            fontSize: 10, lineHeight: 1.6, marginTop: 8 }}>
            {error?.toString()}
            {'\n\n'}
            {errorInfo?.componentStack?.trim()}
          </pre>
        </details>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={this.handleRecover} disabled={isRecovering}
            style={{ padding: '11px 24px', borderRadius: 10,
              border: '1px solid rgba(34,197,94,0.35)',
              background: isRecovering ? 'rgba(100,100,100,0.1)' : 'rgba(34,197,94,0.1)',
              color: isRecovering ? '#555' : '#22c55e',
              fontSize: 11, fontWeight: 700, cursor: isRecovering ? 'not-allowed' : 'pointer',
              fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>
            {isRecovering ? '⟳ Recovering…' : '↺ Recover'}
          </button>

          <button onClick={this.handleHardReload}
            style={{ padding: '11px 24px', borderRadius: 10,
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(239,68,68,0.07)',
              color: '#ef4444', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', fontFamily: "'Orbitron',sans-serif", letterSpacing: 1 }}>
            ⟳ Hard Reload
          </button>
        </div>

        {/* Auto-recover countdown */}
        {countdown !== null && (
          <div style={{ marginTop: 18, fontSize: 11, color: '#333' }}>
            Auto-recovering in{' '}
            <span style={{ color: '#22c55e', fontWeight: 700 }}>{countdown}s</span>
            {' '}·{' '}
            <span onClick={() => { clearInterval(this._countdownInterval); this.setState({ countdown: null }); }}
              style={{ color: '#444', cursor: 'pointer', textDecoration: 'underline' }}>
              cancel
            </span>
          </div>
        )}

        {/* Crash count badge */}
        {errorCount > 1 && (
          <div style={{ marginTop: 14, fontSize: 10, color: '#333',
            padding: '3px 10px', borderRadius: 20,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)' }}>
            Crashed {errorCount} times this session
          </div>
        )}
      </div>
    );
  }
}

export default ErrorBoundary;
