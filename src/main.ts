import './style.css';
import { startDemoScene } from './world/demo-scene';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');
startDemoScene(root);
