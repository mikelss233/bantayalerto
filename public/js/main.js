// Entry point: find out who is logged in, then draw the page for the current #/ address.
import { api, state } from './core.js';
import { route } from './router.js';

window.addEventListener('hashchange', route);
(async () => { try { state.me = (await api('/auth/me')).user; } catch { /* anonymous */ } route(); })();
