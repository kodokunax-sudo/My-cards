import * as THREE from 'three';
import { PLAZA_RADIUS, GRASS_RADIUS, PALETTE, SUN_DIR } from './config.js';

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Площадь: круглая плитка с концентрическими поясами и радиальными швами. */
function plazaMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.stone,
    roughness: 0.93,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float r = length(vWPos.xz);
          float ang = atan(vWPos.z, vWPos.x);
          float slab = abs(fract(ang * 14.0) - 0.5);
          float ring = abs(fract(r / 7.5) - 0.5);
          float seam = (1.0 - smoothstep(0.465, 0.5, slab)) * 0.30 + (1.0 - smoothstep(0.455, 0.5, ring)) * 0.26;
          float grain = vnoise(vWPos.xz * 0.55) * 0.13 + vnoise(vWPos.xz * 6.0) * 0.05;
          diffuseColor.rgb *= (1.0 - seam);
          diffuseColor.rgb += vec3(0.030, 0.024, 0.012) * grain;
          float band = (1.0 - smoothstep(0.0, 1.6, abs(r - 118.0))) + (1.0 - smoothstep(0.0, 1.6, abs(r - 59.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.25, 0.21), band * 0.45);
          float shade = (1.0 - smoothstep(90.0, 170.0, r));
          diffuseColor.rgb *= mix(0.82, 1.0, shade);
        }
      `);
  };
  return mat;
}

function grassMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: PALETTE.grass,
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float n = vnoise(vWPos.xz * 0.035) * 0.5 + vnoise(vWPos.xz * 0.14) * 0.3;
          diffuseColor.rgb *= mix(0.72, 1.28, n);
        }
      `);
  };
  return mat;
}

