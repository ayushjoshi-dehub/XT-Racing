import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const gltfLoader = new GLTFLoader();
let bikeModelCache = null;

export function preloadBikeModel(url = '/assets/bike.glb') {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      url,
      (gltf) => {
        bikeModelCache = gltf.scene;
        resolve(bikeModelCache);
      },
      undefined,
      (err) => {
        console.warn('Bike model not found, falling back to procedural bike:', err.message);
        bikeModelCache = null;
        resolve(null);
      }
    );
  });
}

function findWheelNodes(model) {
  const wheels = [];
  model.traverse((node) => {
    if (node.isMesh && /wheel|tire|rim|tyre/i.test(node.name)) {
      wheels.push(node);
    }
  });
  return wheels;
}

function cloneWithMaterials(source) {
  const clone = source.clone();
  clone.traverse((node) => {
    if (node.isMesh && node.material) {
      if (Array.isArray(node.material)) {
        node.material = node.material.map((m) => m.clone());
      } else {
        node.material = node.material.clone();
      }
    }
  });
  return clone;
}

// --- Global Realistic PBR Materials ---
const metalDark = new THREE.MeshStandardMaterial({
  color: 0x111417,
  metalness: 0.95,
  roughness: 0.22
});

const rubber = new THREE.MeshStandardMaterial({
  color: 0x0c0d0e,
  metalness: 0.0,
  roughness: 0.85
});

const chrome = new THREE.MeshStandardMaterial({
  color: 0xdce5e8,
  metalness: 1.0,
  roughness: 0.08
});

function enableShadows(object) {
  object.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = !node.userData.noShadow;
      node.receiveShadow = !node.userData.noShadow;
      if (node.geometry) node.geometry.computeVertexNormals();
    }
  });
  return object;
}

function makeMesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return mesh;
}

function createLimb(start, end, radius, material) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const geom = new THREE.CylinderGeometry(radius, radius * 1.05, length, 24);
  const limb = makeMesh(geom, material);
  limb.position.copy(mid);
  limb.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return limb;
}

