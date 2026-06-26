import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Top-level error boundary: in a sandboxed portal iframe a normally-safe API can throw
// synchronously, and React 19 unmounts the whole tree on any render throw → blank screen,
// the worst outcome on a discovery-driven portal. Contain it to a recoverable fallback.
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info);
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    // Inline styles only — CSS may itself have failed to load.
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px',
        background: '#05070f', color: '#cfd9ff', fontFamily: 'system-ui, sans-serif',
        textAlign: 'center', padding: '24px',
      }}>
        <div style={{ fontSize: '20px', letterSpacing: '2px', color: '#4bcffa' }}>SIGNAL LOST</div>
        <div style={{ fontSize: '14px', opacity: 0.8, maxWidth: '420px', lineHeight: 1.5 }}>
          Something went wrong loading the grid. A reload usually clears it.
        </div>
        <button
          onClick={() => location.reload()}
          style={{
            marginTop: '4px', padding: '10px 28px', borderRadius: '8px', cursor: 'pointer',
            background: 'linear-gradient(#3ad6ff,#4bcffa)', color: '#021018', border: 'none',
            fontFamily: 'system-ui, sans-serif', fontWeight: 700, letterSpacing: '2px',
          }}
        >RELOAD</button>
      </div>
    );
  }
}

// Last-resort logging so an async throw never silently kills features (and never crashes).
window.addEventListener('error', (e) => console.warn('window error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.warn('unhandled rejection', e.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  });
}
