import './style.css';
import './ui/ui.css';
import { Game } from './game/Game';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
const params = new URLSearchParams(window.location.search);
const dev = params.get('dev') === '1';

Game.create({
  container: root,
  dev,
  auto: dev && params.get('auto') === '1',
  startExit: dev ? params.get('exit') : null,
}).catch((err: unknown) => {
  // A bad data file or a missing WebGL context should say so on the page, not just in the console.
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:0;margin:0;padding:2rem;background:#1b1230;color:#ff5e5b;font:14px/1.5 monospace;white-space:pre-wrap';
  box.textContent = `Table Mountain Wingsuit could not start.\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.appendChild(box);
  throw err;
});
