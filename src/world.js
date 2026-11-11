import * as THREE from 'three';
import {
  POOL_RADIUS, POOL_BOTTOM_Y, WATER_Y, GRASS_RADIUS, PLAZA_RADIUS,
} from './config.js';

const TAU = Math.PI * 2;
const HILLS = [
  [-3050, -1950, 760, 78], [2380, -2380, 820, 108],
  [2820, 2180, 880, 94], [-3280, 2900, 730, 86],
  [300, -4050, 690, 92], [-4250, -750, 640, 76],
  [4420, 850, 580, 72], [900, 3970, 620, 84],
  [-1150, -3250, 540, 58], [1650, 950, 520, 48],
  [-650, -920, 520, 116], [720, 680, 540, 138],
  [-1850, 2350, 590, 132], [1220, -1580, 660, 142],
  [2450, 820, 700, 158], [-2850, 1850, 640, 146],
];

const RIDGES = [
  [-5100, -4200, -3150, -2500, 230, 132],
  [250, -5250, 1850, -3650, 270, 158],
  [1780, -1050, 3850, 1650, 250, 150],
  [-4550, 1050, -2920, 3700, 245, 128],
  [-1650, 3900, 250, 5050, 210, 105],
  [2650, 3150, 4450, 4300, 180, 96],
  [-3500, -500, -2550, 1250, 165, 88],
];

function seededRandom(seed = 914207) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x, z, seed) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx0 = x - ix, fz0 = z - iz;
  const fx = fx0 * fx0 * fx0 * (fx0 * (fx0 * 6 - 15) + 10);
  const fz = fz0 * fz0 * fz0 * (fz0 * (fz0 * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, fx),
    THREE.MathUtils.lerp(c, d, fx),
    fz
  );
}

const RIVER_WATER_WIDTH_SCALE = 1.2;

function mainRiverX(z) {
  return -900 + 840 * Math.sin(z / 1200);
}

function mainRiverStation(x, z) {
  let station = z;
  for (let i = 0; i < 4; i++) {
    const angle = station / 1200;
    const centerX = mainRiverX(station);
    const slope = 0.7 * Math.cos(angle);
    const curve = -(840 / (1200 * 1200)) * Math.sin(angle);
    const dx = x - centerX;
    const dz = z - station;
    const derivative = -dx * slope - dz;
    const second = 1 + slope * slope - dx * curve;
    station = THREE.MathUtils.clamp(station - derivative / Math.max(0.2, second), -5000, 5000);
  }
  return {
    station,
    distance: Math.hypot(x - mainRiverX(station), z - station),
  };
}

function mainRiverLateralDistance(x, z) {
  return mainRiverStation(x, z).distance;
}

function mainRiverHalfWidth(z) {
  const pools = Math.max(
    gaussian(z, -2850, 420),
    gaussian(z, 250, 520),
    gaussian(z, 2380, 460)
  );
  const pinch = Math.max(
    gaussian(z, -1580, 300),
    gaussian(z, 1280, 320),
    gaussian(z, 3550, 280)
  );
  return THREE.MathUtils.clamp(
    14 + 4.2 * Math.sin(z / 960 + 0.8) + 2.1 * Math.sin(z / 370) +
      pools * 5.2 - pinch * 5.4,
    9.2, 23.5
  );
}

function tributaryZ(x) {
  return 4200 + 180 * Math.sin(x / 650);
}

function tributaryStation(x, z) {
  let station = x;
  for (let i = 0; i < 4; i++) {
    const angle = station / 650;
    const centerZ = tributaryZ(station);
    const slope = (180 / 650) * Math.cos(angle);
    const curve = -(180 / (650 * 650)) * Math.sin(angle);
    const dx = x - station;
    const dz = z - centerZ;
    const derivative = dx - dz * slope;
    const second = 1 + slope * slope - dz * curve;
    station = THREE.MathUtils.clamp(station - derivative / Math.max(0.2, second), -3200, 3200);
  }
  return {
    station,
    distance: Math.hypot(x - station, z - tributaryZ(station)),
  };
}

function tributaryLateralDistance(x, z) {
  return tributaryStation(x, z).distance;
}

function tributaryHalfWidth(x) {
  const widePool = Math.max(gaussian(x, -1450, 430), gaussian(x, 900, 400));
  const narrowBar = Math.max(gaussian(x, -300, 280), gaussian(x, 2050, 300));
  return THREE.MathUtils.clamp(
    10.8 + 2.8 * Math.sin(x / 720 - 0.4) + widePool * 3.8 - narrowBar * 3.0,
    7.2, 17.5
  );
}

function gaussian(value, center, width) {
  const t = (value - center) / width;
  return Math.exp(-0.5 * t * t);
}

// Water levels and channel depth are measured from the actual terrain on
// both sides of each river. The terrain is sampled before the channel is cut,
// so these values cannot depend on a fixed world-space Y level or recurse.
function createRiverProfiles(baseHeightAt) {
  function measureBanks(centerX, centerZ, normalX, normalZ, waterHalfWidth) {
    const nearOffset = waterHalfWidth + 3.5;
    const shoulderOffset = waterHalfWidth + 48;
    const sample = (offset) => baseHeightAt(
      centerX + normalX * offset,
      centerZ + normalZ * offset
    ) ?? 0;
    const nearLeft = sample(nearOffset);
    const nearRight = sample(-nearOffset);
    const shoulderLeft = sample(shoulderOffset);
    const shoulderRight = sample(-shoulderOffset);
    const meanNear = (nearLeft + nearRight) * 0.5;
    const meanShoulder = (shoulderLeft + shoulderRight) * 0.5;
    const bankRise = Math.max(
      0,
      meanShoulder - meanNear,
      shoulderLeft - nearLeft,
      shoulderRight - nearRight
    );
    return {
      lowerBank: Math.min(nearLeft, nearRight),
      bankRise,
      bankDifference: Math.abs(nearLeft - nearRight),
    };
  }

  function mainBankData(station) {
    const slope = 0.7 * Math.cos(station / 1200);
    const normalLength = Math.hypot(1, slope);
    const width = mainRiverHalfWidth(station) * RIVER_WATER_WIDTH_SCALE;
    return measureBanks(
      mainRiverX(station), station,
      1 / normalLength, -slope / normalLength, width
    );
  }

  function tributaryBankData(station) {
    const slope = (180 / 650) * Math.cos(station / 650);
    const normalLength = Math.hypot(slope, 1);
    const width = tributaryHalfWidth(station) * RIVER_WATER_WIDTH_SCALE;
    return measureBanks(
      station, tributaryZ(station),
      -slope / normalLength, 1 / normalLength, width
    );
  }

  const mainSurfaceFromBanks = (station) => {
    const banks = mainBankData(station);
    // The water sits just below the lower of the two banks. Small ripples
    // remain, but the shoreline itself determines the actual water height.
    return banks.lowerBank - 0.32 +
      0.045 * Math.sin(station / 510) +
      0.025 * Math.sin(station / 177);
  };

  const mainDepthFromBanks = (station) => {
    const banks = mainBankData(station);
    const width = mainRiverHalfWidth(station) * RIVER_WATER_WIDTH_SCALE;
    return THREE.MathUtils.clamp(
      3.8 + width * 0.24 + banks.bankRise * 0.95 + banks.bankDifference * 0.12,
      5.2, 23
    );
  };

  const tributarySurfaceFromBanks = (station) => {
    const banks = tributaryBankData(station);
    return banks.lowerBank - 0.30 +
      0.035 * Math.sin(station / 430 + 0.4);
  };

  const tributaryDepthFromBanks = (station) => {
    const banks = tributaryBankData(station);
    const width = tributaryHalfWidth(station) * RIVER_WATER_WIDTH_SCALE;
    return THREE.MathUtils.clamp(
      3.4 + width * 0.24 + banks.bankRise * 0.9 + banks.bankDifference * 0.10,
      4.8, 19
    );
  };

  // The tributary physically crosses the main river. Both water meshes and
  // both riverbeds must share one elevation/depth at that exact junction.
  let junctionX = -1100;
  for (let i = 0; i < 8; i++) junctionX = mainRiverX(tributaryZ(junctionX));
  const junctionStation = tributaryZ(junctionX);
  const junctionSurface = Math.min(
    mainSurfaceFromBanks(junctionStation),
    tributarySurfaceFromBanks(junctionX)
  );
  const junctionDepth = Math.max(
    mainDepthFromBanks(junctionStation),
    tributaryDepthFromBanks(junctionX)
  );

  const mainJoinBlend = (station) =>
    1 - smoothstep(90, 620, Math.abs(station - junctionStation));
  const tributaryJoinBlend = (station) =>
    1 - smoothstep(90, 620, Math.abs(station - junctionX));

  const mainSurface = (station) => THREE.MathUtils.lerp(
    mainSurfaceFromBanks(station), junctionSurface, mainJoinBlend(station)
  );
  const mainDepth = (station) => THREE.MathUtils.lerp(
    mainDepthFromBanks(station), junctionDepth, mainJoinBlend(station)
  );
  const tributarySurface = (station) => THREE.MathUtils.lerp(
    tributarySurfaceFromBanks(station), junctionSurface, tributaryJoinBlend(station)
  );
  const tributaryDepth = (station) => THREE.MathUtils.lerp(
    tributaryDepthFromBanks(station), junctionDepth, tributaryJoinBlend(station)
  );

  return {
    mainSurface,
    mainDepth,
    tributarySurface,
    tributaryDepth,
  };
}

function distanceToSegment2D(px, pz, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = THREE.MathUtils.clamp(((px - a.x) * dx + (pz - a.z) * dz) / len2, 0, 1);
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment2D(x, z, points[i], points[i + 1]));
  }
  return best;
}

function registerChunkMesh(mesh, renderables, maxDistance, occlusionCandidate = false) {
  mesh.frustumCulled = true;
  if (mesh.isInstancedMesh) mesh.computeBoundingSphere();
  else mesh.geometry.computeBoundingSphere();

  // Kept for diagnostics and optional distance-based LOD later. Actual
  // visibility is decided by Three.js per camera, including reflection cameras.
  mesh.userData.maxDrawDistance = maxDistance;
  mesh.userData.occlusionCandidate = occlusionCandidate;
  renderables.push(mesh);
}

function createTerrainMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
  });

  // Small tileable grass/soil textures are generated locally so the scene
  // needs no external image downloads. World-space UVs keep scale consistent.
  const textureSize = 256;
  const colorPixels = new Uint8Array(textureSize * textureSize * 4);
  const bumpPixels = new Uint8Array(textureSize * textureSize * 4);
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const u = x / textureSize;
      const v = y / textureSize;
      const wave = Math.sin((u * 13 + Math.sin(v * Math.PI * 6) * 0.22) * Math.PI * 2);
      const cross = Math.cos((v * 9 + Math.sin(u * Math.PI * 8) * 0.18) * Math.PI * 2);
      const hash = hash2(x, y, 127);
      const fine = hash2(x * 3, y * 3, 131);
      const blade = Math.pow(Math.max(0, Math.sin((u * 71 + Math.sin(v * Math.PI * 14) * 0.65) * Math.PI * 2)), 10);
      const grain = wave * 0.34 + cross * 0.22 + (hash - 0.5) * 0.30 + (fine - 0.5) * 0.14;
      const shade = THREE.MathUtils.clamp(0.5 + grain * 0.42 - blade * 0.22, 0, 1);
      const index = (y * textureSize + x) * 4;
      colorPixels[index] = Math.round(226 + shade * 27);
      colorPixels[index + 1] = Math.round(232 + shade * 23);
      colorPixels[index + 2] = Math.round(213 + shade * 31);
      colorPixels[index + 3] = 255;

      const relief = THREE.MathUtils.clamp(128 + grain * 44 - blade * 36, 0, 255);
      bumpPixels[index] = relief;
      bumpPixels[index + 1] = relief;
      bumpPixels[index + 2] = relief;
      bumpPixels[index + 3] = 255;
    }
  }

  const grassTexture = new THREE.DataTexture(
    colorPixels, textureSize, textureSize, THREE.RGBAFormat, THREE.UnsignedByteType
  );
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.magFilter = THREE.LinearFilter;
  grassTexture.minFilter = THREE.LinearMipmapLinearFilter;
  grassTexture.generateMipmaps = true;
  grassTexture.colorSpace = THREE.SRGBColorSpace;
  grassTexture.needsUpdate = true;

  const grassBump = new THREE.DataTexture(
    bumpPixels, textureSize, textureSize, THREE.RGBAFormat, THREE.UnsignedByteType
  );
  grassBump.wrapS = THREE.RepeatWrapping;
  grassBump.wrapT = THREE.RepeatWrapping;
  grassBump.magFilter = THREE.LinearFilter;
  grassBump.minFilter = THREE.LinearMipmapLinearFilter;
  grassBump.generateMipmaps = true;
  grassBump.needsUpdate = true;

  material.map = grassTexture;
  material.bumpMap = grassBump;
  material.bumpScale = 0.075;

  const noiseGLSL = `
    float terrainHash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float terrainNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), f.x),
        mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float riverGaussian(float x, float centre, float width) {
      float t = (x - centre) / width;
      return exp(-0.5 * t * t);
    }

    float terrainMainWidth(float station) {
      float pools = max(
        riverGaussian(station, -2850.0, 420.0),
        max(riverGaussian(station, 250.0, 520.0), riverGaussian(station, 2380.0, 460.0))
      );
      float pinch = max(
        riverGaussian(station, -1580.0, 300.0),
        max(riverGaussian(station, 1280.0, 320.0), riverGaussian(station, 3550.0, 280.0))
      );
      return clamp(
        14.0 + 4.2 * sin(station / 960.0 + 0.8) + 2.1 * sin(station / 370.0) +
        pools * 5.2 - pinch * 5.4, 9.2, 23.5
      );
    }

    float terrainMainDistance(vec2 p, out float station) {
      station = p.y;
      for (int i = 0; i < 2; i++) {
        float angle = station / 1200.0;
        float centreX = -900.0 + 840.0 * sin(angle);
        float slope = 0.7 * cos(angle);
        float curve = -(840.0 / 1440000.0) * sin(angle);
        float dx = p.x - centreX;
        float dz = p.y - station;
        float derivative = -dx * slope - dz;
        float second = 1.0 + slope * slope - dx * curve;
        station = clamp(station - derivative / max(0.2, second), -5000.0, 5000.0);
      }
      vec2 centre = vec2(-900.0 + 840.0 * sin(station / 1200.0), station);
      return length(p - centre);
    }

    float terrainTributaryWidth(float station) {
      float widePool = max(
        riverGaussian(station, -1450.0, 430.0),
        riverGaussian(station, 900.0, 400.0)
      );
      float narrowBar = max(
        riverGaussian(station, -300.0, 280.0),
        riverGaussian(station, 2050.0, 300.0)
      );
      return clamp(
        10.8 + 2.8 * sin(station / 720.0 - 0.4) +
        widePool * 3.8 - narrowBar * 3.0, 7.2, 17.5
      );
    }

    float terrainTributaryDistance(vec2 p, out float station) {
      station = p.x;
      for (int i = 0; i < 2; i++) {
        float angle = station / 650.0;
        float centreZ = 4200.0 + 180.0 * sin(angle);
        float slope = (180.0 / 650.0) * cos(angle);
        float curve = -(180.0 / 422500.0) * sin(angle);
        float dx = p.x - station;
        float dz = p.y - centreZ;
        float derivative = dx - dz * slope;
        float second = 1.0 + slope * slope - dz * curve;
        station = clamp(station - derivative / max(0.2, second), -3200.0, 3200.0);
      }
      vec2 centre = vec2(station, 4200.0 + 180.0 * sin(station / 650.0));
      return length(p - centre);
    }
  `;

  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTerrainWorld;
        varying vec3 vTerrainNormal;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTerrainWorld;
        varying vec3 vTerrainNormal;
        ${noiseGLSL}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 p = vTerrainWorld.xz;
          float macroNoise = terrainNoise(p * 0.018);
          float midNoise = terrainNoise(p * 0.15);
          float fineNoise = terrainNoise(p * 0.92);
          float flecks = terrainNoise(p * 2.7);
          float bladeLines = 1.0 - smoothstep(0.02, 0.18,
            abs(sin(p.x * 2.9 + sin(p.y * 0.73) * 1.7 + terrainNoise(p * 0.42) * 2.0)));
          float groundDetail = macroNoise * 0.16 + midNoise * 0.22 +
            fineNoise * 0.18 + flecks * 0.08 + bladeLines * 0.035;
          diffuseColor.rgb *= 0.76 + groundDetail;

          float slope = 1.0 - clamp(vTerrainNormal.y, 0.0, 1.0);
          float exposedRock = smoothstep(0.38, 0.78, slope);
          vec3 earthyRock = vec3(0.29, 0.285, 0.245) * (0.88 + fineNoise * 0.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, earthyRock, exposedRock * 0.32);

          float soilSpeckle = smoothstep(0.72, 0.96, flecks) * (1.0 - exposedRock);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.22, 0.16), soilSpeckle * 0.12);

          // Sandy riverbanks are painted directly into the terrain material.
          // This uses the same centreline/width equations as the water mesh,
          // so there is no separate strip that can float above or detach from shore.
          float mainEdgeDistance = 100000.0;
          float sideEdgeDistance = 100000.0;
          float mainSand = 0.0;
          float sideSand = 0.0;

          // Skip centreline projection almost everywhere on the map.
          if (abs(p.x - (-900.0 + 840.0 * sin(p.y / 1200.0))) < 72.0) {
            float mainStation;
            float mainDistance = terrainMainDistance(p, mainStation);
            float mainWidth = terrainMainWidth(mainStation);
            float mainWaterWidth = mainWidth * 1.2;
            mainEdgeDistance = mainDistance - mainWaterWidth;
            // Extend the existing sand band inward by 40% of the original
            // river half-width, measured from the new water edge.
            float mainSandInner = mainWaterWidth - mainWidth * 0.4;
            mainSand = smoothstep(mainSandInner - 2.4, mainSandInner + 2.8, mainDistance) *
              (1.0 - smoothstep(mainWidth + 14.0, mainWidth + 34.0, mainDistance));
          }

          if (abs(p.y - (4200.0 + 180.0 * sin(p.x / 650.0))) < 58.0) {
            float sideStation;
            float sideDistance = terrainTributaryDistance(p, sideStation);
            float sideWidth = terrainTributaryWidth(sideStation);
            float sideWaterWidth = sideWidth * 1.2;
            sideEdgeDistance = sideDistance - sideWaterWidth;
            float sideSandInner = sideWaterWidth - sideWidth * 0.4;
            sideSand = smoothstep(sideSandInner - 2.2, sideSandInner + 2.6, sideDistance) *
              (1.0 - smoothstep(sideWidth + 12.0, sideWidth + 30.0, sideDistance));
          }

          float sandMask = max(mainSand, sideSand);
          float sandGrain = terrainNoise(p * 0.11);
          float sandPatch = terrainNoise(p * 0.027 + vec2(17.3, 5.7));
          vec3 sandGold = vec3(0.66, 0.48, 0.25);
          vec3 sandOrange = vec3(0.53, 0.30, 0.16);
          vec3 sandPale = vec3(0.77, 0.65, 0.43);
          vec3 sandGrey = vec3(0.40, 0.39, 0.34);
          vec3 sandColor = mix(sandOrange, sandGold, smoothstep(0.18, 0.82, sandGrain));
          sandColor = mix(sandColor, sandPale, smoothstep(0.64, 0.94, sandGrain) * 0.48);
          sandColor = mix(sandColor, sandGrey, smoothstep(0.78, 0.94, sandPatch) * 0.56);
          float wetEdge = 1.0 - smoothstep(0.6, 6.5,
            min(mainEdgeDistance, sideEdgeDistance));
          sandColor = mix(sandColor * 0.72, sandColor, 1.0 - wetEdge * 0.58);
          sandColor *= 0.9 + sandGrain * 0.18;
          diffuseColor.rgb = mix(diffuseColor.rgb, sandColor, sandMask * 0.98);
        }
      `);
  };
  return material;
}

function createRenderedTerrainSampler(heightAt) {
  const chunksPerAxis = 14;
  const cellsPerChunk = 64;
  const step = (GRASS_RADIUS * 2) / (chunksPerAxis * cellsPerChunk);
  const vertexHeight = (x, z) => {
    const h = heightAt(x, z) ?? 0;
    const underPlaza = 1 - smoothstep(PLAZA_RADIUS - 8, PLAZA_RADIUS + 26, Math.hypot(x, z));
    return h - 0.62 * underPlaza;
  };

  return (x, z) => {
    const radial = Math.hypot(x, z);
    if (radial > GRASS_RADIUS || radial < POOL_RADIUS + 1.0) return null;

    // Sample the exact pair of triangles used by createTerrain(), rather than
    // sampling the smooth source function between rendered vertices.
    const gx = THREE.MathUtils.clamp((x + GRASS_RADIUS) / step, 0, chunksPerAxis * cellsPerChunk - 1e-5);
    const gz = THREE.MathUtils.clamp((z + GRASS_RADIUS) / step, 0, chunksPerAxis * cellsPerChunk - 1e-5);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const tx = gx - ix;
    const tz = gz - iz;
    const x0 = -GRASS_RADIUS + ix * step;
    const z0 = -GRASS_RADIUS + iz * step;
    const a = vertexHeight(x0, z0);
    const b = vertexHeight(x0 + step, z0);
    const c = vertexHeight(x0, z0 + step);
    const d = vertexHeight(x0 + step, z0 + step);

    if (tx + tz <= 1) return a * (1 - tx - tz) + b * tx + c * tz;
    return b * (1 - tz) + c * (1 - tx) + d * (tx + tz - 1);
  };
}

function createFlowingWaterMaterial(baseColor) {
  let compiledShader = null;
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.42,
    metalness: 0.0,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFlowTime = { value: 0 };
    compiledShader = shader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFlowWorld;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uFlowTime;
        varying vec3 vFlowWorld;
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float longWave = sin(vFlowWorld.x * 0.19 + vFlowWorld.z * 0.31 + uFlowTime * 1.25);
          float crossWave = sin(vFlowWorld.z * 0.57 - vFlowWorld.x * 0.09 - uFlowTime * 0.82);
          float glint = pow(max(0.0, longWave * 0.55 + crossWave * 0.45), 5.0);
          diffuseColor.rgb *= 0.88 + longWave * 0.045 + crossWave * 0.035;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.84, 0.84), glint * 0.2);
        }
      `);
  };
  material.userData.setTime = (time) => {
    if (compiledShader) compiledShader.uniforms.uFlowTime.value = time;
  };
  return material;
}