function createAdvancedNoiseMap(width = 512, height = 512, mode = 'roughness') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  for (let i = 0; i < imgData.data.length; i += 4) {
    if (mode === 'roughness') {
      const baseNoise = Math.floor(Math.random() * 45);
      const scratch = Math.random() > 0.985 ? 120 : 0;
      const val = Math.min(255, baseNoise + scratch);
      imgData.data[i] = val; imgData.data[i+1] = val; imgData.data[i+2] = val;
    } else {
      const val = Math.floor((Math.sin(i * 0.05) * 0.5 + 0.5) * 30 + Math.random() * 15);
      imgData.data[i] = val; imgData.data[i+1] = val; imgData.data[i+2] = val;
    }
    imgData.data[i+3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const roughnessNoise = createAdvancedNoiseMap(512, 512, 'roughness');
const anisotropyNoise = createAdvancedNoiseMap(256, 512, 'anisotropy');

// --- Animated billboard texture (neon signs) ---
function createBillboardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const signs = [
    { text: 'TURBO', color: '#ff4466' },
    { text: 'NEON', color: '#27d9ff' },
    { text: 'RACE', color: '#c7ff32' },
    { text: 'NITRO', color: '#ff8822' },
  ];
  const sign = signs[Math.floor(Math.random() * signs.length)];
  ctx.fillStyle = '#050810';
  ctx.fillRect(0, 0, 256, 128);
  ctx.shadowColor = sign.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = sign.color;
  ctx.font = 'bold 52px Arial Narrow, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(sign.text, 128, 64);
  // Border glow
  ctx.strokeStyle = sign.color;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 8;
  ctx.strokeRect(6, 6, 244, 116);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createBike({ color = 0xc7ff32, suitColor = 0x14181b, accent = 0x27d9ff, player = false, glbModel = null } = {}) {
  const group = new THREE.Group();
  group.name = player ? 'Player bike' : 'Rival bike';

  const paintColor = new THREE.Color(color).multiplyScalar(0.72);
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColor, metalness: 0.88, roughness: 0.14,
    clearcoat: 1.0, clearcoatRoughness: 0.02,
    roughnessMap: roughnessNoise,
    clearcoatNormalScale: new THREE.Vector2(0.05, 0.05)
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accent, emissive: accent, emissiveIntensity: 7.5, roughness: 0.05
  });
  const suit = new THREE.MeshPhysicalMaterial({
    color: suitColor, metalness: 0.02, roughness: 0.68,
    roughnessMap: roughnessNoise, clearcoat: 0.08,
    sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xffffff)
  });
  const leather = new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.75, roughnessMap: roughnessNoise });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x121619, metalness: 0.7, roughness: 0.22, roughnessMap: roughnessNoise });
  const visor = new THREE.MeshPhysicalMaterial({
    color: 0x06131b, metalness: 0.2, roughness: 0.01,
    transmission: 0.95, transparent: true, opacity: 0.98, ior: 1.58, thickness: 0.2
  });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x9a161d, metalness: 0.4, roughness: 0.35 });

  const wheels = [];
  const proceduralWheels = [];

  if (glbModel) {
    const model = cloneWithMaterials(glbModel);
    group.add(model);

    const foundWheels = findWheelNodes(model);
    foundWheels.forEach((wheel) => {
      wheels.push(wheel);
    });

    if (wheels.length === 0) {
      const frontTireGeom = new THREE.TorusGeometry(0.35, 0.105, 32, 128);
      const rearTireGeom = new THREE.TorusGeometry(0.35, 0.125, 32, 128);
      const rimGeom = new THREE.TorusGeometry(0.245, 0.025, 24, 64);
      const hubGeom = new THREE.CylinderGeometry(0.055, 0.055, 0.32, 32);

      [-1.28, 1.18].forEach((z, index) => {
        const wg = new THREE.Group();
        wg.position.set(0, 0.48, z);
        const tire = makeMesh(index === 0 ? frontTireGeom : rearTireGeom, rubber, [0,0,0], [0, Math.PI/2, 0]);
        const rim = makeMesh(rimGeom, chrome, [0,0,0], [0, Math.PI/2, 0]);
        const discMat = chrome.clone(); discMat.roughnessMap = anisotropyNoise;
        const disc = makeMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.018, 64), discMat, [index===0?0.11:-0.1,0,0], [0,0,Math.PI/2]);
        const hub = makeMesh(hubGeom, metalDark, [0,0,0], [0,0,Math.PI/2]);
        const caliper = makeMesh(new RoundedBoxGeometry(0.08, 0.14, 0.06, 6, 0.02), brakeMat, [index===0?0.13:-0.12, 0.12, -0.1]);
        wg.add(tire, rim, disc, hub, caliper);
        for (let spoke = 0; spoke < 10; spoke++) {
          const angle = (spoke / 10) * Math.PI * 2;
          wg.add(createLimb([0,0,0], [0, Math.sin(angle)*0.23, Math.cos(angle)*0.23], 0.009, metalDark));
        }
        if (index === 0) wg.rotation.x = -0.035;
        group.add(wg);
        wheels.push(wg);
        proceduralWheels.push(wg);
      });
    }
  } else {
    const frontTireGeom = new THREE.TorusGeometry(0.35, 0.105, 32, 128);
    const rearTireGeom = new THREE.TorusGeometry(0.35, 0.125, 32, 128);
    const rimGeom = new THREE.TorusGeometry(0.245, 0.025, 24, 64);
    const hubGeom = new THREE.CylinderGeometry(0.055, 0.055, 0.32, 32);

    [-1.28, 1.18].forEach((z, index) => {
      const wg = new THREE.Group();
      wg.position.set(0, 0.48, z);
      const tire = makeMesh(index === 0 ? frontTireGeom : rearTireGeom, rubber, [0,0,0], [0, Math.PI/2, 0]);
      const rim = makeMesh(rimGeom, chrome, [0,0,0], [0, Math.PI/2, 0]);
      const discMat = chrome.clone(); discMat.roughnessMap = anisotropyNoise;
      const disc = makeMesh(new THREE.CylinderGeometry(0.22, 0.22, 0.018, 64), discMat, [index===0?0.11:-0.1,0,0], [0,0,Math.PI/2]);
      const hub = makeMesh(hubGeom, metalDark, [0,0,0], [0,0,Math.PI/2]);
      const caliper = makeMesh(new RoundedBoxGeometry(0.08, 0.14, 0.06, 6, 0.02), brakeMat, [index===0?0.13:-0.12, 0.12, -0.1]);
      wg.add(tire, rim, disc, hub, caliper);
      for (let spoke = 0; spoke < 10; spoke++) {
        const angle = (spoke / 10) * Math.PI * 2;
        wg.add(createLimb([0,0,0], [0, Math.sin(angle)*0.23, Math.cos(angle)*0.23], 0.009, metalDark));
      }
      if (index === 0) wg.rotation.x = -0.035;
      group.add(wg);
      wheels.push(wg);
    });

    const frame = makeMesh(new RoundedBoxGeometry(0.22,0.22,1.58,8,0.04), metalDark, [0,0.84,0.02], [-0.03,0,0]);
    const engine = makeMesh(new RoundedBoxGeometry(0.66,0.54,0.7,8,0.08), metalDark, [0,0.93,0.17]);
    const engineInset = makeMesh(new THREE.CylinderGeometry(0.2,0.2,0.7,32), chrome, [0,0.96,0.18], [0,0,Math.PI/2]);
    const fairing = makeMesh(new RoundedBoxGeometry(0.82,0.72,1.34,12,0.18), paint, [0,1.08,-0.58], [-0.08,0,0]);
    fairing.scale.set(0.9,1,1);
    const fairingCut = makeMesh(new RoundedBoxGeometry(0.42,0.3,0.82,8,0.08), carbon, [0,0.88,-0.55]);
    const tank = makeMesh(new THREE.SphereGeometry(0.52,48,36), paint, [0,1.31,0.14]);
    tank.scale.set(0.78,0.68,1.05);
    const seat = makeMesh(new RoundedBoxGeometry(0.56,0.15,0.76,8,0.06), leather, [0,1.37,0.78], [-0.08,0,0]);
    const tail = makeMesh(new RoundedBoxGeometry(0.48,0.27,0.66,8,0.07), paint, [0,1.3,1.08], [-0.18,0,0]);
    const windshield = makeMesh(new THREE.SphereGeometry(0.42,48,36,0,Math.PI*2,0,Math.PI*0.52), visor, [0,1.52,-0.72], [0.16,0,0]);
    windshield.scale.set(0.74,0.7,0.78);
    const forkLeft = createLimb([-0.22,1.05,-0.6], [-0.18,0.53,-1.27], 0.045, chrome);
    const forkRight = createLimb([0.22,1.05,-0.6], [0.18,0.53,-1.27], 0.045, chrome);
    const swingLeft = createLimb([-0.23,0.78,0.24], [-0.18,0.5,1.18], 0.052, metalDark);
    const swingRight = createLimb([0.23,0.78,0.24], [0.18,0.5,1.18], 0.052, metalDark);
    const handlebar = makeMesh(new THREE.CylinderGeometry(0.028,0.028,0.84,24), metalDark, [0,1.51,-0.62], [0,0,Math.PI/2]);
    const exhaustLeft = createLimb([-0.3,0.76,0.1], [-0.35,0.69,1.18], 0.07, chrome);
    const exhaustRight = createLimb([0.3,0.76,0.1], [0.35,0.69,1.18], 0.07, chrome);
    const chain = makeMesh(new THREE.BoxGeometry(0.022,0.045,1.08), metalDark, [-0.25,0.59,0.71], [-0.13,0,0]);
    const leftPanel = makeMesh(new RoundedBoxGeometry(0.08,0.44,0.86,6,0.04), paint, [-0.43,1.04,-0.42], [0.05,0.08,-0.08]);
    const rightPanel = leftPanel.clone(); rightPanel.position.x = 0.43; rightPanel.rotation.y = -0.08;
    const headlightLeft = makeMesh(new RoundedBoxGeometry(0.23,0.09,0.035,4,0.02), accentMat, [-0.18,1.23,-1.275], [0,0,-0.05]);
    const headlightRight = headlightLeft.clone(); headlightRight.position.x = 0.18;
    const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff183d, emissive: 0xff183d, emissiveIntensity: 8.5 });
    const tailLight = makeMesh(new RoundedBoxGeometry(0.28,0.08,0.04,4,0.02), tailLightMat, [0,1.31,1.42]);

    group.add(frame, engine, engineInset, fairing, fairingCut, tank, seat, tail, windshield,
      forkLeft, forkRight, swingLeft, swingRight, handlebar, exhaustLeft, exhaustRight,
      chain, leftPanel, rightPanel, headlightLeft, headlightRight, tailLight);
  }

  const flameMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending });
  const flames = [];
  [-0.35, 0.35].forEach((x) => {
    const flame = makeMesh(new THREE.ConeGeometry(0.08, 0.62, 24, 1, true), flameMat, [x, 0.69, 1.51], [Math.PI/2, 0, 0]);
    flame.scale.y = 0.05;
    const flameCore = makeMesh(new THREE.ConeGeometry(0.04, 0.4, 16, 1, true), flameCoreMat, [x, 0.69, 1.56], [Math.PI/2, 0, 0]);
    flameCore.scale.y = 0.05;
    group.add(flame, flameCore);
    flames.push(flame);
  });

  const rider = new THREE.Group();
  const pelvis = makeMesh(new THREE.BoxGeometry(0.48,0.3,0.42), suit, [0,1.64,0.58], [-0.15,0,0]);
  const torso = makeMesh(new THREE.CapsuleGeometry(0.34,0.66,16,32), suit, [0,2.05,0.04], [1.02,0,0]);
  torso.scale.set(0.86,1,0.68);
  const backPanel = makeMesh(new RoundedBoxGeometry(0.48,0.52,0.08,4,0.025), paint, [0,2.12,0.36], [0.98,0,0]);
  const neck = makeMesh(new THREE.CylinderGeometry(0.11,0.13,0.15,24), suit, [0,2.38,-0.26]);
  const helmet = makeMesh(new THREE.SphereGeometry(0.27,32,24), paint, [0,2.57,-0.36]);
  helmet.scale.set(0.92,1,1.08);
  const helmetVisor = makeMesh(new THREE.SphereGeometry(0.275,32,24,0,Math.PI*2,0.25,0.8), visor, [0,2.56,-0.39], [0.25,0,0]);
  helmetVisor.scale.set(0.94,0.98,1.1);
  const helmetStripe = makeMesh(new THREE.BoxGeometry(0.04,0.24,0.38), accentMat, [0,2.63,-0.45], [0.2,0,0]);
  const leftLegUpper = createLimb([-0.18,1.72,0.55], [-0.37,1.17,0.23], 0.13, suit);
  const rightLegUpper = createLimb([0.18,1.72,0.55], [0.37,1.17,0.23], 0.13, suit);
  const leftLegLower = createLimb([-0.37,1.17,0.23], [-0.38,0.8,0.73], 0.105, leather);
  const rightLegLower = createLimb([0.37,1.17,0.23], [0.38,0.8,0.73], 0.105, leather);
  const leftArm = createLimb([-0.25,2.23,-0.12], [-0.35,1.55,-0.62], 0.105, suit);
  const attackPivot = new THREE.Group();
  attackPivot.position.set(0.25,2.23,-0.12);
  const rightArm = createLimb([0,0,0], [0.1,-0.68,-0.5], 0.105, suit);
  attackPivot.add(rightArm);
  const leftBoot = makeMesh(new RoundedBoxGeometry(0.16,0.15,0.34,4,0.04), leather, [-0.38,0.76,0.82], [-0.15,0,0]);
  const rightBoot = leftBoot.clone(); rightBoot.position.x = 0.38;
  const leftGlove = makeMesh(new THREE.SphereGeometry(0.12,24,16), leather, [-0.35,1.53,-0.64]);
  const rightGlove = leftGlove.clone(); rightGlove.position.x = 0.35;
  rider.add(pelvis, torso, backPanel, neck, helmet, helmetVisor, helmetStripe,
    leftLegUpper, rightLegUpper, leftLegLower, rightLegLower, leftBoot, rightBoot,
    leftArm, attackPivot, leftGlove, rightGlove);
  group.add(rider);

  if (player) {
    const underglowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const underglow = makeMesh(new THREE.CircleGeometry(1.15, 48), underglowMat, [0, 0.032, 0.2], [-Math.PI/2, 0, 0]);
    underglow.scale.set(0.5, 1.3, 1);
    group.add(underglow);
  }

  group.userData = { wheels, attackPivot, flames, paint, rider, health: 100, hitFlash: 0 };
  group.scale.setScalar(player ? 1.04 : 0.96);
  return enableShadows(group);
}

