import * as THREE from 'three';
import {
  POOL_RADIUS, WATER_Y, ISLAND_RADIUS, SUN_DIR, PALETTE, BOWLS, FOUNTAIN_HEIGHT,
} from './config.js';

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWPos;
  varying vec3 vNrm;
  varying float vRad;

  float waveH(vec2 p, float t){
    float h = 0.0;
    h += sin(p.x * 0.115 + t * 1.15) * 0.30;
    h += sin(p.y * 0.163 - t * 0.93) * 0.24;
    h += sin((p.x + p.y) * 0.087 + t * 0.61) * 0.36;
    h += sin(length(p) * 0.21 - t * 1.70) * 0.14;
    h += sin((p.x - p.y) * 0.31 + t * 2.10) * 0.05;
    return h;
  }

  void main(){
    vec3 pos = position;
    float r = length(position.xz);
    vRad = r;
    float calm = smoothstep(9.0, 20.0, r);
    float e = 0.75;
    float h  = waveH(position.xz, uTime);
    float hx = waveH(position.xz + vec2(e, 0.0), uTime);
    float hz = waveH(position.xz + vec2(0.0, e), uTime);
    pos.y += h * calm;
    vNrm = normalize(vec3(h - hx, e, h - hz));
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform samplerCube uEnv;
  uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSkyTop, uSkyHorizon, uCamPos;
  uniform float uTime, uPoolRadius, uIslandRadius, uUseEnv, uUnderwater;
  uniform vec4 uImpacts[8];
  uniform int uImpactCount;
  varying vec3 vWPos;
  varying vec3 vNrm;
  varying float vRad;

  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.07; a *= 0.5; }
    return v;
  }

  void main(){
    vec3 V = normalize(uCamPos - vWPos);
    vec3 N = normalize(vNrm);

    float ripple = 0.0;
    float foam = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= uImpactCount) break;
      vec4 im = uImpacts[i];
      float d = abs(length(vWPos.xz - im.xy) - im.z);
      ripple += sin(d * 2.4 - uTime * 6.2) * exp(-d * 0.5) * im.w;
      foam += (1.0 - smoothstep(0.0, 1.6, d)) * im.w;
    }
    N = normalize(N + vec3(ripple * 0.22, 0.0, ripple * 0.16));

    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    fres = clamp(fres * 0.95 + 0.035, 0.0, 1.0);

    vec3 R = reflect(-V, N);
    R.y = abs(R.y) * 0.9 + 0.015;
    vec3 refl = textureCube(uEnv, R).rgb;
    vec3 skyGuess = mix(uSkyHorizon, uSkyTop, clamp(R.y, 0.0, 1.0));
    refl = mix(skyGuess, refl, uUseEnv);

    vec3 body = mix(uShallow, uDeep, smoothstep(10.0, 44.0, vRad));
    vec3 col = mix(body, refl, fres * 0.88);
    // From beneath the surface, suppress the bright sky reflection and tint
    // the water ceiling blue-green so the player can tell they are submerged.
    col = mix(col, vec3(0.012, 0.105, 0.145), uUnderwater * 0.72);

    vec3 H = normalize(uSunDir + V);
    float ndh = max(dot(N, H), 0.0);
    col += uSunColor * pow(ndh, 420.0) * 5.5;
    col += uSunColor * pow(ndh, 42.0) * 0.12;

    float sp = fbm(vWPos.xz * 2.2 + vec2(uTime * 0.35, -uTime * 0.22));
    col += vec3(0.85, 0.98, 1.0) * smoothstep(0.76, 0.99, sp) * 0.14;

    float foamIsl = (1.0 - smoothstep(uIslandRadius - 0.4, uIslandRadius + 1.6, vRad));
    float foamRim = smoothstep(uPoolRadius - 1.8, uPoolRadius - 0.4, vRad);
    float foamTex = 0.45 + 0.4 * fbm(vWPos.xz * 3.0 + vec2(uTime * 0.5, uTime * 0.3));
    foam = clamp(foam + (foamIsl + foamRim) * foamTex, 0.0, 1.0);
    col = mix(col, vec3(0.90, 0.96, 1.0), foam * 0.6);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Круглая сетка с концентрическими кольцами — для поверхности воды. */