function createBaseTerrainHeightFunction(routePoints) {
  return (x, z) => {
    if (Math.hypot(x, z) > GRASS_RADIUS + 30) return null;

    const broad = (valueNoise(x / 1750, z / 1750, 11) - 0.5) * 104;
    const rolling = (valueNoise(x / 520, z / 520, 17) - 0.5) * 42;
    const detail = (valueNoise(x / 175, z / 175, 23) - 0.5) * 16;
    const fineRelief = (valueNoise(x / 86, z / 86, 29) - 0.5) * 5.8;
    const microRelief = (valueNoise(x / 48, z / 48, 37) - 0.5) * 5.0 +
      (valueNoise(x / 21, z / 21, 41) - 0.5) * 1.8 +
      (valueNoise(x / 9, z / 9, 43) - 0.5) * 0.55;
    const ridgeNoise = 1 - Math.abs(valueNoise(x / 760, z / 760, 31) * 2 - 1);
    let height = broad + rolling + detail + fineRelief + microRelief + (ridgeNoise - 0.44) * 23;

    for (const [hx, hz, radius, peak] of HILLS) {
      const dx = x - hx, dz = z - hz;
      height += peak * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
    }

    for (const [ax, az, bx, bz, width, peak] of RIDGES) {
      const dx = bx - ax, dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
      const nearestX = ax + dx * t, nearestZ = az + dz * t;
      const distance = Math.hypot(x - nearestX, z - nearestZ);
      const endFade = Math.min(1, 0.28 + Math.min(t, 1 - t) * 4.2);
      height += peak * Math.exp(-(distance * distance) / (2 * width * width)) * endFade;
    }

    const parkBlend = 1 - smoothstep(210, 390, Math.hypot(x, z));
    const houseBlend = 1 - smoothstep(38, 82, Math.hypot(x + 1600, z - 900));
    const trailBlend = 1 - smoothstep(12, 34, distanceToPolyline(x, z, routePoints));
    const protectedFlat = Math.max(parkBlend, houseBlend, trailBlend);
    height *= 1 - protectedFlat;

    const gullyNoise = valueNoise(x / 610, z / 610, 49);
    const gully = Math.pow(Math.max(0, 1 - Math.abs(gullyNoise * 2 - 1)), 5);
    const shallowErosion = Math.pow(Math.max(0, 1 - Math.abs(valueNoise(x / 245, z / 245, 53) * 2 - 1)), 4);
    height -= (gully * 10.5 + shallowErosion * 2.2) * (1 - protectedFlat);

    const ravines = [
      [-3900, -1800, -2600, -650, 34, 7.5],
      [900, -4300, 2050, -2750, 28, 6.2],
      [2500, 900, 3900, 2450, 31, 8.0],
      [-3050, 2550, -1450, 3650, 25, 5.8],
      [400, 1450, 1550, 2750, 22, 5.2],
    ];
    let erosion = 0;
    for (const [ax, az, bx, bz, width, depth] of ravines) {
      const distance = distanceToSegment2D(x, z, { x: ax, z: az }, { x: bx, z: bz });
      const channel = Math.exp(-Math.pow(distance / width, 2) * 1.7);
      const shoulder = Math.exp(-Math.pow(distance / (width * 2.8), 2) * 0.75);
      erosion = Math.max(erosion, channel * depth + shoulder * depth * 0.22);
    }
    height -= erosion * (1 - protectedFlat);
    return THREE.MathUtils.clamp(height, -65, 225);
  };
}

function createHeightFunction(baseHeightAt, riverProfiles, bridgeDeckTopY) {
  return (x, z) => {
    if (Math.hypot(x, z) > GRASS_RADIUS + 30) return null;
    let height = baseHeightAt(x, z) ?? 0;

    const mainStation = mainRiverStation(x, z);
    const mainWidth = mainRiverHalfWidth(mainStation.station);
    const mainSurface = riverProfiles.mainSurface(mainStation.station);
    const mainDepth = riverProfiles.mainDepth(mainStation.station);
    const mainDistance = mainStation.distance;
    const mainWaterWidth = mainWidth * RIVER_WATER_WIDTH_SCALE;
    const mainProfile = mainDistance <= mainWaterWidth
      ? mainSurface - mainDepth +
        smoothstep(mainWidth * 0.28, mainWaterWidth, mainDistance) * mainDepth
      : mainSurface + smoothstep(mainWaterWidth, mainWaterWidth + 18, mainDistance) * 1.45;
    const mainBankBlend = 1 - smoothstep(mainWaterWidth + 15, mainWaterWidth + 58, mainDistance);
    height = THREE.MathUtils.lerp(height, mainProfile, mainBankBlend);

    const sideStation = tributaryStation(x, z);
    const sideWidth = tributaryHalfWidth(sideStation.station);
    const sideSurface = riverProfiles.tributarySurface(sideStation.station);
    const sideDepth = riverProfiles.tributaryDepth(sideStation.station);
    const sideDistance = sideStation.distance;
    const sideWaterWidth = sideWidth * RIVER_WATER_WIDTH_SCALE;
    const sideProfile = sideDistance <= sideWaterWidth
      ? sideSurface - sideDepth +
        smoothstep(sideWidth * 0.28, sideWaterWidth, sideDistance) * sideDepth
      : sideSurface + smoothstep(sideWaterWidth, sideWaterWidth + 16, sideDistance) * 1.25;
    const tributaryBankBlend = 1 - smoothstep(sideWaterWidth + 14, sideWaterWidth + 52, sideDistance);
    height = THREE.MathUtils.lerp(height, sideProfile, tributaryBankBlend);

    // Only the bridge approach is lowered. Outside its feathered footprint,
    // preserve the unmodified local terrain elevation.
    const bridgeApproachX = 1 - smoothstep(45, 190, Math.abs(x + 692));
    const bridgeApproachZ = 1 - smoothstep(8, 22, Math.abs(z - 300));
    const bridgeApproachBlend = bridgeApproachX * bridgeApproachZ;
    const bridgeTarget = THREE.MathUtils.lerp(height, bridgeDeckTopY - 0.18, bridgeApproachBlend);
    height = Math.min(height, bridgeTarget);

    return THREE.MathUtils.clamp(height, -65, 225);
  };
}