export function createCockpit() {
  const group = new THREE.Group();
  group.name = 'First-person cockpit';
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x202a21, metalness: 0.8, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x0b0e10, metalness: 0.6, roughness: 0.22, roughnessMap: roughnessNoise });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.85 });
  const gloveMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0d0f, roughness: 0.6, clearcoat: 0.1, roughnessMap: roughnessNoise });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x8cc9da, transmission: 0.95, transparent: true, opacity: 0.35,
    metalness: 0.2, roughness: 0.02, side: THREE.DoubleSide, depthWrite: false, ior: 1.52, thickness: 0.25
  });
  const mirror = new THREE.MeshPhysicalMaterial({ color: 0x22333b, metalness: 1.0, roughness: 0.01, clearcoat: 1.0 });
  const screen = new THREE.MeshStandardMaterial({ color: 0x040c10, emissive: 0x27d9ff, emissiveIntensity: 1.4, roughness: 0.1 });
  const lime = new THREE.MeshStandardMaterial({ color: 0xc7ff32, emissive: 0xc7ff32, emissiveIntensity: 3.5 });

  const tank = makeMesh(new THREE.SphereGeometry(0.9,48,36), paint, [0,-1.57,-2.15]); tank.scale.set(0.82,0.62,1.22);
  const tankPad = makeMesh(new RoundedBoxGeometry(0.45,0.08,0.75,6,0.09), carbon, [0,-1.17,-2.25], [-0.22,0,0]);
  const upperClamp = makeMesh(new RoundedBoxGeometry(0.54,0.12,0.34,6,0.05), chrome, [0,-1.08,-2.38], [-0.16,0,0]);
  const bar = makeMesh(new THREE.CylinderGeometry(0.035,0.035,1.72,24), metalDark, [0,-1.07,-2.42], [0,0,Math.PI/2]);
  const leftGrip = makeMesh(new THREE.CylinderGeometry(0.085,0.085,0.42,32), rubberMat, [-0.93,-1.04,-2.42], [0,0,Math.PI/2]);
  const rightGrip = leftGrip.clone(); rightGrip.position.x = 0.93;
  const leftReservoir = makeMesh(new RoundedBoxGeometry(0.23,0.15,0.25,6,0.04), carbon, [-0.55,-0.9,-2.5]);
  const rightReservoir = leftReservoir.clone(); rightReservoir.position.x = 0.55;
  const dash = makeMesh(new RoundedBoxGeometry(0.74,0.4,0.14,6,0.08), carbon, [0,-0.8,-2.68], [-0.18,0,0]);
  const dashScreen = makeMesh(new RoundedBoxGeometry(0.58,0.28,0.03,4,0.04), screen, [0,-0.78,-2.755], [-0.18,0,0]);
  const shiftLight = makeMesh(new THREE.BoxGeometry(0.42,0.025,0.02), lime, [0,-0.62,-2.73], [-0.18,0,0]);
  const windshield = makeMesh(new THREE.SphereGeometry(1.35,48,36,0.55,2.04,0.38,0.78), glass, [0,-0.63,-3.02], [0.04,-1.28,0]);
  windshield.scale.set(1.08,0.86,0.38); windshield.userData.noShadow = true;
  const leftMirrorArm = createLimb([-0.65,-0.86,-2.48], [-1.22,-0.57,-2.62], 0.025, metalDark);
  const rightMirrorArm = createLimb([0.65,-0.86,-2.48], [1.22,-0.57,-2.62], 0.025, metalDark);
  const leftMirror = makeMesh(new RoundedBoxGeometry(0.5,0.28,0.06,6,0.08), mirror, [-1.32,-0.52,-2.66], [0,0.18,-0.08]);
  const rightMirror = leftMirror.clone(); rightMirror.position.x = 1.32; rightMirror.rotation.y = -0.18; rightMirror.rotation.z = 0.08;
  const leftHand = new THREE.Group(); leftHand.position.set(-0.88,-1.02,-2.42);
  leftHand.add(makeMesh(new RoundedBoxGeometry(0.28,0.18,0.28,6,0.07), gloveMat));
  const rightHand = new THREE.Group(); rightHand.position.set(0.88,-1.02,-2.42);
  rightHand.add(makeMesh(new RoundedBoxGeometry(0.28,0.18,0.28,6,0.07), gloveMat));
  const leftSleeve = createLimb([-0.88,-1.02,-2.42], [-1.12,-1.64,-1.7], 0.12, gloveMat);
  const rightSleeve = createLimb([0.88,-1.02,-2.42], [1.12,-1.64,-1.7], 0.12, gloveMat);
  group.add(tank, tankPad, upperClamp, bar, leftGrip, rightGrip, leftReservoir, rightReservoir,
    dash, dashScreen, shiftLight, windshield, leftMirrorArm, rightMirrorArm, leftMirror, rightMirror,
    leftHand, rightHand, leftSleeve, rightSleeve);
  group.userData = { rightHand, leftHand, dashScreen, shiftLight };
  group.position.set(0, 0, 0);
  group.traverse((node) => {
    if (node.isMesh) { node.renderOrder = node === windshield ? 2 : 1; node.castShadow = false; node.receiveShadow = false; }
  });
  return group;
}