function discGeometry(radius, rings, segs) {
  const positions = [0, 0, 0];
  const indices = [];
  for (let r = 1; r <= rings; r++) {
    const rad = (radius * r) / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      positions.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
  }
  // намотка снизу вверх, чтобы нормали смотрели в +Y
  for (let s = 0; s < segs; s++) indices.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const base = 1 + (r - 1) * segs;
    const next = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      indices.push(base + s, next + s2, next + s);
      indices.push(base + s, base + s2, next + s2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Трубка по произвольной ломаной с переменным радиусом. */
function tubeGeometry(points, radiusFn, radial = 6) {
  const positions = [], normals = [], uvs = [], indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3(), binormal = new THREE.Vector3(), normal = new THREE.Vector3();
  const ref = new THREE.Vector3();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i === 0) tangent.subVectors(points[1], points[0]);
    else if (i === n - 1) tangent.subVectors(points[i], points[i - 1]);
    else tangent.subVectors(points[i + 1], points[i - 1]);
    tangent.normalize();
    if (Math.abs(tangent.y) > 0.94) ref.set(1, 0, 0); else ref.copy(up);
    binormal.crossVectors(tangent, ref).normalize();
    normal.crossVectors(binormal, tangent).normalize();
    const r = radiusFn(i / (n - 1));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nx = binormal.x * ca + normal.x * sa;
      const ny = binormal.y * ca + normal.y * sa;
      const nz = binormal.z * ca + normal.z * sa;
      positions.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      normals.push(nx, ny, nz);
      uvs.push(j / radial, i / (n - 1));
    }
  }
  const stride = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j, b = a + stride, c = b + 1, d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