function createWorldChunkStreamer() {
  const jobs = [];
  const LOAD_RADIUS = 1480;
  let loaded = 0;

  function enqueue(x, z, type, build) {
    // Keep a lightweight registry only. A distant chunk is not queued until
    // the player actually approaches it.
    jobs.push({ x, z, type, build, done: false, order: jobs.length });
  }

  function nearbyJobs(x, z) {
    return jobs
      .filter((job) => !job.done && Math.hypot(job.x - x, job.z - z) <= LOAD_RADIUS)
      .sort((a, b) => {
        const da = Math.hypot(a.x - x, a.z - z);
        const db = Math.hypot(b.x - x, b.z - z);
        const priority = { terrain: 0, river: 1, forest: 2, rocks: 3, cover: 4 };
        return (priority[a.type] || 0) - (priority[b.type] || 0) || da - db || a.order - b.order;
      });
  }

  function buildOne(job) {
    if (!job || job.done) return;
    job.done = true;
    try {
      job.build();
      loaded++;
    } catch (error) {
      console.error('[World streaming] Chunk failed:', job.type, job.x, job.z, error);
    }
  }

  return {
    enqueue,
    prime(x, z, count = 2) {
      const nearby = nearbyJobs(x, z);
      for (let i = 0; i < Math.min(count, nearby.length); i++) buildOne(nearby[i]);
    },
    async preloadNearby(x, z, onProgress = () => {}) {
      // Finish the complete starting bubble before the player enters the world.
      // Chunks outside LOAD_RADIUS remain untouched until the player approaches.
      const nearby = nearbyJobs(x, z);
      for (let i = 0; i < nearby.length; i++) {
        const job = nearby[i];
        if (job.done) continue;
        buildOne(job);
        if (i % 2 === 1 || i === nearby.length - 1) {
          onProgress(`Подготавливаем ближайший мир... ${Math.round((i + 1) / nearby.length * 100)}%`);
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
      return nearby.length;
    },
    update(x, z) {
      const nearby = nearbyJobs(x, z);
      if (nearby.length) buildOne(nearby[0]);
      return this.updateProgress(x, z);
    },
    updateProgress(x, z) {
      const pending = nearbyJobs(x, z).length;
      return { loaded, pending, percent: pending ? Math.round(loaded / (loaded + pending) * 100) : 100 };
    },
    get progress() {
      return { loaded, pending: jobs.filter((job) => !job.done).length };
    },
  };
}


function createTerrain(scene, heightAt, renderables, streamer) {
  const chunksPerAxis = 14;
  // 64 cells in each 800m chunk => 12.5m spacing (was 26.7m).
  const cellsPerChunk = 64;
  const chunkSize = (GRASS_RADIUS * 2) / chunksPerAxis;
  const step = chunkSize / cellsPerChunk;

  const low = new THREE.Color(0x3c5a32);
  const grass = new THREE.Color(0x557542);
  const high = new THREE.Color(0x64704b);
  const rock = new THREE.Color(0x777461);
  const color = new THREE.Color();
  const material = createTerrainMaterial();
  const chunks = [];

  const chunkCoordinates = [];
  for (let cz = 0; cz < chunksPerAxis; cz++) {
    for (let cx = 0; cx < chunksPerAxis; cx++) chunkCoordinates.push({ cx, cz });
  }
  chunkCoordinates.sort((a, b) => {
    const ax = -GRASS_RADIUS + (a.cx + 0.5) * chunkSize;
    const az = -GRASS_RADIUS + (a.cz + 0.5) * chunkSize;
    const bx = -GRASS_RADIUS + (b.cx + 0.5) * chunkSize;
    const bz = -GRASS_RADIUS + (b.cz + 0.5) * chunkSize;
    return Math.hypot(ax + 1600, az - 900) - Math.hypot(bx + 1600, bz - 900);
  });
  for (const { cx, cz } of chunkCoordinates) {
    const originX = -GRASS_RADIUS + cx * chunkSize;
    const originZ = -GRASS_RADIUS + cz * chunkSize;
    streamer.enqueue(originX + chunkSize * 0.5, originZ + chunkSize * 0.5, 'terrain', () => {
      // One-cell halo around every chunk. It participates in normal
      // calculation but its triangles are not rendered, so adjacent chunks
      // share the same smooth edge normals and do not form visible seams.
      const side = cellsPerChunk + 3;
      const positions = new Float32Array(side * side * 3);
      const colors = new Float32Array(side * side * 3);
      const uvs = new Float32Array(side * side * 2);
      const normalIndices = [];
      const indices = [];

      for (let iz = 0; iz < side; iz++) {
        const z = originZ + (iz - 1) * step;
        for (let ix = 0; ix < side; ix++) {
          const x = originX + (ix - 1) * step;
          const index = (iz * side + ix) * 3;
          const radius = Math.hypot(x, z);
          const h = heightAt(x, z) ?? 0;

          // Terrain continues underneath the plaza rim. The plaza tile sits
          // above it, eliminating the exposed triangular gap at its perimeter.
          const underPlaza = 1 - smoothstep(PLAZA_RADIUS - 8, PLAZA_RADIUS + 26, radius);
          positions[index] = x;
          positions[index + 1] = h - 0.62 * underPlaza;
          positions[index + 2] = z;
          const uvIndex = (iz * side + ix) * 2;
          uvs[uvIndex] = x / 16;
          uvs[uvIndex + 1] = z / 16;

          const variation = valueNoise(x / 115, z / 115, 61);
          color.copy(grass).lerp(low, (1 - variation) * 0.32);
          color.lerp(high, smoothstep(35, 90, h) * 0.62);
          color.lerp(rock, smoothstep(0.12, 0.42, Math.abs(h) / 225) * smoothstep(75, 145, h) * 0.58);
          const tint = 0.92 + variation * 0.16;
          colors[index] = color.r * tint;
          colors[index + 1] = color.g * tint;
          colors[index + 2] = color.b * tint;
        }
      }

      for (let iz = 0; iz < cellsPerChunk + 2; iz++) {
        const z = originZ + (iz - 0.5) * step;
        const nearestZ = THREE.MathUtils.clamp(0, z - step * 0.5, z + step * 0.5);
        for (let ix = 0; ix < cellsPerChunk + 2; ix++) {
          const x = originX + (ix - 0.5) * step;
          const nearestX = THREE.MathUtils.clamp(0, x - step * 0.5, x + step * 0.5);
          const nearestRadius = Math.hypot(nearestX, nearestZ);
          if (nearestRadius < POOL_RADIUS + 0.8 || nearestRadius > GRASS_RADIUS) continue;

          const a = iz * side + ix;
          const b = a + 1;
          const c = a + side;
          const d = c + 1;
          normalIndices.push(a, c, b, b, c, d);
          if (ix >= 1 && ix <= cellsPerChunk && iz >= 1 && iz <= cellsPerChunk) {
            indices.push(a, c, b, b, c, d);
          }
        }
      }

      if (!indices.length) return;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(normalIndices);
      geometry.computeVertexNormals();
      // Keep halo triangles out of the draw call while retaining their normals.
      geometry.setIndex(indices);

      const terrain = new THREE.Mesh(geometry, material);
      terrain.receiveShadow = true;
      terrain.castShadow = false;
      terrain.userData.noCollider = true;
      terrain.name = `terrain-chunk-${cx}-${cz}`;
      registerChunkMesh(terrain, renderables, 6200);
      scene.add(terrain);
      chunks.push(terrain);
    });
  }
  return chunks;
}

function makeRibbon(points, halfWidth, y, heightAt = null, tangentPoints = points, indexOffset = 0) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const globalIndex = i + indexOffset;
    const prev = tangentPoints[Math.max(0, globalIndex - 1)];
    const next = tangentPoints[Math.min(tangentPoints.length - 1, globalIndex + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    const p = points[i];
    const width = typeof halfWidth === 'function' ? halfWidth(p) : halfWidth;
    const level = typeof y === 'function' ? y(p) : y;
    const leftX = p.x + nx * width, leftZ = p.z + nz * width;
    const rightX = p.x - nx * width, rightZ = p.z - nz * width;
    positions.push(
      leftX, heightAt ? (heightAt(leftX, leftZ) ?? level) : level, leftZ,
      rightX, heightAt ? (heightAt(rightX, rightZ) ?? level) : level, rightZ
    );
    if (i < points.length - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}


function addShorelineChunks(scene, points, halfWidthAt, surfaceAt, sampledTerrainAt, analyticTerrainAt, name, streamer = null) {
  const rows = [-0.9, 0, 1.5, 4, 7.5, 12, 18, 26];
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.98,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const wetSand = new THREE.Color(0x716650);
  const sand = new THREE.Color(0xa88f65);
  const drySand = new THREE.Color(0x94845f);
  const grassEdge = new THREE.Color(0x65764d);
  const color = new THREE.Color();
  const normal = new THREE.Vector3();
  const meshes = [];
  const pointsPerChunk = 24;

  for (let start = 0, part = 0; start < points.length - 1; start += pointsPerChunk, part++) {
    const end = Math.min(points.length - 1, start + pointsPerChunk);
    const anchor = points[Math.floor((start + end) * 0.5)];
    const buildPart = () => {
    const count = end - start + 1;
    const positions = [];
    const colors = [];
    const indices = [];

    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const side = sideIndex === 0 ? -1 : 1;
      const sideOffset = sideIndex * count * rows.length;
      for (let i = 0; i < count; i++) {
        const globalIndex = start + i;
        const previous = points[Math.max(0, globalIndex - 1)];
        const next = points[Math.min(points.length - 1, globalIndex + 1)];
        const tangentX = next.x - previous.x;
        const tangentZ = next.z - previous.z;
        const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
        normal.set(-tangentZ / tangentLength, 0, tangentX / tangentLength);
        const point = points[globalIndex];
        const waterHalfWidth = halfWidthAt(point);
        const surfaceY = surfaceAt(point);
        const shorelineNoise = (valueNoise(point.x / 54, point.z / 54, 117 + side * 9) - 0.5) * 1.1;

        for (let row = 0; row < rows.length; row++) {
          const offset = rows[row] + (row > 1 ? shorelineNoise * (row / (rows.length - 1)) : 0);
          const lateral = waterHalfWidth + offset;
          const x = point.x + normal.x * lateral * side;
          const z = point.z + normal.z * lateral * side;
          const sampledY = sampledTerrainAt(x, z);
          const analyticY = analyticTerrainAt(x, z);
          let y;

          if (offset <= 0) {
            // The first strip tucks just beneath the water surface, hiding tiny gaps.
            y = surfaceY - 0.12 + (offset + 0.9) * 0.11;
          } else {
            // Follow the smooth height function near the water, then merge into
            // the exact triangles used by the visible terrain mesh.
            const smoothGround = (analyticY ?? sampledY ?? surfaceY + 1.4) + 0.025;
            const renderedGround = (sampledY ?? analyticY ?? surfaceY + 1.4) + 0.025;
            const merge = smoothstep(17, 26, offset);
            y = Math.max(surfaceY + 0.018, THREE.MathUtils.lerp(smoothGround, renderedGround, merge));
          }

          positions.push(x, y, z);

          const progress = THREE.MathUtils.clamp((offset + 0.9) / 26.9, 0, 1);
          if (progress < 0.30) color.copy(wetSand).lerp(sand, progress / 0.30);
          else if (progress < 0.76) color.copy(sand).lerp(drySand, (progress - 0.30) / 0.46);
          else color.copy(drySand).lerp(grassEdge, (progress - 0.76) / 0.24);
          const grain = 0.94 + valueNoise(x / 13, z / 13, 129) * 0.12;
          colors.push(color.r * grain, color.g * grain, color.b * grain);
        }
      }

      for (let i = 0; i < count - 1; i++) {
        for (let row = 0; row < rows.length - 1; row++) {
          const a = sideOffset + i * rows.length + row;
          const b = a + 1;
          const c = sideOffset + (i + 1) * rows.length + row;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const bank = new THREE.Mesh(geometry, material);
    bank.name = name + "-" + part;
    bank.renderOrder = 1;
    bank.receiveShadow = true;
    bank.castShadow = false;
    bank.frustumCulled = true;
    bank.userData.noCollider = true;
    bank.geometry.computeBoundingSphere();
    scene.add(bank);
    meshes.push(bank);
    };
    if (streamer) streamer.enqueue(anchor.x, anchor.z, 'river', buildPart);
    else buildPart();
  }

  return meshes;
}

function pointInReservedArea(x, z, routePoints) {
  if (Math.hypot(x, z) < 245) return true;
  if (Math.hypot(x + 1600, z - 900) < 62) return true;
  if (distanceToPolyline(x, z, routePoints) < 22) return true;
  if (Math.abs(x - mainRiverX(z)) < 70) return true;
  if (Math.abs(z - tributaryZ(x)) < 52) return true;
  return false;
}

function createChunkRandom(cx, cz, salt = 1) {
  const seed = (
    Math.imul(cx | 0, 73856093) ^
    Math.imul(cz | 0, 19349663) ^
    Math.imul(salt | 0, 83492791)
  ) >>> 0;
  return seededRandom(seed || 1);
}

function createForests(scene, heightAt, routePoints, rnd, renderables) {
  const trees = [];
  const treeById = new Map();
  const depletedIds = new Set();
  const chunkSize = 640;
  const cell = 16;
  const half = GRASS_RADIUS - 80;
  const collisionCellSize = 16;
  const collisionGrid = new Map();
  const chunks = new Map();
  const generated = new Set();
  const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.48, 8, 7);
  const crownGeometries = [
    new THREE.IcosahedronGeometry(5.3, 0),
    new THREE.DodecahedronGeometry(5.0, 0),
    new THREE.SphereGeometry(4.8, 8, 6),
    new THREE.OctahedronGeometry(5.0, 0),
    new THREE.TetrahedronGeometry(5.2, 0),
    new THREE.ConeGeometry(4.9, 10.8, 7, 1),
    new THREE.ConeGeometry(5.4, 12.2, 6, 2),
    new THREE.ConeGeometry(4.4, 13.6, 9, 2),
  ];
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x59432f, roughness: 1 });
  const crownMaterials = Array.from({ length: 8 }, () =>
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, flatShading: true })
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function addTreeToCollision(tree) {
    tree.radius = 0.48 * tree.scale;
    tree.seed = tree.rotation;
    tree.minY = tree.y;
    tree.maxY = tree.y + 8 * tree.scale;
    tree.removed = depletedIds.has(tree.id);
    const cx = Math.floor(tree.x / collisionCellSize);
    const cz = Math.floor(tree.z / collisionCellSize);
    const key = `${cx},${cz}`;
    let bucket = collisionGrid.get(key);
    if (!bucket) { bucket = []; collisionGrid.set(key, bucket); }
    bucket.push(tree);
    treeById.set(tree.id, tree);
    trees.push(tree);
  }

  function generateChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (generated.has(key)) return false;
    generated.add(key);
    const random = createChunkRandom(cx, cz, 71);
    const left = cx * chunkSize;
    const top = cz * chunkSize;
    const minIX = Math.max(0, Math.ceil((left + half) / cell));
    const maxIX = Math.min(Math.floor((2 * half) / cell), Math.ceil((left + chunkSize + half) / cell) - 1);
    const minIZ = Math.max(0, Math.ceil((top + half) / cell));
    const maxIZ = Math.min(Math.floor((2 * half) / cell), Math.ceil((top + chunkSize + half) / cell) - 1);
    const bucket = { trees: [], variants: [[], [], [], [], [], [], [], []], interactiveMeshes: [] };

    for (let ix = minIX; ix <= maxIX; ix++) {
      const x0 = -half + ix * cell;
      for (let iz = minIZ; iz <= maxIZ; iz++) {
        const z0 = -half + iz * cell;
        const x = x0 + (random() - 0.5) * cell * 0.82;
        const z = z0 + (random() - 0.5) * cell * 0.82;
        if (Math.hypot(x, z) > half || pointInReservedArea(x, z, routePoints)) continue;
        const forestMask =
          valueNoise(x / 1250, z / 1250, 71) * 0.62 +
          valueNoise(x / 2650, z / 2650, 73) * 0.38;
        if (forestMask < 0.30 || random() > 0.44) continue;
        const pine = random() < 0.34;
        const tree = {
          // Stable spatial ID, independent of which chunk loads first.
          id: 1000000000 + ix * 1000 + iz,
          x, z, y: heightAt(x, z) ?? 0,
          scale: 0.78 + random() * 0.88,
          rotation: random() * TAU,
          hue: random(),
          pine,
          variant: pine ? Math.floor(random() * 3) : Math.floor(random() * 5),
        };
        bucket.trees.push(tree);
        bucket.variants[(pine ? 5 : 0) + tree.variant].push(tree);
        addTreeToCollision(tree);
      }
    }

    if (!bucket.trees.length) {
      chunks.set(key, bucket);
      return true;
    }

    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, bucket.trees.length);
    trunks.userData.noCollider = true;
    trunks.userData.treeInstances = bucket.trees;
    for (let i = 0; i < bucket.trees.length; i++) {
      const tree = bucket.trees[i];
      quaternion.setFromAxisAngle(up, tree.rotation);
      position.set(tree.x, tree.y + 4 * tree.scale, tree.z);
      scale.set(tree.scale, tree.scale, tree.scale);
      if (tree.removed) matrix.makeScale(0, 0, 0);
      else matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(i, matrix);
      tree.trunkMesh = trunks;
      tree.trunkInstanceId = i;
    }
    trunks.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    trunks.name = `forest-trunks-${key}`;
    registerChunkMesh(trunks, renderables, 2800, true);
    scene.add(trunks);
    bucket.interactiveMeshes.push(trunks);

    for (let variant = 0; variant < bucket.variants.length; variant++) {
      const group = bucket.variants[variant];
      if (!group.length) continue;
      const crowns = new THREE.InstancedMesh(crownGeometries[variant], crownMaterials[variant], group.length);
      for (let i = 0; i < group.length; i++) {
        const tree = group[i];
        quaternion.setFromAxisAngle(up, tree.rotation);
        const isPine = tree.pine;
        const pineVariant = tree.variant;
        const crownY = isPine ? [9.4, 10.0, 10.6][pineVariant] : [8.0, 8.1, 7.8, 8.2, 8.0][pineVariant];
        position.set(tree.x, tree.y + crownY * tree.scale, tree.z);
        const width = isPine ? [1.16, 1.12, 1.04][pineVariant] : [1.25, 1.22, 1.34, 1.12, 1.28][pineVariant];
        const height = isPine ? [1.08, 1.16, 1.24][pineVariant] : [1.12, 1.05, 0.82, 1.12, 1.18][pineVariant];
        scale.set(tree.scale * width, tree.scale * height, tree.scale * width);
        if (tree.removed) matrix.makeScale(0, 0, 0);
        else matrix.compose(position, quaternion, scale);
        crowns.setMatrixAt(i, matrix);
        const baseHue = isPine ? 0.315 : 0.295;
        const hueRange = isPine ? 0.022 : 0.035;
        crowns.setColorAt(i, new THREE.Color().setHSL(
          baseHue + tree.hue * hueRange,
          isPine ? 0.58 + tree.hue * 0.12 : 0.54 + tree.hue * 0.12,
          (isPine ? 0.14 : 0.17) + tree.hue * (isPine ? 0.055 : 0.065)
        ));
        tree.crownMesh = crowns;
        tree.crownInstanceId = i;
      }
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      crowns.userData.noCollider = true;
      crowns.castShadow = true;
      crowns.receiveShadow = true;
      crowns.name = `forest-crowns-${key}-${variant}`;
      crowns.userData.treeInstances = group;
      registerChunkMesh(crowns, renderables, 2800, true);
      scene.add(crowns);
      bucket.interactiveMeshes.push(crowns);
    }

    chunks.set(key, bucket);
    return true;
  }

  function forestCollision(x, z, feetY, height, radius, resolve = false) {
    let px = x, pz = z, changed = false;
    const iterations = resolve ? 4 : 1;
    for (let iteration = 0; iteration < iterations; iteration++) {
      let pushed = false;
      const minCellX = Math.floor((px - radius - 1) / collisionCellSize);
      const maxCellX = Math.floor((px + radius + 1) / collisionCellSize);
      const minCellZ = Math.floor((pz - radius - 1) / collisionCellSize);
      const maxCellZ = Math.floor((pz + radius + 1) / collisionCellSize);
      for (let gx = minCellX; gx <= maxCellX; gx++) {
        for (let gz = minCellZ; gz <= maxCellZ; gz++) {
          const bucket = collisionGrid.get(`${gx},${gz}`);
          if (!bucket) continue;
          for (const tree of bucket) {
            if (tree.removed || feetY + height <= tree.minY + 0.035 || feetY >= tree.maxY) continue;
            let dx = px - tree.x, dz = pz - tree.z;
            let distance = Math.hypot(dx, dz);
            const combinedRadius = radius + tree.radius;
            if (distance >= combinedRadius) continue;
            if (distance < 0.0001) {
              dx = Math.cos(tree.seed); dz = Math.sin(tree.seed); distance = 1;
            }
            if (!resolve) return { blocked: true, x: px, z: pz, changed };
            const penetration = combinedRadius - distance + 0.015;
            px += (dx / distance) * penetration;
            pz += (dz / distance) * penetration;
            pushed = changed = true;
          }
        }
      }
      if (!pushed) break;
    }
    return { blocked: changed, x: px, z: pz, changed };
  }

  function removeTree(tree) {
    if (!tree) return false;
    depletedIds.add(tree.id);
    if (tree.removed) return true;
    tree.removed = true;
    const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
    tree.trunkMesh?.setMatrixAt(tree.trunkInstanceId, zeroScale);
    tree.crownMesh?.setMatrixAt(tree.crownInstanceId, zeroScale);
    if (tree.trunkMesh) tree.trunkMesh.instanceMatrix.needsUpdate = true;
    if (tree.crownMesh) tree.crownMesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  function isNearTree(x, z, clearance = 8) {
    const minCellX = Math.floor((x - clearance) / collisionCellSize);
    const maxCellX = Math.floor((x + clearance) / collisionCellSize);
    const minCellZ = Math.floor((z - clearance) / collisionCellSize);
    const maxCellZ = Math.floor((z + clearance) / collisionCellSize);
    for (let gx = minCellX; gx <= maxCellX; gx++) {
      for (let gz = minCellZ; gz <= maxCellZ; gz++) {
        const bucket = collisionGrid.get(`${gx},${gz}`);
        if (!bucket) continue;
        for (const tree of bucket) {
          if (!tree.removed && Math.hypot(x - tree.x, z - tree.z) < clearance + tree.radius) return true;
        }
      }
    }
    return false;
  }

  function getInteractiveMeshes(x, z) {
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = chunks.get(`${cx + dx},${cz + dz}`);
        if (bucket) nearby.push(...bucket.interactiveMeshes);
      }
    }
    return nearby;
  }

  function updateNear(x, z, maxBuilds = 1) {
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const gx = cx + dx, gz = cz + dz;
        const centerX = (gx + 0.5) * chunkSize;
        const centerZ = (gz + 0.5) * chunkSize;
        if (Math.hypot(centerX - x, centerZ - z) > 1320) continue;
        if (!generated.has(`${gx},${gz}`)) candidates.push({ x: centerX, z: centerZ, gx, gz });
      }
    }
    candidates.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (let i = 0; i < Math.min(maxBuilds, candidates.length); i++) {
      generateChunk(candidates[i].gx, candidates[i].gz);
    }
    return { pending: candidates.length - Math.min(maxBuilds, candidates.length), generated: generated.size };
  }

  updateNear(-1600, 900, 1);
  return {
    get count() { return trees.length; },
    get chunks() { return generated.size; },
    meshes: [],
    getInteractiveMeshes,
    trees,
    updateNear,
    remove: removeTree,
    removeById(id) {
      const tree = treeById.get(id);
      if (tree) return removeTree(tree);
      depletedIds.add(id);
      return true;
    },
    get depletedIds() { return Array.from(depletedIds); },
    isNearTree,
    isBlocked(x, feetY, z, radius, height) {
      return forestCollision(x, z, feetY, height, radius, false).blocked;
    },
    resolve(x, z, feetY, radius, height) {
      return forestCollision(x, z, feetY, height, radius, true);
    },
  };
}