export function createEnvironment(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = seededRandom(20261109);

  // ---------- земля и площадь ----------
  const grass = new THREE.Mesh(new THREE.CircleGeometry(GRASS_RADIUS, 96), grassMaterial());
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.06;
  grass.receiveShadow = true;
  grass.userData.walkable = true;
  group.add(grass);

  const plaza = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 128), plazaMaterial());
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  plaza.userData.walkable = true;
  group.add(plaza);

  // ---------- колоннада ----------
  const colRadius = 132;
  const colCount = 40;
  const colGeo = new THREE.CylinderGeometry(0.95, 1.2, 15, 14, 1);
  const columns = new THREE.InstancedMesh(colGeo, new THREE.MeshStandardMaterial({
    color: PALETTE.stoneWarm, roughness: 0.8, metalness: 0.02,
  }), colCount);
  columns.castShadow = true;
  columns.receiveShadow = true;
  const capGeo = new THREE.BoxGeometry(2.7, 1.3, 2.7);
  const caps = new THREE.InstancedMesh(capGeo, columns.material, colCount);
  caps.castShadow = true;
  const baseGeo = new THREE.BoxGeometry(3.0, 1.1, 3.0);
  const bases = new THREE.InstancedMesh(baseGeo, columns.material, colCount);
  bases.castShadow = true;
  bases.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  for (let i = 0; i < colCount; i++) {
    const a = (i / colCount) * Math.PI * 2;
    const x = Math.cos(a) * colRadius, z = Math.sin(a) * colRadius;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    pos.set(x, 7.5, z); m.compose(pos, q, scl); columns.setMatrixAt(i, m);
    pos.set(x, 15.6, z); m.compose(pos, q, scl); caps.setMatrixAt(i, m);
    pos.set(x, 0.55, z); m.compose(pos, q, scl); bases.setMatrixAt(i, m);
  }
  group.add(columns, caps, bases);

  // антаблемент над колоннами
  const entMat = new THREE.MeshStandardMaterial({ color: PALETTE.stoneWarm, roughness: 0.85 });
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(135.2, 135.2, 2.6, 128, 1, true), entMat);
  outer.position.y = 17.6; outer.castShadow = true;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(128.8, 128.8, 2.6, 128, 1, true), entMat);
  inner.position.y = 17.6; inner.material.side = THREE.DoubleSide;
  inner.userData.solid = true;
  const topRing = new THREE.Mesh(new THREE.RingGeometry(128.8, 135.2, 128), entMat);
  topRing.rotation.x = -Math.PI / 2; topRing.position.y = 18.9;
  topRing.userData.solid = true;
  group.add(outer, inner, topRing);

  // ---------- фонари по колоннаде ----------
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb85c, emissiveIntensity: 2.4, roughness: 0.5,
  });
  const lampGeo = new THREE.SphereGeometry(0.62, 12, 10);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 20);
  const postGeo = new THREE.CylinderGeometry(0.16, 0.22, 5.2, 8);
  const posts = new THREE.InstancedMesh(postGeo, entMat, 20);
  posts.userData.solid = true;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.078;
    const x = Math.cos(a) * 122, z = Math.sin(a) * 122;
    q.identity(); scl.set(1, 1, 1);
    pos.set(x, 5.6, z); m.compose(pos, q, scl); lamps.setMatrixAt(i, m);
    pos.set(x, 2.6, z); m.compose(pos, q, scl); posts.setMatrixAt(i, m);
  }
  lamps.castShadow = false;
  group.add(lamps, posts);

  // Park lanterns become the warm night lighting.
  const lampLights = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.078;
    const light = new THREE.PointLight(0xffbd72, 0, 34, 2);
    light.position.set(Math.cos(a) * 122, 5.6, Math.sin(a) * 122);
    group.add(light);
    lampLights.push(light);
  }

  // ---------- деревья ----------
  const treeCount = 64;
  const trunkGeo = new THREE.CylinderGeometry(0.32, 0.55, 5.0, 7);
  const foliageGeo = new THREE.IcosahedronGeometry(3.4, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.bark, roughness: 1.0 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: PALETTE.foliage, roughness: 0.95, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
  trunks.castShadow = true; crowns.castShadow = true;
  for (let i = 0; i < treeCount; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 188 + rnd() * 150;
    const s = 0.75 + rnd() * 1.0;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    pos.set(x, 2.5 * s, z); scl.set(s, s, s); m.compose(pos, q, scl); trunks.setMatrixAt(i, m);
    pos.set(x, (5.0 + rnd() * 1.4) * s, z); scl.set(s * 1.15, s * 0.9, s * 1.15); m.compose(pos, q, scl);
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, new THREE.Color().setHSL(0.26 + rnd() * 0.05, 0.32 + rnd() * 0.16, 0.22 + rnd() * 0.12));
  }
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);

  // ---------- дальний силуэт города ----------
  const cityMat = new THREE.MeshStandardMaterial({ color: PALETTE.city, roughness: 0.9 });
  const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMat, 90);
  city.userData.solid = true;
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 430 + rnd() * 420;
    const h = 24 + rnd() * 120;
    const w = 26 + rnd() * 60;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
    pos.set(x, h / 2, z); scl.set(w, h, w * (0.7 + rnd() * 0.6));
    m.compose(pos, q, scl); city.setMatrixAt(i, m);
  }
  group.add(city);

  // ---------- горы на горизонте ----------
  const mountainMat = new THREE.MeshStandardMaterial({ color: PALETTE.mountain, roughness: 1.0, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
    const r = 1150 + rnd() * 380;
    const h = 200 + rnd() * 230;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(h * 1.25, h, 7), mountainMat);
    cone.position.set(Math.cos(a) * r, h / 2 - 20, Math.sin(a) * r);
    cone.rotation.y = rnd() * 6.28;
    cone.userData.solid = true;
    group.add(cone);
  }

  // ---------- светлячки ----------
  const fireflyCount = 240;
  const fireflyPos = new Float32Array(fireflyCount * 3);
  const fireflySeed = new Float32Array(fireflyCount);
  for (let i = 0; i < fireflyCount; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 40 + rnd() * 150;
    fireflyPos[i * 3] = Math.cos(a) * r;
    fireflyPos[i * 3 + 1] = 0.6 + rnd() * 7.5;
    fireflyPos[i * 3 + 2] = Math.sin(a) * r;
    fireflySeed[i] = rnd() * 100;
  }
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
  fireflyGeo.setAttribute('aSeed', new THREE.BufferAttribute(fireflySeed, 1));
  const fireflyMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uPixelRatio;
      varying float vGlow;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.6 + aSeed) * 1.8;
        p.y += sin(uTime * 0.42 + aSeed * 1.7) * 0.9;
        p.z += cos(uTime * 0.53 + aSeed * 0.9) * 1.8;
        float blink = pow(max(sin(uTime * 2.1 + aSeed * 5.0), 0.0), 6.0);
        vGlow = 0.25 + 0.75 * blink;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (24.0 + 26.0 * blink) * uPixelRatio * (18.0 / max(-mv.z, 1.0));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vGlow;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = (1.0 - smoothstep(0.0, 0.5, length(d)));
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.45), a * vGlow * 0.85);
      }
    `,
  });
  const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
  fireflies.frustumCulled = false;
  group.add(fireflies);

  // ---------- птицы ----------
  const birdCount = 16;
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -1.0, 0, -0.3, 0, 0, 0.55,
    0, 0, 0, 0, 0, 0.55, 1.0, 0, -0.3,
  ], 3));
  birdGeo.setAttribute('aWing', new THREE.Float32BufferAttribute([
    0, 1, 0, 0, 1, 0,
  ], 1));
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aWing;
      uniform float uTime;
      varying float vShade;
      void main(){
        vec3 p = position;
        float flap = sin(uTime * 7.0) * 0.5;
        p.y += aWing * flap * abs(p.x) * 1.4;
        vShade = 0.25 + 0.5 * (1.0 - aWing);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vShade;
      void main(){ gl_FragColor = vec4(vec3(0.10, 0.11, 0.15), vShade); }
    `,
  });
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
  // Animated birds are visual effects rather than fixed collision obstacles.
  birds.userData.noCollider = true;
  birds.frustumCulled = false;
  const birdData = [];
  for (let i = 0; i < birdCount; i++) {
    birdData.push({
      r: 70 + rnd() * 140, h: 40 + rnd() * 80, speed: 0.06 + rnd() * 0.07,
      phase: rnd() * 6.28, bob: rnd() * 6.28, r2: 0.06 + rnd() * 0.05,
    });
  }
  group.add(birds);

  // ---------- солнце ----------
  const sun = new THREE.DirectionalLight(0xffd9ac, 3.1);
  sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -190;
  sun.shadow.camera.right = 190;
  sun.shadow.camera.top = 190;
  sun.shadow.camera.bottom = -190;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 700;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x8a7558, 1.55);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0x9fc0ff, 0.85);
  fill.position.set(-SUN_DIR.x * 200, 120, -SUN_DIR.z * 200);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffd9b0, 0.35);
  bounce.position.set(0, -120, 60);
  scene.add(bounce);
  const moon = new THREE.DirectionalLight(0x7896d8, 0);
  moon.position.set(-140, 220, -180);
  scene.add(moon);

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);

  return {
    group,
    sun,
    setTimeOfDay(nightProgress = 0) {
      const n = THREE.MathUtils.clamp(nightProgress, 0, 1);
      sun.intensity = THREE.MathUtils.lerp(3.1, 0.12, n);
      hemi.intensity = THREE.MathUtils.lerp(1.55, 0.34, n);
      fill.intensity = THREE.MathUtils.lerp(0.85, 0.08, n);
      bounce.intensity = THREE.MathUtils.lerp(0.35, 0.025, n);
      moon.intensity = 0.48 * n;
      for (const light of lampLights) light.intensity = 13 * n;
    },
    setShadowSize(size) {
      if (sun.shadow.mapSize.width === size) return;
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
    update(t, pixelRatio) {
      fireflyMat.uniforms.uTime.value = t;
      fireflyMat.uniforms.uPixelRatio.value = pixelRatio;
      birdMat.uniforms.uTime.value = t;
      for (let i = 0; i < birdCount; i++) {
        const b = birdData[i];
        const a = b.phase + t * b.speed;
        const x = Math.cos(a) * b.r;
        const z = Math.sin(a) * b.r;
        const y = b.h + Math.sin(t * b.r2 + b.bob) * 4;
        tmpP.set(x, y, z);
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
        tmpM.compose(tmpP, tmpQ, tmpS);
        birds.setMatrixAt(i, tmpM);
      }
      birds.instanceMatrix.needsUpdate = true;
    },
  };
}