const JET_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNrm;
  varying vec3 vWPos;
  void main(){
    vUv = uv;
    vNrm = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const JET_FRAG = /* glsl */ `
  uniform float uTime, uOpacity;
  uniform vec3 uCamPos, uSunDir;
  varying vec2 vUv;
  varying vec3 vNrm;
  varying vec3 vWPos;

  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

  void main(){
    float flow = vUv.y * 2.2 - uTime * 2.6;
    float cell = floor(vUv.x * 26.0) * 17.13 + floor(flow * 16.0) * 31.7;
    float n = hash21(vec2(cell, cell * 0.37));
    float streak = smoothstep(0.22, 0.98, n);
    float fine = hash21(vec2(floor(vUv.x * 60.0) * 3.7, floor(flow * 34.0) * 9.1));

    vec3 V = normalize(uCamPos - vWPos);
    vec3 N = normalize(vNrm);
    float rim = pow(1.0 - abs(dot(N, V)), 1.4);

    vec3 col = mix(vec3(0.72, 0.88, 0.96), vec3(1.0), 0.25 + 0.5 * rim + 0.30 * streak + 0.15 * fine);
    float s = pow(max(dot(N, normalize(uSunDir + V)), 0.0), 48.0);
    col += vec3(1.0, 0.96, 0.86) * s * 0.9;

    float fade = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.80, 1.0, vUv.y));
    float alpha = (0.09 + 0.30 * streak + 0.30 * rim + 0.10 * fine) * fade * uOpacity;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

const PART_VERT = /* glsl */ `
  attribute vec3 aVel;
  attribute float aStart;
  attribute float aLife;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime, uPixelRatio, uGravity;
  varying float vAlpha;
  void main(){
    float t = mod(uTime - aStart, aLife);
    float k = t / aLife;
    vec3 p = position + aVel * t + vec3(0.0, -0.5 * uGravity * t * t, 0.0);
    p.x += sin(aSeed * 6.2831 + t * 2.4) * 0.22 * t;
    p.z += cos(aSeed * 4.1234 + t * 2.0) * 0.22 * t;
    vAlpha = smoothstep(0.0, 0.10, k) * (1.0 - smoothstep(0.42, 1.0, k));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * (1.0 + k * 0.7) * uPixelRatio * (320.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const PART_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main(){
    vec4 tx = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, tx.a * vAlpha * uOpacity);
  }
`;

function softSprite(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function rndFactory(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createWater(scene, fountain, camera, renderer, options = {}) {
  const initialCubeSize = options.mobile ? 64 : 256;
  const rnd = rndFactory(777123);
  const group = new THREE.Group();
  scene.add(group);
  const sprite = softSprite();

  // ---------------- отражение кубической камерой ----------------
  const cubeRT = new THREE.WebGLCubeRenderTarget(initialCubeSize, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    type: THREE.HalfFloatType,
  });
  const cubeCam = new THREE.CubeCamera(1, 3000, cubeRT);
  cubeCam.position.set(0, WATER_Y + 2.6, 0);
  cubeCam.children.forEach((c) => c.layers.set(0));
  group.add(cubeCam);

  const sunDir = new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize();
  // массив ровно из 8 элементов — размер uniform'а uImpacts[8] в шейдере
  const impacts = [];
  for (let i = 0; i < 8; i++) {
    const r = fountain.rippleRings[i];
    impacts.push(r ? new THREE.Vector4(r.x, r.z, r.r, r.strength) : new THREE.Vector4(0, 0, 0, 0));
  }

  const waterUniforms = {
    uTime: { value: 0 },
    uEnv: { value: cubeRT.texture },
    uSunDir: { value: sunDir },
    uSunColor: { value: new THREE.Color(0xffd9a2) },
    uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
    uShallow: { value: new THREE.Color(PALETTE.waterShallow) },
    uSkyTop: { value: new THREE.Color(PALETTE.skyTop) },
    uSkyHorizon: { value: new THREE.Color(PALETTE.horizon) },
    uCamPos: { value: new THREE.Vector3() },
    uPoolRadius: { value: POOL_RADIUS - 1.2 },
    uIslandRadius: { value: ISLAND_RADIUS },
    uUseEnv: { value: 1 },
    uUnderwater: { value: 0 },
    uImpacts: { value: impacts },
    uImpactCount: { value: Math.min(8, fountain.rippleRings.length) },
  };

  const nightPalette = {
    sun: new THREE.Color(0x5e79b9),
    deep: new THREE.Color(0x031321),
    shallow: new THREE.Color(0x0b3447),
    skyTop: new THREE.Color(0x07152d),
    skyHorizon: new THREE.Color(0x172642),
  };
  const dayPalette = {
    sun: waterUniforms.uSunColor.value.clone(),
    deep: waterUniforms.uDeep.value.clone(),
    shallow: waterUniforms.uShallow.value.clone(),
    skyTop: waterUniforms.uSkyTop.value.clone(),
    skyHorizon: waterUniforms.uSkyHorizon.value.clone(),
  };

  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    side: THREE.DoubleSide,
  });

  const pool = new THREE.Mesh(discGeometry(POOL_RADIUS - 1.25, 120, 180), waterMaterial);
  pool.userData.noCollider = true;
  pool.position.y = WATER_Y;
  pool.renderOrder = 1;
  pool.layers.set(2);
  group.add(pool);

  // вода в чашах — свои настройки, но общие время/камера
  const bowlUniforms = {
    uTime: waterUniforms.uTime,
    uEnv: waterUniforms.uEnv,
    uSunDir: waterUniforms.uSunDir,
    uSunColor: waterUniforms.uSunColor,
    uDeep: waterUniforms.uDeep,
    uShallow: waterUniforms.uShallow,
    uSkyTop: waterUniforms.uSkyTop,
    uSkyHorizon: waterUniforms.uSkyHorizon,
    uCamPos: waterUniforms.uCamPos,
    uPoolRadius: { value: 6 },
    uIslandRadius: { value: 0 },
    uUseEnv: { value: 0 },
    uUnderwater: waterUniforms.uUnderwater,
    uImpacts: { value: impacts },
    uImpactCount: { value: 0 },
  };
  const bowlWaterMat = new THREE.ShaderMaterial({
    uniforms: bowlUniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
  BOWLS.forEach((b) => {
    const m = new THREE.Mesh(discGeometry(b.r * 0.9, 26, 72), bowlWaterMat);
    m.userData.noCollider = true;
    m.position.y = b.y - 0.16;
    m.layers.set(2);
    group.add(m);
  });

  // ---------------- струи ----------------
  const jetUniforms = {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uSunDir: { value: sunDir },
    uOpacity: { value: 1.0 },
  };
  const jetMat = new THREE.ShaderMaterial({
    uniforms: jetUniforms,
    vertexShader: JET_VERT,
    fragmentShader: JET_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const impactPoints = [];
  const jetPaths = [];
  fountain.jets.forEach((jet) => {
    const vx = Math.cos(jet.a) * jet.speed * Math.cos(jet.angle);
    const vz = Math.sin(jet.a) * jet.speed * Math.cos(jet.angle);
    const vy = jet.speed * Math.sin(jet.angle);
    const p0 = new THREE.Vector3(
      Math.cos(jet.a) * jet.startRadius, jet.startY, Math.sin(jet.a) * jet.startRadius
    );
    const steps = 22;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * jet.tLand;
      pts.push(new THREE.Vector3(
        p0.x + vx * t,
        p0.y + vy * t - 4.905 * t * t,
        p0.z + vz * t
      ));
    }
    const geo = tubeGeometry(pts, (u) => 0.30 - 0.17 * u + 0.035 * Math.sin(u * Math.PI));
    const mesh = new THREE.Mesh(geo, jetMat);
    mesh.userData.noCollider = true; // flowing water is not a solid object
    mesh.renderOrder = 3;
    group.add(mesh);
    jetPaths.push({ pts, vx, vz, vy, p0 });
    impactPoints.push(new THREE.Vector3(p0.x + vx * jet.tLand, WATER_Y, p0.z + vz * jet.tLand));
  });

  // вертикальная струя из сферы
  const plumePts = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const y = FOUNTAIN_HEIGHT - 0.3 + t * 21;
    plumePts.push(new THREE.Vector3(Math.sin(t * 7.0) * 0.35 * t, y, Math.cos(t * 5.5) * 0.35 * t));
  }
  const plumeGeo = tubeGeometry(plumePts, (u) => 0.55 * (1 - u) + 0.14, 8);
  const plume = new THREE.Mesh(plumeGeo, jetMat);
  plume.userData.noCollider = true; // the vertical water stream is liquid
  plume.renderOrder = 3;
  group.add(plume);

  // ---------------- частицы ----------------
  function makeParticles(count, fill, opts) {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const start = new Float32Array(count);
    const life = new Float32Array(count);
    const size = new Float32Array(count);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = fill(i);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      vel[i * 3] = p.vx; vel[i * 3 + 1] = p.vy; vel[i * 3 + 2] = p.vz;
      start[i] = rnd() * (p.life || 1.8);
      life[i] = p.life || 1.8;
      size[i] = p.size || 1.0;
      seed[i] = rnd() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aStart', new THREE.BufferAttribute(start, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uGravity: { value: opts.gravity ?? 9.81 },
        uMap: { value: sprite },
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uOpacity: { value: opts.opacity ?? 0.6 },
      },
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.layers.set(opts.layer ?? 0);
    group.add(points);
    return { points, mat };
  }

  // брызги в местах падения струй
  const spray = makeParticles(impactPoints.length * 26, (i) => {
    const ip = impactPoints[Math.floor(i / 26)];
    const a = rnd() * Math.PI * 2;
    const sp = 2.5 + rnd() * 7.5;
    return {
      x: ip.x, y: WATER_Y + 0.15, z: ip.z,
      vx: Math.cos(a) * sp * 0.9, vy: sp * (0.55 + rnd() * 0.9), vz: Math.sin(a) * sp * 0.9,
      life: 1.1 + rnd() * 1.1,
      size: 0.30 + rnd() * 0.65,
    };
  }, { color: 0xeaf6ff, opacity: 0.34 });

  // туман над водой
  const mist = makeParticles(340, () => {
    const a = rnd() * Math.PI * 2;
    const r = 6 + rnd() * 46;
    return {
      x: Math.cos(a) * r, y: WATER_Y + rnd() * 5.5, z: Math.sin(a) * r,
      vx: (rnd() - 0.5) * 0.7, vy: 0.35 + rnd() * 0.5, vz: (rnd() - 0.5) * 0.7,
      life: 7 + rnd() * 7,
      size: 7 + rnd() * 13,
    };
  }, { color: 0xdff0ff, opacity: 0.12, additive: true });

  // водяная пыль верхней струи
  const plumeParticles = makeParticles(620, () => {
    const a = rnd() * Math.PI * 2;
    const rr = rnd() * 0.9;
    const sp = 15 + rnd() * 6;
    return {
      x: Math.cos(a) * rr, y: FOUNTAIN_HEIGHT - 0.4, z: Math.sin(a) * rr,
      vx: Math.cos(a) * (0.6 + rnd() * 2.4), vy: sp, vz: Math.sin(a) * (0.6 + rnd() * 2.4),
      life: 3.4 + rnd() * 0.9,
      size: 0.9 + rnd() * 2.0,
    };
  }, { color: 0xf2fbff, opacity: 0.45 });

  // ---------------- обновление ----------------
  let frame = 0;
  let cubeInterval = 3;
  let reflectionsEnabled = true;
  let particlesEnabled = true;
  let cubeSize = initialCubeSize;
  const camPos = new THREE.Vector3();

  return {
    group,
    pool,
    setCubeInterval(n) { cubeInterval = Math.max(1, n); },
    setReflectionSize(size) {
      const nextSize = THREE.MathUtils.clamp(Math.round(size), 64, 256);
      if (nextSize === cubeSize) return;
      cubeSize = nextSize;
      cubeRT.setSize(cubeSize, cubeSize);
    },
    setDrawDistance(distance) {
      const far = THREE.MathUtils.clamp(distance, 900, 12000);
      cubeCam.children.forEach((faceCamera) => {
        faceCamera.far = far;
        faceCamera.updateProjectionMatrix();
      });
    },
    setReflectionsEnabled(enabled) {
      reflectionsEnabled = !!enabled;
      waterUniforms.uUseEnv.value = reflectionsEnabled ? 1 : 0;
    },
    setParticleEffectsEnabled(enabled) {
      particlesEnabled = !!enabled;
      spray.points.visible = particlesEnabled;
      mist.points.visible = particlesEnabled;
      plumeParticles.points.visible = particlesEnabled;
    },
    setNight(progress = 0) {
      const n = THREE.MathUtils.clamp(progress, 0, 1);
      waterUniforms.uSunColor.value.copy(dayPalette.sun).lerp(nightPalette.sun, n);
      waterUniforms.uDeep.value.copy(dayPalette.deep).lerp(nightPalette.deep, n);
      waterUniforms.uShallow.value.copy(dayPalette.shallow).lerp(nightPalette.shallow, n);
      waterUniforms.uSkyTop.value.copy(dayPalette.skyTop).lerp(nightPalette.skyTop, n);
      waterUniforms.uSkyHorizon.value.copy(dayPalette.skyHorizon).lerp(nightPalette.skyHorizon, n);
    },
    update(t, dt, pixelRatio, isUnderwater = false) {
      waterUniforms.uTime.value = t;
      waterUniforms.uCamPos.value.copy(camera.position);
      waterUniforms.uUnderwater.value = isUnderwater ? 1 : 0;
      jetUniforms.uTime.value = t;
      jetUniforms.uCamPos.value.copy(camera.position);
      spray.mat.uniforms.uTime.value = t;
      spray.mat.uniforms.uPixelRatio.value = pixelRatio;
      mist.mat.uniforms.uTime.value = t;
      mist.mat.uniforms.uPixelRatio.value = pixelRatio;
      plumeParticles.mat.uniforms.uTime.value = t;
      plumeParticles.mat.uniforms.uPixelRatio.value = pixelRatio;

      frame++;
      if (reflectionsEnabled && frame % cubeInterval === 0) {
        cubeCam.updateMatrixWorld(true);
        const prevTone = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;
        try {
          cubeCam.update(renderer, scene);
        } finally {
          renderer.toneMapping = prevTone;
        }
      }
    },
  };
}