function createGroundCover(scene, heightAt, routePoints, rnd, renderables) {
  const chunkSize = 640;
  const generated = new Set();
  const meshes = [];
  const grassGeometry = new THREE.ConeGeometry(0.32, 1.65, 3, 1);
  const shrubGeometry = new THREE.DodecahedronGeometry(1, 0);
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x557b3d, roughness: 1, flatShading: true });
  const shrubMaterial = new THREE.MeshStandardMaterial({ color: 0x426b38, roughness: 1, flatShading: true });
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function generateChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (generated.has(key)) return false;
    generated.add(key);
    const random = createChunkRandom(cx, cz, 83);
    const grass = [];
    const shrubs = [];
    const left = cx * chunkSize, top = cz * chunkSize;
    let tries = 0;
    while (grass.length < 32 && tries++ < 150) {
      const x = left + random() * chunkSize;
      const z = top + random() * chunkSize;
      if (Math.hypot(x, z) < 250 || Math.hypot(x, z) > GRASS_RADIUS - 330) continue;
      if (pointInReservedArea(x, z, routePoints) || random() < 0.12) continue;
      if (valueNoise(x / 185, z / 185, 83) < 0.37) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      grass.push({ x, z, y, size: 0.48 + random() * 0.82, angle: random() * TAU, hue: random() });
    }

    tries = 0;
    while (shrubs.length < 11 && tries++ < 80) {
      const x = left + random() * chunkSize;
      const z = top + random() * chunkSize;
      if (Math.hypot(x, z) < 265 || Math.hypot(x, z) > GRASS_RADIUS - 350) continue;
      if (pointInReservedArea(x, z, routePoints) || random() < 0.34) continue;
      const forestMask = valueNoise(x / 1250, z / 1250, 71) * 0.62 +
        valueNoise(x / 2650, z / 2650, 73) * 0.38;
      if (forestMask > 0.56) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      shrubs.push({
        x, z, y, sx: 0.8 + random() * 1.2, sy: 0.45 + random() * 0.8,
        sz: 0.8 + random() * 1.2, angle: random() * TAU, hue: random(),
      });
    }

    if (grass.length) {
      const mesh = new THREE.InstancedMesh(grassGeometry, grassMaterial, grass.length);
      for (let i = 0; i < grass.length; i++) {
        const item = grass[i];
        quaternion.setFromAxisAngle(up, item.angle);
        position.set(item.x, item.y + item.size * 0.58, item.z);
        scale.set(item.size * 0.78, item.size, item.size * 0.78);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, new THREE.Color().setHSL(
          0.24 + item.hue * 0.08, 0.34 + item.hue * 0.22, 0.20 + item.hue * 0.12
        ));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.noCollider = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = `wild-grass-${key}`;
      registerChunkMesh(mesh, renderables, 1700, true);
      scene.add(mesh);
      meshes.push(mesh);
    }

    if (shrubs.length) {
      const mesh = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubs.length);
      for (let i = 0; i < shrubs.length; i++) {
        const item = shrubs[i];
        quaternion.setFromAxisAngle(up, item.angle);
        position.set(item.x, item.y + item.sy * 0.72, item.z);
        scale.set(item.sx, item.sy, item.sz);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, new THREE.Color().setHSL(
          0.25 + item.hue * 0.07, 0.30 + item.hue * 0.2, 0.17 + item.hue * 0.12
        ));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.noCollider = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `wild-shrubs-${key}`;
      registerChunkMesh(mesh, renderables, 2200, true);
      scene.add(mesh);
      meshes.push(mesh);
    }
    return true;
  }

  function updateNear(x, z, maxBuilds = 1) {
    const cx = Math.floor(x / chunkSize), cz = Math.floor(z / chunkSize);
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const gx = cx + dx, gz = cz + dz;
      const centerX = (gx + 0.5) * chunkSize, centerZ = (gz + 0.5) * chunkSize;
      if (Math.hypot(centerX - x, centerZ - z) <= 1120 && !generated.has(`${gx},${gz}`)) {
        candidates.push({ gx, gz, d: Math.hypot(centerX - x, centerZ - z) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(maxBuilds, candidates.length); i++) generateChunk(candidates[i].gx, candidates[i].gz);
    return { pending: candidates.length - Math.min(maxBuilds, candidates.length), generated: generated.size };
  }

  updateNear(-1600, 900, 1);
  return { get grass() { return generated.size * 32; }, get shrubs() { return generated.size * 11; }, get chunks() { return generated.size; }, meshes, updateNear };
}


function createRocks(scene, heightAt, routePoints, rnd, renderables) {
  const chunkSize = 640;
  const generated = new Set();
  const meshes = [];
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const largeMaterial = new THREE.MeshStandardMaterial({ color: 0x777568, roughness: 1, flatShading: true });
  const smallMaterial = new THREE.MeshStandardMaterial({ color: 0x827d6b, roughness: 1, flatShading: true });
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function generateChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (generated.has(key)) return false;
    generated.add(key);
    const random = createChunkRandom(cx, cz, 109);
    const left = cx * chunkSize, top = cz * chunkSize;
    const large = [];
    const small = [];

    let tries = 0;
    while (large.length < 3 && tries++ < 50) {
      const x = left + random() * chunkSize, z = top + random() * chunkSize;
      if (Math.hypot(x, z) < 270 || Math.hypot(x, z) > GRASS_RADIUS - 470) continue;
      if (pointInReservedArea(x, z, routePoints) || random() < 0.28) continue;
      large.push({
        x, z, y: heightAt(x, z) ?? 0,
        sx: 1.8 + random() * 4.4, sy: 1.15 + random() * 3.4,
        sz: 1.8 + random() * 4.4, angle: random() * TAU,
      });
    }

    tries = 0;
    while (small.length < 13 && tries++ < 36) {
      const x = left + random() * chunkSize, z = top + random() * chunkSize;
      if (Math.hypot(x, z) < 255 || Math.hypot(x, z) > GRASS_RADIUS - 330) continue;
      if (pointInReservedArea(x, z, routePoints)) continue;
      small.push({
        x, z, y: heightAt(x, z) ?? 0,
        sx: 0.6 + random() * 1.4, sy: 0.35 + random() * 0.85,
        sz: 0.6 + random() * 1.4, angle: random() * TAU,
      });
    }

    if (large.length) {
      const mesh = new THREE.InstancedMesh(geometry, largeMaterial, large.length);
      for (let i = 0; i < large.length; i++) {
        const rock = large[i];
        quaternion.setFromAxisAngle(up, rock.angle);
        position.set(rock.x, rock.y + rock.sy * 0.48, rock.z);
        scale.set(rock.sx, rock.sy, rock.sz);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `boulders-${key}`;
      registerChunkMesh(mesh, renderables, 2500, true);
      scene.add(mesh);
      meshes.push(mesh);
    }

    if (small.length) {
      const mesh = new THREE.InstancedMesh(geometry, smallMaterial, small.length);
      for (let i = 0; i < small.length; i++) {
        const rock = small[i];
        quaternion.setFromAxisAngle(up, rock.angle);
        position.set(rock.x, rock.y + rock.sy * 0.38, rock.z);
        scale.set(rock.sx, rock.sy, rock.sz);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.noCollider = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = `stones-${key}`;
      registerChunkMesh(mesh, renderables, 1500, true);
      scene.add(mesh);
      meshes.push(mesh);
    }
    return true;
  }

  function updateNear(x, z, maxBuilds = 1) {
    const cx = Math.floor(x / chunkSize), cz = Math.floor(z / chunkSize);
    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const gx = cx + dx, gz = cz + dz;
      const centerX = (gx + 0.5) * chunkSize, centerZ = (gz + 0.5) * chunkSize;
      if (Math.hypot(centerX - x, centerZ - z) <= 1160 && !generated.has(`${gx},${gz}`)) {
        candidates.push({ gx, gz, d: Math.hypot(centerX - x, centerZ - z) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(maxBuilds, candidates.length); i++) generateChunk(candidates[i].gx, candidates[i].gz);
    return { pending: candidates.length - Math.min(maxBuilds, candidates.length), generated: generated.size };
  }

  updateNear(-1600, 900, 1);
  return {
    get boulders() { return generated.size * 3; },
    get stones() { return generated.size * 13; },
    get chunks() { return generated.size; },
    meshes,
    updateNear,
  };
}


function createHouse(scene, materials, baseY = 0) {
  const house = new THREE.Group();
  house.position.set(-1600, baseY, 900);
  scene.add(house);

  const wall = materials.wall;
  const trim = materials.trim;
  const wood = materials.wood;
  const glass = materials.glass;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(17, 0.35, 13), materials.floor);
  floor.position.set(0, 0.1, 0);
  floor.receiveShadow = true;
  floor.userData.walkable = true;
  house.add(floor);

  const wallHeight = 4.25;
  const wallY = 0.35 + wallHeight * 0.5;
  const sideWall = (x, z, sx, sz) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, wallHeight, sz), wall);
    mesh.position.set(x, wallY, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    house.add(mesh);
  };

  sideWall(0, -6.25, 17, 0.5);
  sideWall(-8.25, 0, 0.5, 13);
  sideWall(8.25, -4.45, 0.5, 4.4);
  sideWall(8.25, 4.45, 0.5, 4.4);

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 3.9), trim);
  lintel.position.set(8.25, 4.0, 0);
  lintel.castShadow = true;
  house.add(lintel);

  for (const z of [-1.75, 1.75]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.72, 4.1, 0.42), trim);
    post.position.set(8.27, 2.35, z);
    post.castShadow = true;
    house.add(post);
  }

  const roofShape = new THREE.Shape();
  roofShape.moveTo(-9.1, 4.45);
  roofShape.lineTo(0, 7.25);
  roofShape.lineTo(9.1, 4.45);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 13.8, bevelEnabled: false, steps: 1,
  });
  roofGeo.translate(0, 0, -6.9);
  const roof = new THREE.Mesh(roofGeo, materials.roof);
  roof.castShadow = true;
  roof.receiveShadow = true;
  house.add(roof);

  for (const z of [-3.8, 3.8]) {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.9), glass);
    pane.position.set(8.27, 2.65, z);
    house.add(pane);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 2.2), trim);
    frame.position.set(8.2, 2.65, z);
    frame.castShadow = true;
    house.add(frame);
  }

  const bed = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.55, 2.6), wood);
  bed.position.set(-4.1, 0.55, -3.0);
  bed.castShadow = true;
  house.add(bed);

  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.18, 1.5), wood);
  tableTop.position.set(-2.7, 1.15, 2.8);
  tableTop.castShadow = true;
  house.add(tableTop);
  for (const x of [-3.55, -1.85]) {
    for (const z of [2.25, 3.35]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 0.15), wood);
      leg.position.set(x, 0.62, z);
      house.add(leg);
    }
  }

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.0, 1.2), trim);
  chimney.position.set(-5.3, 5.1, -2.8);
  chimney.castShadow = true;
  house.add(chimney);

  const lamp = new THREE.PointLight(0xffc77e, 3.5, 22, 2);
  lamp.position.set(0, 3.45, 0);
  house.add(lamp);

  const porch = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.25, 7.2), materials.path);
  porch.position.set(10.7, 0.12, 0);
  porch.receiveShadow = true;
  porch.userData.walkable = true;
  house.add(porch);

  return {
    house,
    spawn: {
      x: -1600,
      y: baseY + 0.30,
      z: 903.8,
      lookAt: { x: 0, y: 24, z: 0 },
    },
  };
}