export function createCar(color = 0x36566f) {
  const group = new THREE.Group();
  const variant = Math.abs(color) % 3;
  const rideHeight = variant === 0 ? 0.08 : 0;
  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).multiplyScalar(0.72),
    metalness: 0.85, roughness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.03
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c1a24, metalness: 0.1, roughness: 0.02,
    transmission: 0.75, transparent: true, opacity: 0.9, ior: 1.52, thickness: 0.4
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0f1114, metalness: 0.5, roughness: 0.5 });
  const tailLightMat = new THREE.MeshStandardMaterial({ color: 0xff102a, emissive: 0xff102a, emissiveIntensity: 7.5 });
  const headLightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xd2e9ff, emissiveIntensity: 8.5 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0xdfded0, roughness: 0.6 });

  const body = makeMesh(new RoundedBoxGeometry(1.9,0.68+rideHeight,4.28,8,0.16), paint, [0,0.69+rideHeight,0]);
  const hood = makeMesh(new RoundedBoxGeometry(1.78,0.25,1.18,6,0.1), paint, [0,1.02+rideHeight,-1.45], [-0.04,0,0]);
  const trunk = makeMesh(new RoundedBoxGeometry(1.8,0.24,0.9,6,0.09), paint, [0,1.02+rideHeight,1.62], [0.04,0,0]);
  const cabin = makeMesh(new RoundedBoxGeometry(1.53,0.72+rideHeight,2.08,8,0.17), glass, [0,1.33+rideHeight,0.03]);
  cabin.scale.set(0.98,1,0.92);
  const roof = makeMesh(new RoundedBoxGeometry(1.42,0.09,1.3,6,0.05), paint, [0,1.72+rideHeight,0.1]);
  const rearLightA = makeMesh(new RoundedBoxGeometry(0.52,0.13,0.05,4,0.025), tailLightMat, [-0.55,0.82+rideHeight,2.16]);
  const rearLightB = rearLightA.clone(); rearLightB.position.x = 0.52;
  const frontLightA = makeMesh(new RoundedBoxGeometry(0.5,0.14,0.05,4,0.025), headLightMat, [-0.55,0.85+rideHeight,-2.16]);
  const frontLightB = frontLightA.clone(); frontLightB.position.x = 0.55;
  const grille = makeMesh(new RoundedBoxGeometry(0.82,0.28,0.04,6,0.04), trim, [0,0.67+rideHeight,-2.17]);
  const frontBumper = makeMesh(new RoundedBoxGeometry(1.82,0.14,0.12,6,0.04), trim, [0,0.48+rideHeight,-2.17]);
  const rearBumper = frontBumper.clone(); rearBumper.position.z = 2.17;
  const plate = makeMesh(new RoundedBoxGeometry(0.55,0.16,0.03,3,0.02), plateMat, [0,0.63+rideHeight,2.25]);
  const leftMirror = makeMesh(new RoundedBoxGeometry(0.24,0.13,0.12,4,0.04), paint, [-1.02,1.28+rideHeight,-0.53]);
  const rightMirror = leftMirror.clone(); rightMirror.position.x = 1.02;
  group.add(body, hood, trunk, cabin, roof, rearLightA, rearLightB, frontLightA, frontLightB,
    grille, frontBumper, rearBumper, plate, leftMirror, rightMirror);

  const wheels = [];
  [-0.91, 0.91].forEach((x) => {
    [-1.38, 1.38].forEach((z) => {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.42+rideHeight, z);
      wheel.add(makeMesh(new THREE.TorusGeometry(0.29,0.105,32,64), rubber, [0,0,0], [0,Math.PI/2,0]));
      wheel.add(makeMesh(new THREE.CylinderGeometry(0.2,0.2,0.12,48), chrome, [0,0,0], [0,0,Math.PI/2]));
      wheel.add(makeMesh(new THREE.CylinderGeometry(0.055,0.055,0.15,24), trim, [0,0,0], [0,0,Math.PI/2]));
      group.add(wheel);
      wheels.push(wheel);
    });
  });
  group.userData.wheels = wheels;
  return enableShadows(group);
}

