export const PLAYER_Z = 4;
export const SEGMENT_COUNT = 48;
export const SEGMENT_LENGTH = 40;
export const ROAD_HALF = 9;
export const ROAD_WIDTH = ROAD_HALF * 2;

export const LANES = [-5, -2.5, 0, 2.5, 5];

export const RIVAL_CONFIG = [
  { color: 0xff4d3d, accent: 0xffd23d, distance: 20, speed: 0, lane: -5 },
  { color: 0x4d7dff, accent: 0x9bff3d, distance: 45, speed: 0, lane: -2.5 },
  { color: 0xb44dff, accent: 0x3dffd2, distance: 10, speed: 0, lane: 0 },
  { color: 0xff8a3d, accent: 0xff3d8a, distance: 60, speed: 0, lane: 2.5 },
  { color: 0x3dff8a, accent: 0xffe23d, distance: 35, speed: 0, lane: 5 },
  { color: 0xff3d3d, accent: 0x3dafff, distance: -10, speed: 0, lane: -2.5 },
];

export const CAR_COLORS = [
  0x36566f, 0x9a2b2b, 0x2b6b3a, 0x8a8a2b,
  0x6b2b6b, 0x2b5a8a, 0xb5b5b5, 0x222222, 0xc77f1a,
];

export const MAX_SPEED = 250;
export const BOOST_SPEED = 300;
export const RACE_LENGTH = 4500;

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