function addRibbonChunks(scene, points, halfWidth, y, material, name, options = {}, streamer = null) {
  const meshes = [];
  const pointsPerChunk = 24;
  for (let start = 0, part = 0; start < points.length - 1; start += pointsPerChunk, part++) {
    const end = Math.min(points.length - 1, start + pointsPerChunk);
    const anchor = points[Math.floor((start + end) * 0.5)];
    const buildPart = () => {
      const mesh = new THREE.Mesh(
        makeRibbon(points.slice(start, end + 1), halfWidth, y, options.heightAt ?? null, points, start), material
      );
      mesh.name = `${name}-${part}`;
      mesh.frustumCulled = true;
      mesh.geometry.computeBoundingSphere();
      mesh.userData.noCollider = true;
      if (options.walkable) mesh.userData.walkable = true;
      if (options.receiveShadow) mesh.receiveShadow = true;
      if (options.renderOrder !== undefined) mesh.renderOrder = options.renderOrder;
      scene.add(mesh);
      meshes.push(mesh);
    };
    if (streamer) streamer.enqueue(anchor.x, anchor.z, 'river', buildPart);
    else buildPart();
  }
  return meshes;
}

function createRiver(scene, rnd, heightAt, analyticHeightAt, riverProfiles, streamer) {
  const centerX = mainRiverX;
  const points = [];
  for (let i = 0; i <= 1800; i++) {
    const z = -4500 + (9000 * i) / 1800;
    points.push({ x: centerX(z), z });
  }

  // Water alone widens by 20%. The terrain cross-section and shoreline
  // elevation keep their original width.
  const mainWidthAt = (point) => mainRiverHalfWidth(point.z) * RIVER_WATER_WIDTH_SCALE;
  const mainLevelAt = (point) => riverProfiles.mainSurface(point.z);
  const waterMaterial = createFlowingWaterMaterial(0x286d7d);
  const water = addRibbonChunks(scene, points, mainWidthAt, mainLevelAt, waterMaterial,
    'main-river-water', { noCollider: true, renderOrder: 2 }, streamer);
  const banks = addShorelineChunks(
    scene, points, mainWidthAt, mainLevelAt, heightAt, analyticHeightAt, 'main-river-bank', streamer
  );

  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7659, roughness: 1 });
  const riverBedHeight = (x, z) => (heightAt(x, z) ?? (riverProfiles.mainSurface(z) - riverProfiles.mainDepth(z))) + 0.045;
  const bed = addRibbonChunks(scene, points, 5.8, -3.25, bedMaterial,
    'main-river-bed', { walkable: true, receiveShadow: true, heightAt: riverBedHeight }, streamer);

  const pebbleGeo = new THREE.IcosahedronGeometry(2.2, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x756c56, roughness: 1 });
  const pebbleBuckets = new Map();
  for (let i = 0; i < 340; i++) {
    const z = -4400 + rnd() * 8800;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = centerX(z) + side * (14 + rnd() * 5);
    const key = `${Math.floor(x / 640)},${Math.floor(z / 640)}`;
    let bucket = pebbleBuckets.get(key);
    if (!bucket) { bucket = []; pebbleBuckets.set(key, bucket); }
    bucket.push({ x, z, y: heightAt(x, z) ?? 0, scale: 0.55 + rnd() * 0.85, angle: rnd() * TAU });
  }

  const pebbleMeshes = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const [key, data] of pebbleBuckets) {
    const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, data.length);
    pebbles.userData.noCollider = true;
    pebbles.name = `river-pebbles-${key}`;
    pebbles.castShadow = false;
    for (let i = 0; i < data.length; i++) {
      const pebble = data[i];
      p.set(pebble.x, pebble.y + pebble.scale * 0.34, pebble.z);
      scale.set(pebble.scale, 0.35 + pebble.scale * 0.5, pebble.scale);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pebble.angle);
      m.compose(p, q, scale);
      pebbles.setMatrixAt(i, m);
    }
    pebbles.instanceMatrix.needsUpdate = true;
    pebbles.computeBoundingSphere();
    pebbles.frustumCulled = true;
    scene.add(pebbles);
    pebbleMeshes.push(pebbles);
  }

  return {
    water, banks, bed, waterMaterial, centerX, halfWidth: 14.2,
    region: {
      id: 'river',
      surfaceY: riverProfiles.mainSurface(300),
      surfaceAt: (x, z) => riverProfiles.mainSurface(mainRiverStation(x, z).station),
      bottomY: riverProfiles.mainSurface(300) - riverProfiles.mainDepth(300) + 0.08,
      bottomAt: (x, z) => {
        const station = mainRiverStation(x, z).station;
        return riverProfiles.mainSurface(station) - riverProfiles.mainDepth(station) + 0.08;
      },
      exitFeetY: riverProfiles.mainSurface(300) + 2.4 - 0.55,
      exitHeight: 0.95,
      contains: (x, z) => {
        const station = mainRiverStation(x, z);
        return station.distance <= mainRiverHalfWidth(station.station) * RIVER_WATER_WIDTH_SCALE + 0.1;
      },
    },
  };
}

