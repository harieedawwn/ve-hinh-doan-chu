import { render } from 'preact';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/vietnamese-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/baloo-2/vietnamese-800.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import './styles.css';
import { App } from './app.tsx';
import { applyTheme } from './prefs.ts';
import { initViewport, stripUnknownQuery } from './platform.ts';
import { initSound } from './sound.ts';
import { getSurface, session } from './session.ts';

stripUnknownQuery();
applyTheme();
initViewport();
initSound();
render(<App />, document.getElementById('app')!);

// read-only hook for automated checks (Playwright); it exposes state, never the secret of other players
(window as unknown as Record<string, unknown>).__vhdc = {
  get client() { return session.client; },
  get surface() { return getSurface(); },
  get gallery() { return session.gallery; },
  pixelHash: async () => { const { pixelHash } = await import('../../shared/canvas/engine.ts'); const s = getSurface(); s.playback.flush(); return pixelHash(s.engine.pixels()); },
};
