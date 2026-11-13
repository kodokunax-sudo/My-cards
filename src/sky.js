import * as THREE from 'three';
import { SUN_DIR, PALETTE, getSunDirection } from './config.js';

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  float hash31(vec3 p){
    p = fract(p * 0.1031);
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
`;

export function createSky(scene) {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).normalize() },
    uTop: { value: new THREE.Color(PALETTE.skyTop) },
    uHorizon: { value: new THREE.Color(PALETTE.horizon) },
    uBottom: { value: new THREE.Color(PALETTE.skyBottom) },
    uSunColor: { value: new THREE.Color(PALETTE.sun) },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSunDir, uTop, uHorizon, uBottom, uSunColor;
      uniform float uTime, uNight;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        vec3 nightTop = vec3(0.006, 0.012, 0.038);
        vec3 nightHorizon = vec3(0.035, 0.047, 0.095);
        vec3 nightBottom = vec3(0.003, 0.006, 0.018);
        vec3 topCol = mix(uTop, nightTop, uNight);
        vec3 horizonCol = mix(uHorizon, nightHorizon, uNight);
        vec3 bottomCol = mix(uBottom, nightBottom, uNight);
        vec3 col = mix(horizonCol, topCol, pow(clamp(h, 0.0, 1.0), 0.42));
        col = mix(col, bottomCol, (1.0 - smoothstep(-0.22, 0.0, h)));

        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        float sunFade = 1.0 - smoothstep(0.05, 0.82, uNight);
        col += uSunColor * (pow(sd, 1600.0) * 9.0 + pow(sd, 30.0) * 0.38 + pow(sd, 5.0) * 0.09) * sunFade;

        float moonDot = max(dot(d, -normalize(uSunDir)), 0.0);
        float moonFade = smoothstep(0.08, 0.55, uNight);
        col += vec3(0.58, 0.68, 0.96) *
          (pow(moonDot, 1400.0) * 1.65 + pow(moonDot, 24.0) * 0.045) * moonFade;

        vec3 starCell = floor(d * 420.0);
        float starSeed = hash31(starCell);
        float star = step(0.9995, starSeed);
        float twinkle = 0.68 + 0.32 * sin(uTime * 2.1 + starSeed * 120.0);
        float starFade = smoothstep(0.12, 0.78, uNight) * smoothstep(-0.08, 0.18, h);
        col += vec3(0.72, 0.80, 1.0) * star * twinkle * starFade * 1.8;

        // вытянутые к горизонту облака
        vec2 cp = d.xz / max(h + 0.14, 0.05);
        float c1 = fbm(cp * 1.25 + vec2(uTime * 0.005, uTime * 0.0035));
        float c2 = fbm(cp * 3.4 - vec2(uTime * 0.009, 0.0));
        float cl = smoothstep(0.50, 0.86, c1 * 0.78 + c2 * 0.32);
        cl *= smoothstep(-0.03, 0.22, h) * (1.0 - smoothstep(0.5, 1.0, h) * 0.55);
        vec3 cloudCol = mix(vec3(0.70, 0.72, 0.80), uSunColor * 1.25, pow(sd, 2.0) * 0.95);
        cloudCol = mix(cloudCol, vec3(0.055, 0.067, 0.105), uNight);
        col = mix(col, cloudCol, cl * 0.72);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const SKY_DOME_BASE_RADIUS = 3000;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME_BASE_RADIUS, 48, 32), material);
  let lastDomeScale = 1;
  dome.userData.noCollider = true;
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  return {
    dome,
    update(t, camera, nightProgress = 0, dayPhase = 0) {
      uniforms.uTime.value = t;
      uniforms.uNight.value = THREE.MathUtils.clamp(nightProgress, 0, 1);
      const sunDirection = getSunDirection(dayPhase);
      uniforms.uSunDir.value.set(sunDirection.x, sunDirection.y, sunDirection.z).normalize();
      dome.position.copy(camera.position);

      // Keep the sky shell inside the camera's far plane. The sphere is a
      // real 3D mesh, so a short draw distance would otherwise clip the whole
      // 3km dome and make the sky disappear.
      const visibleRadius = Math.max(100, camera.far * 0.92);
      const nextScale = visibleRadius / SKY_DOME_BASE_RADIUS;
      if (Math.abs(nextScale - lastDomeScale) > 0.001) {
        dome.scale.setScalar(nextScale);
        lastDomeScale = nextScale;
      }
    },
  };
}