function createTributary(scene, heightAt, analyticHeightAt, riverProfiles, streamer) {
  const centerZ = tributaryZ;
  const points = [];
  for (let i = 0; i <= 1120; i++) {
    const x = -2800 + (5600 * i) / 1120;
    points.push({ x, z: centerZ(x) });
  }

  const tributaryWidthAt = (point) => tributaryHalfWidth(point.x) * RIVER_WATER_WIDTH_SCALE;
  const tributaryLevelAt = (point) => riverProfiles.tributarySurface(point.x);
  const waterMaterial = createFlowingWaterMaterial(0x327987);
  const water = addRibbonChunks(scene, points, tributaryWidthAt, tributaryLevelAt, waterMaterial,
    'tributary-water', { noCollider: true, renderOrder: 2 }, streamer);
  const banks = addShorelineChunks(
    scene, points, tributaryWidthAt, tributaryLevelAt, heightAt, analyticHeightAt, 'tributary-bank', streamer
  );

  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x8e7b60, roughness: 1 });
  const tributaryBedHeight = (x, z) => (heightAt(x, z) ?? (riverProfiles.tributarySurface(x) - riverProfiles.tributaryDepth(x))) + 0.045;
  const bed = addRibbonChunks(scene, points, 4.4, -2.55, bedMaterial,
    'tributary-bed', { walkable: true, receiveShadow: true, heightAt: tributaryBedHeight }, streamer);

  return {
    water, banks, bed, waterMaterial,
    region: {
      id: 'south-river',
      surfaceY: riverProfiles.tributarySurface(0),
      surfaceAt: (x, z) => riverProfiles.tributarySurface(tributaryStation(x, z).station),
      bottomY: riverProfiles.tributarySurface(0) - riverProfiles.tributaryDepth(0) + 0.08,
      bottomAt: (x, z) => {
        const station = tributaryStation(x, z).station;
        return riverProfiles.tributarySurface(station) - riverProfiles.tributaryDepth(station) + 0.08;
      },
      exitFeetY: riverProfiles.tributarySurface(0) - 0.55,
      exitHeight: 0.95,
      contains: (x, z) => {
        const station = tributaryStation(x, z);
        return station.distance <= tributaryHalfWidth(station.station) * RIVER_WATER_WIDTH_SCALE + 0.1;
      },
    },
  };
}