export function createRoadTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  // Base asphalt gradient — visible mid-gray (not pitch black)
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#383c42');
  gradient.addColorStop(0.5, '#42464d');
  gradient.addColorStop(1, '#363a40');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Noise grain
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const noise = Math.random() * 22 - 11;
    pixels[i] += noise; pixels[i+1] += noise; pixels[i+2] += noise;
  }
  ctx.putImageData(image, 0, 0);

  // Wet puddles — subtle blue reflection patches
  for (let p = 0; p < 14; p++) {
    const px = Math.random() * canvas.width;
    const py = Math.random() * canvas.height;
    const pw = 40 + Math.random() * 80;
    const ph = 10 + Math.random() * 20;
    const puddleGrad = ctx.createRadialGradient(px, py, 0, px, py, pw);
    puddleGrad.addColorStop(0, 'rgba(80,120,160,0.18)');
    puddleGrad.addColorStop(1, 'rgba(80,120,160,0)');
    ctx.fillStyle = puddleGrad;
    ctx.beginPath();
    ctx.ellipse(px, py, pw, ph, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Oil slick rainbow shimmer bands
  const oilGrad = ctx.createLinearGradient(350, 0, 650, 0);
  oilGrad.addColorStop(0, 'rgba(255,0,128,0)');
  oilGrad.addColorStop(0.15, 'rgba(255,0,128,0.06)');
  oilGrad.addColorStop(0.35, 'rgba(0,200,255,0.06)');
  oilGrad.addColorStop(0.55, 'rgba(100,255,50,0.06)');
  oilGrad.addColorStop(0.75, 'rgba(255,180,0,0.05)');
  oilGrad.addColorStop(1, 'rgba(255,0,128,0)');
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = oilGrad;
  ctx.fillRect(300, 0, 400, canvas.height);

  // Asphalt cracks
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#040506';
  ctx.lineWidth = 3;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x+Math.random()*35, y+40, x-Math.random()*28, y+80, x+Math.random()*20, y+140);
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
  // Center double yellow line — bright and crisp
  ctx.fillStyle = '#e8c840';
  ctx.fillRect(501, 0, 7, 2048);
  ctx.fillRect(516, 0, 7, 2048);
  // Lane dashes — bright white
  ctx.fillStyle = '#e8ecef';
  [252, 772].forEach((x) => {
    for (let y = 0; y < 2048; y += 260) ctx.fillRect(x-4, y, 8, 160);
  });
  // Edge solid lines — bright white
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#f0f4f7';
  ctx.fillRect(14, 0, 10, 2048);
  ctx.fillRect(1000, 0, 10, 2048);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (renderer) texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

export function createWindowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const skyReflection = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyReflection.addColorStop(0, '#1c3443');
  skyReflection.addColorStop(0.5, '#0c161c');
  skyReflection.addColorStop(1, '#04070a');
  ctx.fillStyle = '#090d0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bayWidth = 64; const floorHeight = 58;
  for (let y = 5; y < canvas.height; y += floorHeight) {
    for (let x = 5; x < canvas.width; x += bayWidth) {
      const lit = Math.random() > 0.68;
      ctx.fillStyle = skyReflection;
      ctx.fillRect(x+4, y+4, bayWidth-13, floorHeight-13);
      if (lit) {
        ctx.fillStyle = Math.random() > 0.45 ? 'rgba(255,180,90,0.58)' : 'rgba(140,200,220,0.42)';
        ctx.fillRect(x+6, y+6, bayWidth-17, floorHeight-17);
        if (Math.random() > 0.5) {
          ctx.fillStyle = 'rgba(15,12,10,0.7)';
          ctx.fillRect(x+28, y+8, 3, floorHeight-21);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x+6, y+6, bayWidth-17, 1.5);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function createBuilding(windowTexture, seed = 1, side = 1) {
  const random = mulberry32(seed * 9277 + 41);
  const width = 7 + random() * 14;
  const depth = 8 + random() * 12;
  const height = 14 + random() * 42;
  const glassTower = random() > 0.56;
  const hasBillboard = random() > 0.62;
  const group = new THREE.Group();

  // Varied, daytime-visible building colors
  const colorPalette = [
    0x6a7a82, // slate
    0x8a7d6a, // sandstone
    0x5a6e76, // steel blue
    0x7a6a5a, // warm tan
    0x4a6070, // ocean gray
    0x7a8a6a, // sage
  ];
  const hue = colorPalette[Math.floor(random() * colorPalette.length)];
  const concreteColor = glassTower ? 0x526470 : 0x7a7468;
  const baseMat = new THREE.MeshStandardMaterial({ color: hue, metalness: glassTower ? 0.55 : 0.08, roughness: glassTower ? 0.18 : 0.75 });
  const concrete = new THREE.MeshStandardMaterial({ color: concreteColor, metalness: 0.05, roughness: 0.82 });
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x1a2228, metalness: 0.7, roughness: 0.3 });

  const podiumHeight = 2.5 + random() * 2.3;
  const podium = makeMesh(new RoundedBoxGeometry(width*1.08, podiumHeight, depth*1.08, 4, 0.12), concrete, [0, podiumHeight/2, 0]);
  const body = makeMesh(new RoundedBoxGeometry(width, height-podiumHeight, depth, 6, glassTower ? 0.08 : 0.18), baseMat, [0, podiumHeight+(height-podiumHeight)/2, 0]);
  group.add(podium, body);

  const windows = windowTexture.clone();
  windows.needsUpdate = true;
  windows.repeat.set(Math.max(1, Math.round(width/5.5)), Math.max(2, Math.round(height/7.5)));
  const windowMat = new THREE.MeshStandardMaterial({
    map: windows, emissiveMap: windows,
    emissive: 0x3a6a8a, emissiveIntensity: 1.2,  // brighter windows visible in daylight
    metalness: 0.65, roughness: 0.08,
  });
  const facadeHeight = height - podiumHeight - 0.6;
  const facadeY = podiumHeight + facadeHeight / 2;
  const roadFacade = makeMesh(new THREE.PlaneGeometry(width*0.91, facadeHeight), windowMat, [0, facadeY, side>0 ? -depth/2-0.025 : depth/2+0.025], [0, side>0?0:Math.PI, 0]);
  const rearFacade = roadFacade.clone(); rearFacade.position.z *= -1; rearFacade.rotation.y += Math.PI;
  const sideWindows = windows.clone();
  sideWindows.repeat.set(Math.max(1, Math.round(depth/5.5)), Math.max(2, Math.round(height/7.5)));
  sideWindows.needsUpdate = true;
  const sideWindowMat = windowMat.clone(); sideWindowMat.map = sideWindows; sideWindowMat.emissiveMap = sideWindows;
  const leftFacade = makeMesh(new THREE.PlaneGeometry(depth*0.91, facadeHeight), sideWindowMat, [-width/2-0.025, facadeY, 0], [0, -Math.PI/2, 0]);
  const rightFacade = leftFacade.clone(); rightFacade.position.x *= -1; rightFacade.rotation.y = Math.PI/2;
  [roadFacade, rearFacade, leftFacade, rightFacade].forEach((f) => { f.userData.noShadow = true; });
  group.add(roadFacade, rearFacade, leftFacade, rightFacade);

  // Vertical columns
  const columnCount = Math.max(2, Math.floor(width/5));
  for (let col = 0; col <= columnCount; col++) {
    const x = -width/2 + (col/columnCount)*width;
    group.add(makeMesh(new THREE.BoxGeometry(0.14, facadeHeight, 0.18), darkTrim, [x, facadeY, side>0 ? -depth/2-0.08 : depth/2+0.08]));
  }
  const bandCount = Math.min(6, Math.floor(height/8));
  for (let band = 1; band <= bandCount; band++) {
    const y = podiumHeight + (band/(bandCount+1)) * facadeHeight;
    group.add(makeMesh(new THREE.BoxGeometry(width+0.22, 0.09, depth+0.22), darkTrim, [0, y, 0]));
  }

  // Rooftop
  group.add(makeMesh(new THREE.BoxGeometry(width+0.24, 0.55, 0.24), concrete, [0, height+0.27, -depth/2]));
  const parapetRear = makeMesh(new THREE.BoxGeometry(width+0.24, 0.55, 0.24), concrete, [0, height+0.27, depth/2]);
  group.add(parapetRear);
  group.add(makeMesh(new THREE.BoxGeometry(0.24, 0.55, depth), concrete, [-width/2, height+0.27, 0]));
  const parapetRight = makeMesh(new THREE.BoxGeometry(0.24, 0.55, depth), concrete, [width/2, height+0.27, 0]);
  group.add(parapetRight);
  group.add(makeMesh(new RoundedBoxGeometry(width*0.34, 1.25, depth*0.3, 4, 0.08), metalDark, [0, height+0.63, 0]));
  group.add(makeMesh(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 24), chrome, [-width*0.24, height+0.56, depth*0.18]));
  const ventB = makeMesh(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 24), chrome, [width*0.24, height+0.56, depth*0.18]);
  group.add(ventB);

  // LED billboard panel on some buildings
  if (hasBillboard) {
    const billTex = createBillboardTexture();
    const billMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2,
      emissiveMap: billTex, map: billTex
    });
    const billW = Math.min(width * 0.7, 10);
    const billH = 3.5;
    const billY = podiumHeight + facadeHeight * (0.55 + random() * 0.3);
    const billboard = makeMesh(new THREE.PlaneGeometry(billW, billH), billMat,
      [0, billY, side>0 ? -depth/2-0.06 : depth/2+0.06], [0, side>0 ? 0 : Math.PI, 0]);
    billboard.userData.noShadow = true;
    group.add(billboard);
  }

  // Antenna
  if (random() > 0.42) {
    const antenna = makeMesh(new THREE.CylinderGeometry(0.035, 0.055, 4+random()*5, 12), metalDark, [0, height+2.6, 0]);
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff3658, emissive: 0xff3658, emissiveIntensity: 8.0 });
    const beacon = makeMesh(new THREE.SphereGeometry(0.12, 16, 12), beaconMat, [0, antenna.position.y+antenna.geometry.parameters.height/2, 0]);
    group.add(antenna, beacon);
  }

  group.userData.width = width; group.userData.height = height;
  return enableShadows(group);
}

