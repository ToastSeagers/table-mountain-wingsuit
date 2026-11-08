import './style.css';
import { startWorld } from './world';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
const params = new URLSearchParams(window.location.search);
void startWorld(root, { dev: params.get('dev') === '1', view: params.get('view') });
