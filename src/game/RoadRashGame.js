import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AudioEngine } from './AudioEngine.js';
import {
  createBike,
  createCockpit,
  createCar,
  createSky,
  createMountains,
  createMistParticles,
  createPalm,
  createStreetLight,
  createBuilding,
  createWindowTexture,
  createRoadTexture,
  preloadBikeModel,
  mulberry32,
} from './visuals.js';
import {
  PLAYER_Z,
  SEGMENT_COUNT,
  SEGMENT_LENGTH,
  ROAD_WIDTH,
  ROAD_HALF,
  LANES,
  RIVAL_CONFIG,
  CAR_COLORS,
  MAX_SPEED,
  BOOST_SPEED,
  RACE_LENGTH,
  delay,
  clamp,
  lerp,
} from './constants.js';

// ─── Radial speed-blur + chromatic aberration shader ──────────────────────────
const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength:  { value: 0.0 },
    center:    { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 center;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - center;
      float dist = length(dir);
      vec4 col = vec4(0.0);
      const int SAMPLES = 8;
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1);
        vec2 uv = vUv - dir * strength * t * dist;
        col += texture2D(tDiffuse, clamp(uv, 0.0, 1.0));
      }
      col /= float(SAMPLES);
      // Chromatic aberration at edges
      float ca = strength * dist * 0.018;
      float r = texture2D(tDiffuse, clamp(vUv + dir * ca, 0.0, 1.0)).r;
      float b = texture2D(tDiffuse, clamp(vUv - dir * ca, 0.0, 1.0)).b;
      gl_FragColor = vec4(r, col.g, b, col.a);
    }
  `,
};

export class RoadRashGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.clock = new THREE.Clock();
    this.audio = new AudioEngine();

    this.state = 'menu';
    this.keys = new Set();
    this.speed = 92;
    this.distance = 0;
    this.health = 100;
    this.nitro = 100;
    this.playerLane = 0;
    this.steer = 0;
    this.raceTime = 0;
    this.topSpeed = 0;
    this.takedowns = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.collisionCooldown = 0;
    this.edgeDamageTimer = 0;
    this.cameraShake = 0;
    this.cameraRoll = 0;
    this.boosting = false;
    this.previousBoosting = false;
    this.countdownToken = 0;

    // Combo attack system
    this.lastAttackHitTime = 0;
    this.comboCount = 0;

    // Takedown bonus
    this.takedownBoostTimer = 0;

    // Health regen
    this.noHitTimer = 0;

    // Near-miss
    this.nearMissTimer = 0;
    this.nearMissCooldown = 0;

    // Checkpoint tracking
    this.checkpointsPassed = new Set();
    this.checkpointTimer = 0;

    // Tire screech state
    this.lastSteer = 0;
    this.screeched = false;

    // Sky time uniform
    this.skyMaterial = null;
    this.skyTime = 0;

    // Smoke particles
    this.smokeSystem = null;

    this.player = null;
    this.cockpit = null;
    this.rivals = [];
    this.traffic = [];
    this.roadSegments = [];
    this.mist = null;
    this.sparkSystem = null;
    this.bikeModel = null;
    this.bikeModelPath = '/assets/bike.glb';
    this.windowTexture = null;
    this.roadMaterial = null;
    this.radialBlurPass = null;

    this.dom = this.collectDom();
    this.animate = this.animate.bind(this);
    this.onResize = this.onResize.bind(this);
  }

  collectDom() {
    const byId = (id) => document.getElementById(id);
    return {
      boot: byId('boot-screen'),
      start: byId('start-button'),
      how: byId('how-button'),
      controls: byId('controls-panel'),
      hud: byId('hud'),
      countdown: byId('countdown'),
      pause: byId('pause-screen'),
      result: byId('result-screen'),
      resume: byId('resume-button'),
      pauseButton: byId('pause-button'),
      restartPause: byId('restart-pause-button'),
      restart: byId('restart-button'),
      speed: byId('speed-value'),
      gear: byId('gear-value'),
      position: byId('position-value'),
      distance: byId('distance-value'),
      time: byId('time-value'),
      progress: byId('progress-fill'),
      checkpoint: byId('checkpoint-label'),
      health: byId('health-value'),
      healthFill: byId('health-fill'),
      nitro: byId('nitro-value'),
      nitroFill: byId('nitro-fill'),
      combat: byId('combat-prompt'),
      damage: byId('damage-flash'),
      speedLines: byId('speed-lines'),
      revBars: [...document.querySelectorAll('#rev-bars i')],
      resultEyebrow: byId('result-eyebrow'),
      resultTitle: byId('result-title'),
      resultPosition: byId('result-position'),
      resultTime: byId('result-time'),
      resultSpeed: byId('result-speed'),
      resultTakedowns: byId('result-takedowns'),
      touchControls: byId('touch-controls'),
      takedownBanner: byId('takedown-banner'),
      nearMiss: byId('near-miss'),
      checkpointNotify: byId('checkpoint-notify'),
      rivalHpBar: byId('rival-hp-bar'),
      rivalHpFill: byId('rival-hp-fill'),
      nitroShimmer: byId('nitro-shimmer'),
    };
  }

  async init() {
    this.bikeModel = await preloadBikeModel(this.bikeModelPath);
    this.setupRenderer();
    this.setupWorld();
    this.setupRacers();
    this.setupTraffic();
    this.setupEvents();
    this.updateWorld(0);
    this.updateHud();
    this.animate();
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14243b);
    this.scene.fog = new THREE.FogExp2(0x43505a, 0.0074);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.06, 720);
    this.camera.position.set(0, 2.48, PLAYER_Z - 0.42);
    this.camera.lookAt(0, 1.18, -30);
    this.scene.add(this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.38, 0.68, 0.80);
    bloom.threshold = 0.72;
    bloom.strength = 0.38;
    bloom.radius = 0.64;
    this.composer.addPass(bloom);

    // Radial blur + chromatic aberration pass
    this.radialBlurPass = new ShaderPass(RadialBlurShader);
    this.radialBlurPass.uniforms.strength.value = 0;
    this.composer.addPass(this.radialBlurPass);
  }

  setupWorld() {
    const sky = createSky();
    this.skyMaterial = sky.userData.skyMaterial;
    this.scene.add(sky);
    this.scene.add(createMountains());

    const hemisphere = new THREE.HemisphereLight(0xa9cbea, 0x412a21, 2.4);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffd39a, 5.8);
    sun.position.set(-72, 86, -126);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -58; sun.shadow.camera.right = 58;
    sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -20;
    sun.shadow.camera.near = 20; sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.00012;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x4ebcff, 2.2);
    rim.position.set(35, 22, 18);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1100, 2200),
      new THREE.MeshStandardMaterial({ color: 0x1c2927, roughness: 0.98 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.54, -780);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(620, 1500, 4, 12),
      new THREE.MeshPhysicalMaterial({ color: 0x183c50, metalness: 0.48, roughness: 0.22, clearcoat: 0.85, transparent: true, opacity: 0.88 }),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(305, -0.34, -650);
    this.scene.add(ocean);

    this.windowTexture = createWindowTexture();
    const roadTexture = createRoadTexture(this.renderer);
    this.roadMaterial = new THREE.MeshPhysicalMaterial({
      map: roadTexture,
      color: 0xffffff,
      metalness: 0.28,
      roughness: 0.38,
      clearcoat: 0.78,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.85,
    });

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const segment = this.createRoadSegment(i);
      this.roadSegments.push(segment);
      this.scene.add(segment);
    }

    this.mist = createMistParticles();
    this.scene.add(this.mist);
    this.sparkSystem = this.createSparkSystem();
    this.scene.add(this.sparkSystem.points);
    this.smokeSystem = this.createSmokeSystem();
    this.scene.add(this.smokeSystem.points);
  }

  createRoadSegment(index) {
    const random = mulberry32(7700 + index * 71);
    const group = new THREE.Group();
    const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LENGTH + 1.8), this.roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0;
    road.receiveShadow = true;
    group.add(road);

    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6265, metalness: 0.18, roughness: 0.66 });
    const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xb6bcc0, metalness: 0.65, roughness: 0.36 });
    [-1, 1].forEach((side) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.18, SEGMENT_LENGTH + 1), curbMaterial);
      curb.position.set(side * (ROAD_HALF + 0.72), 0.06, 0);
      curb.receiveShadow = true;
      group.add(curb);

      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, SEGMENT_LENGTH + 1), barrierMaterial);
      rail.position.set(side * (ROAD_HALF + 1.36), 0.72, 0);
      rail.castShadow = true;
      group.add(rail);
      for (let z = -SEGMENT_LENGTH / 2; z <= SEGMENT_LENGTH / 2; z += 5.8) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.76, 0.12), barrierMaterial);
        post.position.set(side * (ROAD_HALF + 1.36), 0.38, z);
        post.castShadow = true;
        group.add(post);
      }

      const lamp = createStreetLight(side);
      lamp.position.set(side * (ROAD_HALF + 2.25), 0, random() * 15 - 7.5);
      group.add(lamp);

      if ((index + (side > 0 ? 1 : 0)) % 3 === 0) {
        const palm = createPalm(index * 9 + side * 3);
        palm.position.set(side * (ROAD_HALF + 3.5), 0, random() * 22 - 11);
        group.add(palm);
      }

      const building = createBuilding(this.windowTexture, index * 13 + (side > 0 ? 5 : 2), side);
      building.position.set(side * (ROAD_HALF + 9 + random() * 10), -0.42, random() * 28 - 14);
      building.rotation.y = side > 0 ? -0.04 : 0.04;
      group.add(building);

      if (index % 4 === 1) {
        const rearBuilding = createBuilding(this.windowTexture, index * 29 + (side > 0 ? 7 : 4), side);
        rearBuilding.position.set(side * (ROAD_HALF + 22 + random() * 11), -0.44, random() * 30 - 15);
        rearBuilding.scale.setScalar(1.12 + random() * 0.55);
        group.add(rearBuilding);
      }
    });

    group.userData.worldDistance = (index - 1) * SEGMENT_LENGTH;
    group.userData.segmentIndex = index;
    return group;
  }

  setupRacers() {
    this.player = createBike({ color: 0xc7ff32, suitColor: 0x13181b, accent: 0x27d9ff, player: true, glbModel: this.bikeModel });
    this.player.position.set(0, 0.03, PLAYER_Z);
    this.player.visible = false;
    this.scene.add(this.player);

    this.cockpit = createCockpit();
    this.camera.add(this.cockpit);

    this.rivals = RIVAL_CONFIG.map((config, index) => {
      const bike = createBike({ color: config.color, suitColor: 0x151719, accent: config.accent, glbModel: this.bikeModel });
      bike.scale.multiplyScalar(0.96);
      this.scene.add(bike);
      return {
        ...config,
        startDistance: config.distance,
        baseSpeed: config.speed,
        bike,
        targetLane: config.lane,
        laneTimer: 1.4 + index * 0.42,
        wobble: 0,
        health: 100,
        takedown: false,
        finishTime: null,
        attackCooldown: 0,
      };
    });
  }

  setupTraffic() {
    this.traffic = Array.from({ length: 16 }, (_, index) => {
      const car = createCar(CAR_COLORS[index % CAR_COLORS.length]);
      car.scale.setScalar(0.92 + (index % 3) * 0.04);
      this.scene.add(car);
      return {
        car,
        lane: LANES[(index * 3 + 1) % LANES.length],
        distance: 82 + index * 105 + (index % 4) * 18,
        speed: 20 + (index % 5) * 2.6,
        hit: false,
      };
    });
  }

  setupEvents() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', (event) => {
      const key = event.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(key)) event.preventDefault();
      this.keys.add(key);
      if (key === 'Space' && !event.repeat) this.tryAttack();
      if ((key === 'KeyP' || key === 'Escape') && !event.repeat) this.togglePause();
      if (key === 'Enter' && !event.repeat && (this.state === 'menu' || this.state === 'finished')) this.beginRace();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pauseGame();
    });

    this.dom.start.addEventListener('click', () => this.beginRace());
    this.dom.how.addEventListener('click', () => {
      const visible = this.dom.controls.classList.toggle('is-visible');
      this.dom.controls.setAttribute('aria-hidden', String(!visible));
      this.dom.how.setAttribute('aria-expanded', String(visible));
    });
    this.dom.pauseButton.addEventListener('click', () => this.pauseGame());
    this.dom.resume.addEventListener('click', () => this.resumeGame());
    this.dom.restartPause.addEventListener('click', () => this.beginRace());
    this.dom.restart.addEventListener('click', () => this.beginRace());

    document.querySelectorAll('[data-control]').forEach((button) => {
      const control = button.dataset.control;
      const code = { left: 'ArrowLeft', right: 'ArrowRight', throttle: 'ArrowUp', boost: 'ShiftLeft', attack: 'Space' }[control];
      const down = (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        button.classList.add('is-active');
        this.keys.add(code);
        if (control === 'attack') this.tryAttack();
      };
      const up = (event) => {
        event.preventDefault();
        button.classList.remove('is-active');
        this.keys.delete(code);
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('pointerleave', up);
    });
  }

  async beginRace() {
    this.countdownToken += 1;
    const token = this.countdownToken;
    this.resetRace();
    this.audio.start();
    this.state = 'countdown';
    this.dom.boot.classList.remove('is-visible');
    this.dom.pause.classList.remove('is-visible');
    this.dom.result.classList.remove('is-visible');
    this.dom.hud.classList.add('is-visible');
    this.dom.touchControls.classList.add('is-visible');
    this.player.visible = true;

    const values = ['3', '2', '1', 'GO'];
    for (let i = 0; i < values.length; i++) {
      if (token !== this.countdownToken) return;
      this.dom.countdown.innerHTML = `<span>${values[i]}</span>`;
      this.dom.countdown.classList.remove('is-visible');
      void this.dom.countdown.offsetWidth;
      this.dom.countdown.classList.add('is-visible');
      this.audio.countdown(i === 3 ? 3 : i);
      await delay(i === 3 ? 620 : 860);
    }
    if (token !== this.countdownToken) return;
    this.dom.countdown.classList.remove('is-visible');
    this.state = 'playing';
    this.clock.getDelta();
  }

  resetRace() {
    this.distance = 0;
    this.speed = 0;
    this.health = 100;
    this.nitro = 100;
    this.playerLane = 0;
    this.steer = 0;
    this.raceTime = 0;
    this.topSpeed = 0;
    this.takedowns = 0;
    this.attackTimer = 0;
    this.attackCooldown = 0;
    this.collisionCooldown = 0;
    this.edgeDamageTimer = 0;
    this.cameraShake = 0;
    this.cameraRoll = 0;
    this.boosting = false;
    this.comboCount = 0;
    this.lastAttackHitTime = 0;
    this.takedownBoostTimer = 0;
    this.noHitTimer = 0;
    this.nearMissTimer = 0;
    this.nearMissCooldown = 0;
    this.checkpointsPassed = new Set();
    this.checkpointTimer = 0;
    this.screeched = false;
    this.keys.clear();
    this.player.position.set(0, 0.03, PLAYER_Z);
    this.player.rotation.set(0, 0, 0);
    this.player.userData.attackPivot.rotation.set(0, 0, 0);
    this.camera.position.set(0, 2.48, PLAYER_Z - 0.42);
    if (this.cockpit) {
      this.cockpit.rotation.set(0, 0, 0);
      this.cockpit.userData.rightHand.position.set(0.88, -1.02, -2.42);
      this.cockpit.userData.rightHand.rotation.set(0, 0, 0);
    }
    this.roadSegments.forEach((segment, index) => {
      segment.userData.worldDistance = (index - 1) * SEGMENT_LENGTH;
      segment.visible = true;
    });
    this.rivals.forEach((rival, index) => {
      const config = RIVAL_CONFIG[index];
      rival.distance = config.distance;
      rival.speed = 18 + index * 0.7;
      rival.lane = config.lane;
      rival.targetLane = config.lane;
      rival.health = 100;
      rival.wobble = 0;
      rival.takedown = false;
      rival.finishTime = null;
      rival.attackCooldown = 0;
      rival.bike.visible = true;
      rival.bike.rotation.set(0, 0, 0);
    });
    this.traffic.forEach((traffic, index) => {
      traffic.distance = 82 + index * 105 + (index % 4) * 18;
      traffic.lane = LANES[(index * 3 + 1) % LANES.length];
      traffic.hit = false;
      traffic.car.visible = true;
    });
    // Hide UI notifications
    if (this.dom.takedownBanner) this.dom.takedownBanner.classList.remove('is-visible');
    if (this.dom.nearMiss) this.dom.nearMiss.classList.remove('is-visible');
    if (this.dom.checkpointNotify) this.dom.checkpointNotify.classList.remove('is-visible');
    if (this.dom.rivalHpBar) this.dom.rivalHpBar.classList.remove('is-visible');
    this.updateHud();
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.dom.pause.classList.add('is-visible');
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.dom.pause.classList.remove('is-visible');
    this.clock.getDelta();
    this.audio.context?.resume();
  }

  togglePause() {
    if (this.state === 'playing') this.pauseGame();
    else if (this.state === 'paused') this.resumeGame();
  }

  animate() {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.045);

    if (this.state === 'menu') {
      this.updateDemo(dt);
    } else if (this.state === 'playing') {
      this.updateGame(dt);
    } else if (this.state === 'countdown') {
      this.updateCountdownScene(dt);
    } else if (this.state === 'paused') {
      this.audio.update(this.speed, 0, false, true);
    }

    this.updateCamera(dt);
    this.updateSparks(dt);
    this.updateSmoke(dt);
    if (this.skyMaterial) {
      this.skyTime += dt;
      this.skyMaterial.uniforms.time.value = this.skyTime;
    }
    this.composer.render();
  }

  updateDemo(dt) {
    const cruise = 27;
    this.distance += cruise * dt;
    this.speed = 97 + Math.sin(performance.now() * 0.0008) * 5;
    this.playerLane = Math.sin(this.distance * 0.015) * 0.75;
    this.rivals.forEach((rival, index) => {
      rival.distance += cruise * dt;
      rival.lane = Math.sin(this.distance * 0.009 + index) * 2.8 + (index % 2 ? 1.4 : -1.4);
    });
    this.traffic.forEach((traffic) => { traffic.distance += cruise * dt; });
    this.updateWorld(dt);
    this.updateBikeAnimation(dt, false);
    this.audio.update(this.speed, 0.3, false, false);
    // No blur in menu
    this.radialBlurPass.uniforms.strength.value = 0;
  }

  updateCountdownScene(dt) {
    this.updateWorld(dt);
    this.updateBikeAnimation(dt, false);
    this.audio.update(18, 0.75, false, false);
    this.radialBlurPass.uniforms.strength.value = 0;
  }

  updateGame(dt) {
    this.raceTime += dt;
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    this.edgeDamageTimer = Math.max(0, this.edgeDamageTimer - dt);
    this.takedownBoostTimer = Math.max(0, this.takedownBoostTimer - dt);
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);
    this.checkpointTimer = Math.max(0, this.checkpointTimer - dt);

    const throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp');
    const braking = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const boostHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    if (throttle) this.speed += (68 - this.speed * 0.055) * dt;
    else this.speed -= (11 + this.speed * 0.018) * dt;
    if (braking) this.speed -= 94 * dt;

    // Takedown speed burst
    if (this.takedownBoostTimer > 0) this.speed += 28 * dt;

    this.boosting = boostHeld && this.nitro > 0.4 && this.speed > 48;
    if (this.boosting) {
      this.speed += 84 * dt;
      this.nitro = Math.max(0, this.nitro - 25 * dt);
      if (!this.previousBoosting) this.audio.boost();
    } else {
      this.nitro = Math.min(100, this.nitro + 7.4 * dt);
      if (this.speed > MAX_SPEED) this.speed -= 46 * dt;
    }
    this.previousBoosting = this.boosting;
    this.speed = clamp(this.speed, 0, BOOST_SPEED);
    this.topSpeed = Math.max(this.topSpeed, this.speed);

    // Steering
    const steerInput = (right ? 1 : 0) - (left ? 1 : 0);
    const prevSteer = this.steer;
    this.steer = lerp(this.steer, steerInput, 9, dt);
    const steeringRate = 4.5 + this.speed * 0.012;
    this.playerLane += this.steer * steeringRate * dt;
    this.playerLane = clamp(this.playerLane, -8.0, 8.0);

    // Tire screech on fast steering input
    const steerDelta = Math.abs(this.steer - prevSteer);
    if (steerDelta > 0.14 && this.speed > 80 && !this.screeched) {
      this.audio.tireScreech(steerDelta * 2);
      this.screeched = true;
      setTimeout(() => { this.screeched = false; }, 350);
    }

    // Edge collision
    if (Math.abs(this.playerLane) > 7.25) {
      this.speed -= 44 * dt;
      this.cameraShake = Math.max(this.cameraShake, 0.18);
      if (this.edgeDamageTimer <= 0 && this.speed > 90) {
        this.takeDamage(3.5, this.playerLane > 0 ? -1 : 1, 0.45);
        this.edgeDamageTimer = 0.48;
      }
    }

    // Health regen when not taking damage
    this.noHitTimer += dt;
    if (this.noHitTimer > 5 && this.health < 100) {
      this.health = Math.min(100, this.health + 0.5 * dt);
    }

    // Nitro shimmer effect when active
    if (this.dom.nitroShimmer) {
      this.dom.nitroShimmer.style.opacity = this.boosting ? '1' : '0';
    }

    // Checkpoints
    const progress = this.distance / RACE_LENGTH;
    [0.25, 0.5, 0.75].forEach((cp, i) => {
      if (progress >= cp && !this.checkpointsPassed.has(i)) {
        this.checkpointsPassed.add(i);
        this._triggerCheckpoint(i);
      }
    });
    if (this.dom.checkpointNotify && this.checkpointTimer <= 0) {
      this.dom.checkpointNotify.classList.remove('is-visible');
    }

    this.distance += (this.speed / 3.6) * dt;
    this.updateRivals(dt);
    this.updateTraffic(dt);
    this.handleCollisions();
    this.checkNearMiss();
    this.updateWorld(dt);
    this.updateBikeAnimation(dt, this.boosting);
    this.updateHud();
    this.audio.update(this.speed, throttle ? 1 : 0, this.boosting, false);

    // Radial blur scales with speed & boost
    const speedFactor = clamp(this.speed / BOOST_SPEED, 0, 1);
    const blurStr = speedFactor * speedFactor * (this.boosting ? 0.045 : 0.022);
    this.radialBlurPass.uniforms.strength.value = lerp(
      this.radialBlurPass.uniforms.strength.value, blurStr, 4, dt
    );

    if (this.health <= 0) this.finishRace(true);
    else if (this.distance >= RACE_LENGTH) this.finishRace(false);
  }

  _triggerCheckpoint(index) {
    this.audio.checkpointChime();
    this.checkpointTimer = 2.8;
    if (this.dom.checkpointNotify) {
      const labels = ['CHECKPOINT 1', 'CHECKPOINT 2', 'CHECKPOINT 3'];
      this.dom.checkpointNotify.textContent = labels[index];
      this.dom.checkpointNotify.classList.add('is-visible');
      setTimeout(() => {
        if (this.dom.checkpointNotify) this.dom.checkpointNotify.classList.remove('is-visible');
      }, 2500);
    }
    if (this.dom.checkpoint) this.dom.checkpoint.textContent = `CHECKPOINT ${index + 1}`;
  }

  checkNearMiss() {
    if (this.nearMissCooldown > 0) return;
    for (const traffic of this.traffic) {
      const dz = Math.abs(traffic.distance - this.distance);
      const dx = Math.abs(traffic.lane - this.playerLane);
      if (dz < 4.5 && dx < 2.2 && dx > 1.35) {
        // Near miss — not a collision, but close!
        this.nearMissCooldown = 2.0;
        this.audio.nearMissWhoosh();
        if (this.dom.nearMiss) {
          this.dom.nearMiss.classList.add('is-visible');
          setTimeout(() => { if (this.dom.nearMiss) this.dom.nearMiss.classList.remove('is-visible'); }, 1100);
        }
        this.nitro = Math.min(100, this.nitro + 4); // Bonus nitro for near-miss
        break;
      }
    }
  }

  updateRivals(dt) {
    let closestRival = null;
    let closestDist = Infinity;

    this.rivals.forEach((rival, index) => {
      rival.attackCooldown = Math.max(0, rival.attackCooldown - dt);
      if (!rival.takedown) {
        const relative = rival.distance - this.distance;
        let desiredSpeed = rival.baseSpeed + Math.sin(this.raceTime * 0.55 + index * 1.4) * 2.5;

        // Smarter rubberband
        if (relative < -100) desiredSpeed += 14; // Surge to catch up
        if (relative < -50) desiredSpeed += 6;
        if (relative > 200) desiredSpeed -= 10; // Back off when way ahead

        rival.speed = lerp(rival.speed, desiredSpeed, 0.9, dt);
        rival.distance += rival.speed * dt;

        rival.laneTimer -= dt;
        if (rival.laneTimer <= 0) {
          const laneIndex = (Math.floor(this.raceTime * 0.23 + index * 1.7) + index) % LANES.length;
          rival.targetLane = LANES[laneIndex];
          rival.laneTimer = 2.6 + ((index * 1.17) % 2.4);
        }
        rival.lane = lerp(rival.lane, rival.targetLane, 0.7, dt);

        // Rival attacks player
        const longitudinal = Math.abs(relative);
        const lateral = Math.abs(rival.lane - this.playerLane);
        if (longitudinal < 2.3 && lateral < 1.45 && rival.attackCooldown <= 0 && Math.random() < dt * 0.44) {
          this.takeDamage(9 + index % 3, rival.lane > this.playerLane ? -1 : 1, 0.85);
          rival.attackCooldown = 2.5;
        }

        // Track closest rival for HP bar
        if (longitudinal < 8 && longitudinal < closestDist) {
          closestDist = longitudinal;
          closestRival = rival;
        }
      } else {
        rival.speed = Math.max(5, rival.speed - 18 * dt);
        rival.distance += rival.speed * dt;
        rival.wobble += dt * 4;
        // Spawn smoke from downed rival
        if (Math.random() < dt * 8) {
          this.spawnSmoke(rival.bike.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 2);
        }
      }

      if (rival.distance >= RACE_LENGTH && rival.finishTime === null) rival.finishTime = this.raceTime;
    });

    // Rival HP bar in HUD
    if (closestRival && closestDist < 6 && this.dom.rivalHpBar && this.dom.rivalHpFill) {
      this.dom.rivalHpBar.classList.add('is-visible');
      this.dom.rivalHpFill.style.width = `${Math.max(0, closestRival.health)}%`;
    } else if (this.dom.rivalHpBar) {
      this.dom.rivalHpBar.classList.remove('is-visible');
    }
  }

  updateTraffic(dt) {
    this.traffic.forEach((traffic, index) => {
      traffic.distance += traffic.speed * dt;
      if (traffic.distance < this.distance - 75) {
        traffic.distance = this.distance + 760 + index * 82 + Math.random() * 160;
        traffic.lane = LANES[(index + Math.floor(this.distance / 300)) % LANES.length];
        traffic.hit = false;
      }
    });
  }

  handleCollisions() {
    if (this.collisionCooldown > 0) return;

    for (const traffic of this.traffic) {
      const dz = traffic.distance - this.distance;
      const dx = traffic.lane - this.playerLane;
      if (Math.abs(dz) < 2.65 && Math.abs(dx) < 1.35) {
        // Glancing vs full hit — less damage on side swipes
        const glancing = Math.abs(dx) > 0.7;
        const damage = glancing ? 10 : 19;
        this.takeDamage(damage, dx > 0 ? -1 : 1, glancing ? 0.8 : 1.5);
        this.speed *= glancing ? 0.72 : 0.54;
        traffic.hit = true;
        traffic.car.rotation.z = dx > 0 ? -0.12 : 0.12;
        this.collisionCooldown = 1.1;
        // Spawn crash smoke
        this.spawnSmoke(traffic.car.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 8);
        return;
      }
    }

    for (const rival of this.rivals) {
      if (rival.takedown) continue;
      const dz = rival.distance - this.distance;
      const dx = rival.lane - this.playerLane;
      if (Math.abs(dz) < 1.8 && Math.abs(dx) < 0.92) {
        this.takeDamage(5.5, dx > 0 ? -1 : 1, 0.72);
        rival.wobble = dx > 0 ? 0.35 : -0.35;
        this.collisionCooldown = 0.72;
        return;
      }
    }
  }

  tryAttack() {
    if (this.state !== 'playing' || this.attackCooldown > 0) return;
    this.attackTimer = 0.42;
    this.attackCooldown = 0.55;
    this.audio.strike();

    let target = null;
    let targetScore = Infinity;
    this.rivals.forEach((rival) => {
      if (rival.takedown) return;
      const dz = Math.abs(rival.distance - this.distance);
      const dx = Math.abs(rival.lane - this.playerLane);
      const score = dz + dx;
      if (dz < 4.3 && dx < 2.15 && score < targetScore) {
        target = rival;
        targetScore = score;
      }
    });

    if (!target) return;

    // Combo system
    const now = this.raceTime;
    let comboDmg = 38;
    if (now - this.lastAttackHitTime < 0.8) {
      this.comboCount++;
      if (this.comboCount >= 2) {
        comboDmg = Math.round(38 * 1.5);
        this._showTakedownBanner('COMBO ×' + (this.comboCount + 1) + '!', '#ff8822');
      }
    } else {
      this.comboCount = 0;
    }
    this.lastAttackHitTime = now;

    target.health -= comboDmg;
    target.wobble = target.lane > this.playerLane ? -0.72 : 0.72;
    target.speed = Math.max(30, target.speed - 11);
    this.audio.impact(0.75);
    this.spawnSparks(target.bike.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 22);

    if (target.health <= 0) {
      target.takedown = true;
      target.wobble = target.lane > this.playerLane ? -1.2 : 1.2;
      this.takedowns += 1;
      this.audio.takedownSound();
      this.spawnSparks(target.bike.position.clone().add(new THREE.Vector3(0, 1.0, 0)), 40);
      this.spawnSmoke(target.bike.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 12);
      this.takedownBoostTimer = 2.2; // Speed burst
      this._showTakedownBanner('TAKEDOWN!', '#c7ff32');
    }
  }

  _showTakedownBanner(text, color = '#c7ff32') {
    if (!this.dom.takedownBanner) return;
    this.dom.takedownBanner.textContent = text;
    this.dom.takedownBanner.style.color = color;
    this.dom.takedownBanner.classList.remove('is-visible');
    void this.dom.takedownBanner.offsetWidth;
    this.dom.takedownBanner.classList.add('is-visible');
    setTimeout(() => { if (this.dom.takedownBanner) this.dom.takedownBanner.classList.remove('is-visible'); }, 1600);
  }

  takeDamage(amount, shove, strength = 1) {
    this.health = Math.max(0, this.health - amount);
    this.playerLane = clamp(this.playerLane + shove * 0.32 * strength, -8, 8);
    this.cameraShake = Math.max(this.cameraShake, 0.48 * strength);
    this.audio.impact(strength);
    this.dom.damage.classList.remove('is-active');
    void this.dom.damage.offsetWidth;
    this.dom.damage.classList.add('is-active');
    this.spawnSparks(this.player.position.clone().add(new THREE.Vector3(-shove * 0.45, 0.75, -0.2)), Math.round(12 + strength * 14));
    // Reset regen timer
    this.noHitTimer = 0;
  }

  updateWorld(dt) {
    const curveOrigin = this.roadCurve(this.distance);
    const recycleSpan = SEGMENT_COUNT * SEGMENT_LENGTH;
    for (const segment of this.roadSegments) {
      let worldDistance = segment.userData.worldDistance;
      while (worldDistance < this.distance - SEGMENT_LENGTH * 1.7) worldDistance += recycleSpan;
      segment.userData.worldDistance = worldDistance;
      const relative = worldDistance - this.distance;
      segment.visible = relative > -SEGMENT_LENGTH * 1.8 && relative < 760;
      if (!segment.visible) continue;
      segment.position.x = this.roadCurve(worldDistance) - curveOrigin;
      segment.position.z = PLAYER_Z - relative;
      segment.rotation.y = this.roadHeading(worldDistance);
    }

    this.updateRacerTransforms(dt, curveOrigin);
    this.updateTrafficTransforms(dt, curveOrigin);
    this.updateMist(dt);
  }

  updateRacerTransforms(dt, curveOrigin) {
    this.rivals.forEach((rival, index) => {
      const relative = rival.distance - this.distance;
      const bike = rival.bike;
      bike.visible = relative > -22 && relative < 540;
      if (!bike.visible) return;
      bike.position.x = this.roadCurve(rival.distance) - curveOrigin + rival.lane;
      bike.position.z = PLAYER_Z - relative;
      bike.position.y = 0.03 + Math.sin(this.raceTime * 9 + index) * 0.012;
      const aiLean = (rival.targetLane - rival.lane) * -0.08;
      if (rival.takedown) {
        bike.rotation.z = lerp(bike.rotation.z, rival.wobble > 0 ? 1.52 : -1.52, 1.9, dt);
        bike.position.y = Math.max(-0.25, bike.position.y - 0.4);
      } else {
        bike.rotation.z = lerp(bike.rotation.z, aiLean + rival.wobble, 6, dt);
        bike.rotation.y = this.roadHeading(rival.distance) * 0.72;
        rival.wobble = lerp(rival.wobble, 0, 4.5, dt);
      }
      bike.userData.wheels.forEach((wheel) => { wheel.rotation.x -= rival.speed * dt / 0.46; });
    });
  }

  updateTrafficTransforms(dt, curveOrigin) {
    this.traffic.forEach((traffic) => {
      const relative = traffic.distance - this.distance;
      traffic.car.visible = relative > -32 && relative < 600;
      if (!traffic.car.visible) return;
      traffic.car.position.set(
        this.roadCurve(traffic.distance) - curveOrigin + traffic.lane,
        0.02,
        PLAYER_Z - relative,
      );
      traffic.car.rotation.y = this.roadHeading(traffic.distance) * 0.72;
      traffic.car.rotation.z = lerp(traffic.car.rotation.z, 0, 2.4, dt);
      traffic.car.userData.wheels?.forEach((wheel) => { wheel.rotation.x -= traffic.speed * dt / 0.3; });
    });
  }

  updateBikeAnimation(dt, boosting) {
    const speedMS = this.speed / 3.6;
    this.player.position.x = lerp(this.player.position.x, this.playerLane, 10, dt);

    // Road bump physics — subtle vertical oscillation from road imperfections
    const bumpFreq = 0.82 + this.speed * 0.002;
    const bumpAmp = Math.min(0.022, this.speed * 0.00009);
    this.player.position.y = 0.035
      + Math.sin(this.distance * bumpFreq) * bumpAmp
      + Math.sin(this.distance * bumpFreq * 1.7 + 0.6) * bumpAmp * 0.4;

    this.player.rotation.z = lerp(this.player.rotation.z, -this.steer * (0.18 + this.speed / 950), 8, dt);
    this.player.rotation.y = lerp(this.player.rotation.y, -this.steer * 0.025, 8, dt);
    this.player.userData.wheels.forEach((wheel) => { wheel.rotation.x -= speedMS * dt / 0.46; });

    const attackProgress = this.attackTimer > 0 ? 1 - this.attackTimer / 0.42 : 0;
    const swing = this.attackTimer > 0 ? Math.sin(attackProgress * Math.PI) : 0;
    this.player.userData.attackPivot.rotation.z = -swing * 1.55;
    this.player.userData.attackPivot.rotation.y = swing * 0.4;

    if (this.cockpit) {
      const rightHand = this.cockpit.userData.rightHand;
      rightHand.position.x = 0.88 + swing * 0.72;
      rightHand.position.y = -1.02 + swing * 0.32;
      rightHand.position.z = -2.42 + swing * 0.2;
      rightHand.rotation.z = -swing * 1.15;
      rightHand.rotation.y = swing * 0.38;
      this.cockpit.rotation.z = lerp(this.cockpit.rotation.z, -this.steer * 0.045, 9, dt);
      this.cockpit.position.y = Math.sin(this.distance * bumpFreq) * Math.min(0.007, speedMS * 0.00012);
      this.cockpit.userData.dashScreen.material.emissiveIntensity = 0.6 + (this.speed / BOOST_SPEED) * 0.6;
      this.cockpit.userData.shiftLight.material.emissiveIntensity = this.speed > 220 ? 5.0 : 1.8;
    }

    this.player.userData.flames.forEach((flame, index) => {
      const active = boosting ? 1 : Math.max(0.06, this.speed / 900);
      flame.scale.y = lerp(flame.scale.y, active, 16, dt);
      flame.scale.x = 0.8 + Math.sin(performance.now() * 0.04 + index) * 0.22;
      flame.material.opacity = boosting ? 0.92 : 0.38;
    });

    this.dom.speedLines.classList.toggle('is-boosting', boosting);
  }

  updateCamera(dt) {
    if (!this.camera) return;
    this.cameraShake = Math.max(0, this.cameraShake - dt * 2.2);
    const speedFactor = clamp(this.speed / BOOST_SPEED, 0, 1);
    const time = performance.now() * 0.001;
    const roadBuzz = speedFactor * (Math.sin(this.distance * 0.53) * 0.004 + Math.sin(this.distance * 1.31) * 0.002);
    const impactX = Math.sin(time * 39) * this.cameraShake * 0.1;
    const impactY = Math.sin(time * 53 + 0.8) * this.cameraShake * 0.075;
    const targetX = this.playerLane + impactX;
    const targetY = 2.48 + roadBuzz + impactY;
    const targetZ = PLAYER_Z - 0.42 + Math.sin(this.distance * 0.37) * speedFactor * 0.002;
    this.camera.position.x = lerp(this.camera.position.x, targetX, 13, dt);
    this.camera.position.y = lerp(this.camera.position.y, targetY, 11, dt);
    this.camera.position.z = lerp(this.camera.position.z, targetZ, 10, dt);
    const lookDistance = 38 + speedFactor * 18;
    const curveAhead = this.roadCurve(this.distance + lookDistance) - this.roadCurve(this.distance);
    const lookAt = new THREE.Vector3(curveAhead + this.playerLane * 0.16, 1.12, PLAYER_Z - lookDistance);
    this.camera.lookAt(lookAt);
    const impactRoll = Math.sin(time * 31) * this.cameraShake * 0.025;
    this.cameraRoll = lerp(this.cameraRoll, -this.steer * (0.035 + speedFactor * 0.025) + impactRoll, 8, dt);
    this.camera.rotateZ(this.cameraRoll);
    this.camera.fov = lerp(this.camera.fov, 72 + speedFactor * 12 + (this.boosting ? 5 : 0), 4.8, dt);
    this.camera.updateProjectionMatrix();
  }

  updateMist(dt) {
    if (!this.mist) return;
    const positions = this.mist.geometry.attributes.position.array;
    const move = (this.speed / 3.6) * dt;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 2] += move;
      if (positions[i + 2] > 24) {
        positions[i + 2] = -245 - Math.random() * 25;
        positions[i] = (Math.random() - 0.5) * 76;
        positions[i + 1] = 0.4 + Math.random() * 15;
      }
    }
    this.mist.geometry.attributes.position.needsUpdate = true;
  }

  // ─── Spark system ──────────────────────────────────────────────────────────
  createSparkSystem() {
    const count = 180;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifespans = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.3, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, vertexColors: true,
    });
    const points = new THREE.Points(geometry, material);
    return { points, velocities, lifespans, count, colors };
  }

  spawnSparks(origin, quantity) {
    if (!this.sparkSystem) return;
    const positions = this.sparkSystem.points.geometry.attributes.position.array;
    const colors = this.sparkSystem.points.geometry.attributes.color.array;
    const vels = this.sparkSystem.velocities;
    const lives = this.sparkSystem.lifespans;
    let spawned = 0;
    for (let i = 0; i < this.sparkSystem.count; i++) {
      if (lives[i] <= 0) {
        lives[i] = 0.3 + Math.random() * 0.45;
        positions[i*3] = origin.x; positions[i*3+1] = origin.y; positions[i*3+2] = origin.z;
        vels[i*3] = (Math.random()-0.5)*18; vels[i*3+1] = Math.random()*11+2; vels[i*3+2] = (Math.random()-0.3)*14;
        // Color: hot white to orange
        colors[i*3] = 1; colors[i*3+1] = 0.6 + Math.random() * 0.4; colors[i*3+2] = Math.random() * 0.3;
        spawned++;
        if (spawned >= quantity) break;
      }
    }
    this.sparkSystem.points.geometry.attributes.position.needsUpdate = true;
    this.sparkSystem.points.geometry.attributes.color.needsUpdate = true;
  }

  updateSparks(dt) {
    if (!this.sparkSystem) return;
    const positions = this.sparkSystem.points.geometry.attributes.position.array;
    const colors = this.sparkSystem.points.geometry.attributes.color.array;
    const vels = this.sparkSystem.velocities;
    const lives = this.sparkSystem.lifespans;
    let needsUpdate = false;
    for (let i = 0; i < this.sparkSystem.count; i++) {
      if (lives[i] > 0) {
        const t = 1 - lives[i] / 0.75;
        lives[i] -= dt;
        positions[i*3] += vels[i*3] * dt;
        positions[i*3+1] += vels[i*3+1] * dt;
        positions[i*3+2] += vels[i*3+2] * dt;
        vels[i*3+1] -= 24 * dt;
        if (positions[i*3+1] < 0) { positions[i*3+1] = 0; vels[i*3+1] *= -0.3; }
        // Cool color: shift from white-orange → dim orange → fade
        colors[i*3] = 1.0;
        colors[i*3+1] = Math.max(0, 0.6 - t * 0.5);
        colors[i*3+2] = Math.max(0, 0.3 - t * 0.3);
        needsUpdate = true;
      } else {
        positions[i*3] = 9999;
      }
    }
    if (needsUpdate) {
      this.sparkSystem.points.geometry.attributes.position.needsUpdate = true;
      this.sparkSystem.points.geometry.attributes.color.needsUpdate = true;
    }
  }

  // ─── Smoke system ──────────────────────────────────────────────────────────
  createSmokeSystem() {
    const count = 80;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifespans = new Float32Array(count);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x555560, size: 1.8, transparent: true, opacity: 0.22,
      blending: THREE.NormalBlending, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    return { points, velocities, lifespans, count };
  }

  spawnSmoke(origin, quantity) {
    if (!this.smokeSystem) return;
    const positions = this.smokeSystem.points.geometry.attributes.position.array;
    const vels = this.smokeSystem.velocities;
    const lives = this.smokeSystem.lifespans;
    let spawned = 0;
    for (let i = 0; i < this.smokeSystem.count; i++) {
      if (lives[i] <= 0) {
        lives[i] = 0.8 + Math.random() * 1.2;
        positions[i*3] = origin.x + (Math.random()-0.5)*0.5;
        positions[i*3+1] = origin.y;
        positions[i*3+2] = origin.z + (Math.random()-0.5)*0.5;
        vels[i*3] = (Math.random()-0.5)*2;
        vels[i*3+1] = 1.5 + Math.random()*2;
        vels[i*3+2] = (Math.random()-0.5)*2;
        spawned++;
        if (spawned >= quantity) break;
      }
    }
    this.smokeSystem.points.geometry.attributes.position.needsUpdate = true;
  }

  updateSmoke(dt) {
    if (!this.smokeSystem) return;
    const positions = this.smokeSystem.points.geometry.attributes.position.array;
    const vels = this.smokeSystem.velocities;
    const lives = this.smokeSystem.lifespans;
    let needsUpdate = false;
    for (let i = 0; i < this.smokeSystem.count; i++) {
      if (lives[i] > 0) {
        lives[i] -= dt;
        positions[i*3] += vels[i*3] * dt;
        positions[i*3+1] += vels[i*3+1] * dt;
        positions[i*3+2] += vels[i*3+2] * dt;
        vels[i*3] *= 0.98;
        vels[i*3+1] *= 0.97;
        needsUpdate = true;
      } else {
        positions[i*3] = 9999;
      }
    }
    if (needsUpdate) this.smokeSystem.points.geometry.attributes.position.needsUpdate = true;
  }

  roadCurve(distance) {
    return Math.sin(distance * 0.00175) * 9.5 + Math.sin(distance * 0.0041 + 0.8) * 3.4;
  }

  roadHeading(distance) {
    const delta = 0.2;
    return Math.atan2(this.roadCurve(distance + delta) - this.roadCurve(distance - delta), delta * 2);
  }

  updateHud() {
    if (!this.dom.hud) return;
    const normalizedSpeed = Math.min(1, this.speed / BOOST_SPEED);
    const currentGear = Math.min(5, Math.floor(normalizedSpeed * 5) + 1);

    this.dom.speed.textContent = Math.round(this.speed);
    this.dom.gear.textContent = this.speed === 0 ? 'N' : currentGear;
    this.dom.time.textContent = this.raceTime.toFixed(2);
    this.dom.distance.textContent = Math.round(Math.max(0, RACE_LENGTH - this.distance));

    const progress = clamp(this.distance / RACE_LENGTH, 0, 1);
    this.dom.progress.style.width = `${progress * 100}%`;

    this.dom.health.textContent = Math.round(this.health);
    this.dom.healthFill.style.width = `${this.health}%`;
    // Color health fill by value
    if (this.health < 30) this.dom.healthFill.style.background = '#ff3658';
    else if (this.health < 60) this.dom.healthFill.style.background = '#ff8822';
    else this.dom.healthFill.style.background = '';

    this.dom.nitro.textContent = Math.round(this.nitro);
    this.dom.nitroFill.style.width = `${this.nitro}%`;

    // Rev bars with 3 zones: green, yellow, red
    const revRatio = (this.speed % (BOOST_SPEED / 5)) / (BOOST_SPEED / 5);
    const activeBars = Math.floor(revRatio * this.dom.revBars.length);
    this.dom.revBars.forEach((bar, index) => {
      const active = index <= activeBars && this.speed > 5;
      bar.classList.toggle('is-active', active && index < 8);
      bar.classList.toggle('is-yellow', active && index >= 8 && index < 10);
      bar.classList.toggle('is-redline', active && index >= 10);
    });

    let activeRank = 1;
    this.rivals.forEach((rival) => {
      if (rival.distance > this.distance) activeRank++;
    });
    this.dom.position.textContent = `${activeRank}/7`;

    // Show combat prompt when rival near
    const combatVisible = this.rivals.some((r) => {
      if (r.takedown) return false;
      return Math.abs(r.distance - this.distance) < 4.5 && Math.abs(r.lane - this.playerLane) < 2.5;
    });
    this.dom.combat.classList.toggle('is-visible', combatVisible);
  }

  finishRace(failed = false) {
    this.state = 'finished';
    this.dom.hud.classList.remove('is-visible');
    this.dom.touchControls.classList.remove('is-visible');
    this.dom.result.classList.add('is-visible');

    if (failed) {
      this.dom.resultEyebrow.textContent = 'RACE FAILED';
      this.dom.resultTitle.textContent = 'WRECKED';
      this.dom.resultPosition.textContent = '--';
    } else {
      let finalRank = 1;
      this.rivals.forEach((rival) => {
        if (rival.finishTime !== null && rival.finishTime < this.raceTime) finalRank++;
      });
      this.dom.resultEyebrow.textContent = 'RACE COMPLETE';
      this.dom.resultTitle.textContent = finalRank === 1 ? 'VICTORY' : 'FINISHED';
      this.dom.resultPosition.textContent = `${finalRank}`;
    }

    this.dom.resultTime.textContent = `${this.raceTime.toFixed(2)}s`;
    this.dom.resultSpeed.textContent = `${Math.round(this.topSpeed)} km/h`;
    this.dom.resultTakedowns.textContent = this.takedowns;
    this.audio.update(0, 0, false, true);
    this.radialBlurPass.uniforms.strength.value = 0;
  }

  onResize() {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}