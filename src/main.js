import './global.css';
import { RoadRashGame } from './game/RoadRashGame.js';

const canvas = document.querySelector('#game-canvas');

function showWebglError(reason) {
  const panel = document.querySelector('#webgl-error');
  if (!panel) return;
  const detail = panel.querySelector('[data-webgl-reason]');
  if (detail && reason) detail.textContent = reason;
  panel.classList.add('is-visible');
}

function diagnoseWebGL2() {
  if (typeof WebGL2RenderingContext === 'undefined') {
    return 'Your browser is too old to support WebGL 2. Update Chrome, Edge, Firefox, or Safari.';
  }

  let probe;
  try {
    probe = document.createElement('canvas').getContext('webgl2');
  } catch (err) {
    return `WebGL 2 context creation threw: ${err.message}`;
  }

  if (!probe) {
    const hints = [];
    const agent = navigator.userAgent.toLowerCase();
    if (/headless|phantomjs|electron/.test(agent)) {
      hints.push('this looks like a headless/embedded environment without GPU access');
    }
    if (navigator.webdriver) {
      hints.push('the page is being automated, which often disables GPU rendering');
    }
    hints.push('hardware acceleration may be disabled or the GPU may be blocklisted');
    return `The browser refused a WebGL 2 context (${hints.join('; ')}).`;
  }

  return null;
}

try {
  const reason = diagnoseWebGL2();
  if (reason) {
    console.error('WebGL 2 unavailable:', reason);
    showWebglError(reason);
  } else {
    const game = new RoadRashGame(canvas);
    game.init();
    window.roadRashGame = game;
  }
} catch (error) {
  console.error(error);
  showWebglError(error && error.message ? error.message : 'Failed to initialize the 3D renderer.');
}

