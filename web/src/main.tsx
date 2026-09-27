import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import Shell from './presentation/Shell';
import {trackViewport} from './presentation/viewport';
import './style.css';

const stopViewport = trackViewport();
if (import.meta.hot) import.meta.hot.dispose(stopViewport);
createRoot(document.getElementById('root')!).render(<Shell/>);
const update = registerSW({
  onNeedRefresh: () => window.dispatchEvent(new Event('pindou-update')),
  onOfflineReady: () => window.dispatchEvent(new Event('pindou-offline-ready')),
});
window.addEventListener('pindou-install-update', () => { void update(true); });
