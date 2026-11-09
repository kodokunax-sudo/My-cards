// Единые константы мира. Единица измерения — метр.
// Ключевая идея сцены: высота сооружения = 33 роста игрока.

export const PLAYER_HEIGHT = 1.7;                  // рост игрока, м
export const SCALE_FACTOR = 33;                    // во сколько раз фонтан выше
export const FOUNTAIN_HEIGHT = PLAYER_HEIGHT * SCALE_FACTOR; // 56.1 м

export const POOL_RADIUS = 52;                     // радиус бассейна (внешний)
export const POOL_DEPTH = 28;                       // глубина бассейна под уровнем парка
export const POOL_BOTTOM_Y = -POOL_DEPTH;
export const WATER_Y = 1.15;                       // уровень поверхности воды
export const ISLAND_RADIUS = 15;                   // цоколь островка
export const ISLAND_TOP = 4.2;                     // уровень площадки островка
export const PLAZA_RADIUS = 175;                   // круглая площадь
export const GRASS_RADIUS = 5200;                  // новый радиус игрового мира: ×10
export const EYE_HEIGHT = 1.62;                    // высота глаз над полом

export const GRAVITY = 9.81;

// Направление на солнце (юг-готово, золотой час).
const EL = 0.30, AZ = 0.92;
export const SUN_DIR = {
  x: Math.sin(AZ) * Math.cos(EL),
  y: Math.sin(EL),
  z: -Math.cos(AZ) * Math.cos(EL),
};

export const PALETTE = {
  stone: 0xd9cdb2,
  stoneWarm: 0xe3d6b8,
  stoneDeep: 0xa8937a,
  marble: 0xf0e8d6,
  basin: 0x9a8b74,
  poolFloor: 0x1d4a52,
  gold: 0xe0a94a,
  waterDeep: 0x0b3f4c,
  waterShallow: 0x2f9fae,
  grass: 0x4a6640,
  grassDeep: 0x35502f,
  horizon: 0xf0b478,
  skyTop: 0x1d4d8f,
  skyBottom: 0x6d5a45,
  sun: 0xffd9a2,
  city: 0x2c3550,
  mountain: 0x3c4560,
  foliage: 0x3f6136,
  bark: 0x4a3b2c,
};

export const BOWLS = [
  // y — высота чаши над землёй, r — радиус чаши
  { y: 12.5, r: 11.0, jets: 16, angle: 62, reach: 13.0 },
  { y: 21.0, r: 8.6, jets: 14, angle: 64, reach: 15.0 },
  { y: 29.5, r: 6.9, jets: 12, angle: 66, reach: 17.0 },
  { y: 38.0, r: 5.4, jets: 10, angle: 68, reach: 19.0 },
];

// Траектория струи: старт на rim чаши, финиш — вода бассейна.
export function jetTrajectory(startRadius, startY, angleDeg, reach, waterY = WATER_Y) {
  const th = (angleDeg * Math.PI) / 180;
  const d = reach; // горизонтальное расстояние
  const K = startY + d * Math.tan(th) - waterY;
  const speed = d * Math.sqrt(4.905 / (K * Math.cos(th) * Math.cos(th)));
  const tLand = d / (speed * Math.cos(th));
  return { speed, tLand, angle: th };
}