export function createPalm(seed = 1) {
  const random = mulberry32(seed * 3181);
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: random() > 0.5 ? 0x25472b : 0x1c3a29, roughness: 0.8, side: THREE.DoubleSide });
  const height = 3.8 + random() * 2.2;
  const trunk = makeMesh(new THREE.CylinderGeometry(0.13, 0.22, height, 16), trunkMat, [0, height/2, 0], [0.03, 0, -0.05]);
  group.add(trunk);
  for (let i = 0; i < 10; i++) {
    const leaf = makeMesh(new THREE.ConeGeometry(0.42, 2.4, 12, 1, true), leafMat, [0, height, 0], [Math.PI/2.5, i*Math.PI/5, 0]);
    leaf.scale.set(0.5, 1, 0.18);
    group.add(leaf);
  }
  return enableShadows(group);
}

export function createStreetLight(side = 1) {
  const group = new THREE.Group();
  const pole = makeMesh(new THREE.CylinderGeometry(0.055, 0.08, 5.7, 16), metalDark, [0, 2.85, 0]);
  const arm = makeMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.55, 16), metalDark, [-side*0.68, 5.65, 0], [0, 0, Math.PI/2]);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd69a, emissive: 0xffa035, emissiveIntensity: 10.0 });
  const lamp = makeMesh(new THREE.SphereGeometry(0.14, 16, 12), lampMat, [-side*1.38, 5.6, 0]);
  // Volumetric light cone
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xffe8c0, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
  const cone = makeMesh(new THREE.ConeGeometry(1.8, 4.5, 20, 1, true), coneMat, [-side*1.38, 3.35, 0]);
  group.add(pole, arm, lamp, cone);
  return group;
}