export async function createWorld(scene, onProgress = () => {}) {
  const rnd = seededRandom();
  const routePoints = [
    { x: -1588, z: 900 },
    { x: -1320, z: 760 },
    { x: -1050, z: 545 },
    { x: -785, z: 300 },
    { x: -750, z: 300 },
    { x: -630, z: 300 },
    { x: -600, z: 300 },
    { x: -360, z: 205 },
    { x: 0, z: 190 },
  ];

  // Build the path curve once in XZ. The terrain flattening and visible road
  // use this same sampled centreline, eliminating curve-vs-polyline drift.
  const routeCurve = new THREE.CatmullRomCurve3(
    routePoints.map((point) => new THREE.Vector3(point.x, 0, point.z)),
    false, 'centripetal'
  );
  const routeGroundPoints = routeCurve.getPoints(120).map((point) => ({ x: point.x, z: point.z }));
  const baseHeightAt = createBaseTerrainHeightFunction(routeGroundPoints);
  const riverProfiles = createRiverProfiles(baseHeightAt);
  const BRIDGE_DECK_TOP_Y = riverProfiles.mainSurface(300) + 2.4;
  const BRIDGE_VERTICAL_OFFSET = BRIDGE_DECK_TOP_Y - 1.08;
  const analyticHeightAt = createHeightFunction(baseHeightAt, riverProfiles, BRIDGE_DECK_TOP_Y);
  const heightAt = createRenderedTerrainSampler(analyticHeightAt);
  const renderables = [];
  const streamer = createWorldChunkStreamer();
  let streamTick = 0;
  const terrain = createTerrain(scene, analyticHeightAt, renderables, streamer);

  // The road sits only 7cm above the sampled ground: no hovering strip and
  // no large artificial flattening mismatch at the inside of bends.
  const roadSurfaceY = (x, z) => {
    const groundY = (heightAt(x, z) ?? 0) + 0.07;
    const approachBlend = 1 - smoothstep(45, 150, Math.abs(x + 692));
    const pathCorridor = 1 - smoothstep(7, 14, Math.abs(z - 300));
    const rampY = THREE.MathUtils.lerp(groundY, BRIDGE_DECK_TOP_Y + 0.04, approachBlend);
    return THREE.MathUtils.lerp(groundY, rampY, pathCorridor);
  };

  const roadPoints = routeCurve.getPoints(480).map((point) => ({ x: point.x, z: point.z }));
  const road = addRibbonChunks(
    scene, roadPoints, 3.8, 0.065,
    new THREE.MeshStandardMaterial({ color: 0x8f8065, roughness: 1 }),
    'house-to-fountain-road',
    { walkable: true, receiveShadow: true, heightAt: roadSurfaceY }
  );

  const bridge = new THREE.Group();
  bridge.position.set(-692, BRIDGE_VERTICAL_OFFSET, 300);
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(90, 0.30, 10), new THREE.MeshStandardMaterial({
    color: 0x715239, roughness: 0.9,
  }));
  // Deck top is lowered together with the bridge group by three metres.
  bridgeDeck.position.y = 0.93;
  bridgeDeck.castShadow = true;
  bridgeDeck.receiveShadow = true;
  bridgeDeck.userData.walkable = true;
  bridge.add(bridgeDeck);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x503a2b, roughness: 0.95 });
  for (const z of [-4.8, 4.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(90, 0.8, 0.28), railMaterial);
    rail.position.set(0, 1.28, z);
    rail.castShadow = true;
    bridge.add(rail);
  }
  for (let x = -42; x <= 42; x += 10) {
    for (const z of [-4.6, 4.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 0.32), railMaterial);
      post.position.set(x, 1.55, z);
      post.castShadow = true;
      bridge.add(post);
    }
  }
  scene.add(bridge);

  const houseBase = heightAt(-1600, 900) ?? 0;
  const house = createHouse(scene, {
    wall: new THREE.MeshStandardMaterial({ color: 0xb9a17e, roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x634a34, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x805b3e, roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x8a7359, roughness: 0.96 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x56433a, roughness: 0.92 }),
    path: new THREE.MeshStandardMaterial({ color: 0x8a7659, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x87bfd0, emissive: 0x172d38, transparent: true, opacity: 0.42,
    }),
  }, houseBase);

  const river = createRiver(scene, rnd, heightAt, analyticHeightAt, riverProfiles, streamer);
  const tributary = createTributary(scene, heightAt, analyticHeightAt, riverProfiles, streamer);
  onProgress('Готовим только ближайшие участки...');
  const forests = createForests(scene, heightAt, routePoints, rnd, renderables);
  const groundCover = createGroundCover(scene, heightAt, routePoints, rnd, renderables);
  const rocks = createRocks(scene, heightAt, routePoints, rnd, renderables);
  const canSpawnResourceAt = (x, z, clearance = 9) => {
    if (Math.hypot(x, z) < 285 || Math.hypot(x + 1600, z - 900) < 92) return false;
    if (pointInReservedArea(x, z, routePoints)) return false;
    const main = mainRiverStation(x, z);
    if (main.distance < mainRiverHalfWidth(main.station) * RIVER_WATER_WIDTH_SCALE + clearance) return false;
    const side = tributaryStation(x, z);
    if (side.distance < tributaryHalfWidth(side.station) * RIVER_WATER_WIDTH_SCALE + clearance) return false;
    if (forests.isNearTree(x, z, clearance)) return false;
    return Number.isFinite(heightAt(x, z));
  };

  // Prebuild every terrain/river chunk inside the initial 1.48km bubble,
  // plus a 3x3 neighborhood of forest, ground cover and rocks. Nothing else
  // is generated until the player moves toward the edge of this bubble.
  await streamer.preloadNearby(-1600, 900, onProgress);
  forests.updateNear(-1600, 900, 13);
  groundCover.updateNear(-1600, 900, 13);
  rocks.updateNear(-1600, 900, 13);
  onProgress('Ближайшая область готова.');

  return {
    house: house.house,
    spawn: house.spawn,
    river,
    tributary,
    forests,
    groundCover,
    isForestBlocked: forests.isBlocked,
    resolveForestPosition: forests.resolve,
    rocks,
    terrain,
    renderables,
    route: road,
    bridge,
    heightAt,
    canSpawnResourceAt,
    update(time, playerPosition = { x: -1600, z: 900 }) {
      river.waterMaterial.userData.setTime(time);
      tributary.waterMaterial.userData.setTime(time);
      streamTick++;
      if (streamTick % 4 === 0) streamer.update(playerPosition.x, playerPosition.z);
      else if (streamTick % 4 === 1) forests.updateNear(playerPosition.x, playerPosition.z, 1);
      else if (streamTick % 4 === 2) groundCover.updateNear(playerPosition.x, playerPosition.z, 1);
      else rocks.updateNear(playerPosition.x, playerPosition.z, 1);
      const terrainProgress = streamer.updateProgress(playerPosition.x, playerPosition.z);
      const forestProgress = forests.updateNear(playerPosition.x, playerPosition.z, 0);
      const coverProgress = groundCover.updateNear(playerPosition.x, playerPosition.z, 0);
      const rockProgress = rocks.updateNear(playerPosition.x, playerPosition.z, 0);
      return {
        pending: terrainProgress.pending + forestProgress.pending +
          coverProgress.pending + rockProgress.pending,
        percent: terrainProgress.percent,
      };
    },
    get streamingProgress() { return streamer.progress; },
    getWaterRegionAt(x, z) {
      return this.waterRegions.find((region) => region.contains(x, z)) || null;
    },
    waterRegions: [
      {
        id: 'fountain',
        surfaceY: WATER_Y,
        bottomY: POOL_BOTTOM_Y,
        exitFeetY: WATER_Y + 1.9,
        exitHeight: 1.9,
        contains: (x, z) => Math.hypot(x, z) < POOL_RADIUS - 2.0,
      },
      river.region,
      tributary.region,
    ],
  };
}