export function createSky() {
  const uniforms = {
    topColor:     { value: new THREE.Color(0x0a3f7a) },   // deep azure
    middleColor:  { value: new THREE.Color(0x3a8dc8) },   // sky blue
    bottomColor:  { value: new THREE.Color(0xbde0f5) },   // pale horizon
    sunColor:     { value: new THREE.Color(0xfff8d0) },   // warm white sun
    sunDirection: { value: new THREE.Vector3(0.3, 0.88, -0.38).normalize() }, // high noon
    horizonGlow:  { value: new THREE.Color(0x7ab8d8) },   // cool blue horizon
    time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorld;
      uniform vec3 topColor;
      uniform vec3 middleColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform vec3 horizonGlow;
      uniform float time;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }

      void main() {
        float h = clamp(vWorld.y * 0.7 + 0.38, 0.0, 1.0);

        // Rayleigh-like sky gradient: pale at horizon, deep blue at zenith
        vec3 sky = mix(bottomColor, middleColor, smoothstep(0.0, 0.35, h));
        sky = mix(sky, topColor, smoothstep(0.3, 1.0, h));

        // Soft horizon glow
        float horizonFactor = pow(max(0.0, 1.0 - abs(vWorld.y) * 2.8), 3.0) * 0.28;
        sky += horizonGlow * horizonFactor;

        // Atmospheric haze near ground
        float haze = pow(max(0.0, 1.0 - vWorld.y * 4.0), 2.0) * 0.18;
        sky = mix(sky, bottomColor * 1.15, haze);

        // Sun disc — sharp and bright
        float sunDot = max(dot(vWorld, sunDirection), 0.0);
        float sunDisc  = pow(sunDot, 2800.0);
        float sunHalo  = pow(sunDot, 22.0);
        float sunCoron = pow(sunDot, 6.0);
        sky += sunColor * sunDisc  * 5.0;
        sky += sunColor * sunHalo  * 0.35;
        sky += vec3(0.9, 0.95, 1.0) * sunCoron * 0.08;

        // Subtle cloud-like variation using time
        float cloud = sin(vWorld.x * 12.0 + time * 0.05) * sin(vWorld.z * 9.0 + time * 0.03);
        cloud = smoothstep(0.55, 0.85, cloud * 0.5 + 0.5) * smoothstep(0.1, 0.6, vWorld.y) * 0.06;
        sky += vec3(cloud);

        // Subtle film grain
        float grain = (hash(gl_FragCoord.xy * 0.5 + time) - 0.5) / 280.0;
        gl_FragColor = vec4(sky + grain, 1.0);
      }
    `,
  });

  const mesh = makeMesh(new THREE.SphereGeometry(600, 64, 48), material);
  mesh.userData.skyMaterial = material;
  return mesh;
}

export function createMountains() {
  const group = new THREE.Group();
  const farMat = new THREE.MeshStandardMaterial({ color: 0x1a252b, roughness: 1, fog: true });
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.9, fog: true });

  for (let i = 0; i < 28; i++) {
    const mHeight = 16 + Math.sin(i * 1.8) * 8 + Math.random() * 20;
    const mRad = 18 + Math.random() * 22;
    const colVariant = i % 3 === 0 ? 0x1a252b : (i % 3 === 1 ? 0x151d22 : 0x212e36);
    const mMat = new THREE.MeshStandardMaterial({ color: colVariant, roughness: 1, fog: true });
    const mountain = makeMesh(new THREE.ConeGeometry(mRad, mHeight, 16), mMat, [(i-14)*26, mHeight/2-2, -320-Math.random()*110], [0, Math.random(), 0]);
    group.add(mountain);

    // Snow caps on taller peaks
    if (mHeight > 26) {
      const snowH = mHeight * 0.22;
      const snowR = (mRad / mHeight) * snowH * 1.08;
      const snowCap = makeMesh(new THREE.ConeGeometry(snowR, snowH, 12), snowMat,
        [(i-14)*26, mHeight - snowH * 0.35 - 2, -320-Math.random()*110], [0, Math.random(), 0]);
      group.add(snowCap);
    }
  }
  return group;
}

export function createMistParticles(count = 1400) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i*3] = (Math.random()-0.5)*76;
    positions[i*3+1] = 0.3 + Math.random()*16;
    positions[i*3+2] = -Math.random()*250 + 20;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.PointsMaterial({ color: 0xcce9ff, size: 0.07, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  points.userData.initial = positions.slice();
  return points;
}

export function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}