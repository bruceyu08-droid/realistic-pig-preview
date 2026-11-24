import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODEL_URL = "./models/pig.glb";

// Principal body axis in the original mesh (from vertex PCA).
const FORWARD = new THREE.Vector3(0.408127, 0.0, 0.912925);
const SIDE = new THREE.Vector3(0.912925, 0.0, -0.408127);
const AXIS_ORIGIN = new THREE.Vector3(0.0344, 0.0, 0.037);

const EYE_L = new THREE.Vector3(0.1, 0.615, 0.506);
const EYE_R = new THREE.Vector3(0.268, 0.634, 0.493);
const EAR_BASE_L = new THREE.Vector3(0.06, 0.72, 0.356);
const EAR_TIP_L = new THREE.Vector3(0.02, 0.846, 0.366);
const EAR_BASE_R = new THREE.Vector3(0.338, 0.725, 0.348);
const EAR_TIP_R = new THREE.Vector3(0.39, 0.812, 0.37);

const TANK_MAX = 100;
const TANK_DRAIN = 0.9;
const SPLAT_RADIUS = 0.17;
const CLEAN_DIRT = 0.12;
const CLEAN_FOAM = 0.05;

const GX = 48;
const GY = 36;
const GZ = 72;
const WASH_MIN = new THREE.Vector3(-0.5, -0.04, -0.76);
const WASH_MAX = new THREE.Vector3(0.5, 0.92, 0.76);
const WASH_SIZE = WASH_MAX.clone().sub(WASH_MIN);

const pokeUniforms = {
  uPokePos: { value: new THREE.Vector3(0, 0.25, 0) },
  uPokeDir: { value: new THREE.Vector3(0, -1, 0) },
  uPokeAmp: { value: 0 },
  uPokeSig: { value: 0.14 },
  uJiggle: { value: 0 },
  uNudge: { value: new THREE.Vector3() },
};

const lifeUniforms = {
  uBlink: { value: 0 },
  uGaze: { value: new THREE.Vector2() },
  uBreath: { value: 0 },
  uShift: { value: 0 },
  uLean: { value: 0 },
  uEarL: { value: 0 },
  uEarR: { value: 0 },
  uEarBaseL: { value: EAR_BASE_L },
  uEarTipL: { value: EAR_TIP_L },
  uEarAxisL: { value: new THREE.Vector3(1, 0, 0) },
  uEarBaseR: { value: EAR_BASE_R },
  uEarTipR: { value: EAR_TIP_R },
  uEarAxisR: { value: new THREE.Vector3(1, 0, 0) },
  uEyeL: { value: EYE_L },
  uEyeR: { value: EYE_R },
  uHitPos: { value: new THREE.Vector3() },
  uHitDir: { value: new THREE.Vector3(0, -1, 0) },
  uHitAmp: { value: 0 },
  uHitSig: { value: 0.058 },
  uLidColor: { value: new THREE.Color().setRGB(196 / 255, 148 / 255, 138 / 255, THREE.SRGBColorSpace) },
  uWashMin: { value: WASH_MIN },
  uWashSize: { value: WASH_SIZE },
  uWashTex: { value: null },
};

function earAxis(base, tip) {
  const axis = new THREE.Vector3().crossVectors(tip.clone().sub(base), new THREE.Vector3(0, 1, 0));
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  return axis.normalize();
}
lifeUniforms.uEarAxisL.value.copy(earAxis(EAR_BASE_L, EAR_TIP_L));
lifeUniforms.uEarAxisR.value.copy(earAxis(EAR_BASE_R, EAR_TIP_R));

const poke = { amp: 0, vel: 0, target: 0, jiggle: 0, jiggleVel: 0, jiggleTarget: 0 };
const nudge = { current: new THREE.Vector3(), velocity: new THREE.Vector3(), target: new THREE.Vector3() };
const impact = {
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(0, -1, 0),
  desired: new THREE.Vector3(),
  desiredDir: new THREE.Vector3(0, -1, 0),
  amp: 0,
  vel: 0,
  goal: 0,
};

let lastAzimuth = 0;
let lastPolar = 0;
let pigRoot = null;
let pigMesh = null;
const pigMeshes = [];

const stage = document.getElementById("stage");
const loadingEl = document.getElementById("loading");
const cleanEl = document.getElementById("clean-label");
const tankEl = document.getElementById("tank");
const tankFill = document.getElementById("tank-fill");
const tankText = document.getElementById("tank-text");
const hintEl = document.getElementById("hint");
const clearEl = document.getElementById("clear");
const waterBtn = document.getElementById("mode-water");
const foamBtn = document.getElementById("mode-foam");

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.id = "view";
stage.insertBefore(renderer.domElement, stage.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd4d1cb);
scene.fog = new THREE.Fog(0xd4d1cb, 4.5, 11);

const camera = new THREE.PerspectiveCamera(30, 9 / 16, 0.05, 40);
camera.position.set(1.2, 0.9, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.15;
controls.maxDistance = 4.2;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI * 0.48;
controls.target.set(0, 0.42, 0);
controls.touches.ONE = -1;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
controls.mouseButtons.LEFT = -1;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
controls.rotateSpeed = 0.75;
controls.zoomSpeed = 0.85;
controls.update();
lastAzimuth = controls.getAzimuthalAngle();
lastPolar = controls.getPolarAngle();

const home = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xf3f1ec, 0x8d8882, 0.42));

const key = new THREE.DirectionalLight(0xfff4ea, 2.2);
key.position.set(2.2, 3.6, 1.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.4;
key.shadow.camera.far = 14;
key.shadow.camera.left = -2.2;
key.shadow.camera.right = 2.2;
key.shadow.camera.top = 2.2;
key.shadow.camera.bottom = -2.2;
key.shadow.bias = -0.00055;
key.shadow.normalBias = 0.03;
scene.add(key);
const fill = new THREE.DirectionalLight(0xe7eef4, 0.7);
fill.position.set(-2.4, 1.6, 1.4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xf6f3ee, 0.75);
rim.position.set(-0.6, 2.4, -3.1);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(8, 64),
  new THREE.MeshStandardMaterial({ color: 0xb9b6b0, roughness: 0.96, metalness: 0, envMapIntensity: 0.12 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const VERTEX_COMMON = /* glsl */ `
uniform vec3 uPokePos;
uniform vec3 uPokeDir;
uniform float uPokeAmp;
uniform float uPokeSig;
uniform float uJiggle;
uniform vec3 uNudge;
uniform float uBlink;
uniform vec2 uGaze;
uniform float uBreath;
uniform float uShift;
uniform float uLean;
uniform float uEarL;
uniform float uEarR;
uniform vec3 uEarBaseL;
uniform vec3 uEarTipL;
uniform vec3 uEarAxisL;
uniform vec3 uEarBaseR;
uniform vec3 uEarTipR;
uniform vec3 uEarAxisR;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform vec3 uHitPos;
uniform vec3 uHitDir;
uniform float uHitAmp;
uniform float uHitSig;
varying vec3 vPigLocal;

float softMask(vec3 p) {
  vec3 origin = vec3(0.0344, 0.0, 0.037);
  vec3 F = vec3(0.408127, 0.0, 0.912925);
  vec3 S = vec3(0.912925, 0.0, -0.408127);
  vec3 d = p - origin;
  float t = dot(d, F);
  float s = abs(dot(d, S));
  float y = p.y;
  float bellyT = smoothstep(-0.50, -0.38, t) * (1.0 - smoothstep(-0.04, 0.10, t));
  float bellyY = smoothstep(0.10, 0.18, y) * (1.0 - smoothstep(0.36, 0.48, y));
  float bellyS = 1.0 - smoothstep(0.20, 0.32, s);
  float belly = bellyT * bellyY * bellyS;
  float jowlT = smoothstep(0.22, 0.32, t) * (1.0 - smoothstep(0.52, 0.60, t));
  float jowlY = smoothstep(0.36, 0.44, y) * (1.0 - smoothstep(0.58, 0.66, y));
  float jowlS = smoothstep(0.02, 0.08, s) * (1.0 - smoothstep(0.20, 0.28, s));
  float jowl = jowlT * jowlY * jowlS;
  float neckT = smoothstep(0.12, 0.22, t) * (1.0 - smoothstep(0.34, 0.42, t));
  float neckY = smoothstep(0.28, 0.36, y) * (1.0 - smoothstep(0.52, 0.62, y));
  float neckS = 1.0 - smoothstep(0.16, 0.26, s);
  float neck = neckT * neckY * neckS * 0.7;
  return clamp(belly + jowl + neck, 0.0, 1.0);
}

float earWeight(vec3 p, vec3 base, vec3 tip) {
  vec3 axis = tip - base;
  float len2 = max(dot(axis, axis), 1e-6);
  float h = dot(p - base, axis) / len2;
  vec3 closest = base + axis * clamp(h, 0.0, 1.0);
  float dist = length(p - closest);
  float along = smoothstep(0.18, 0.5, h) * (1.0 - smoothstep(1.05, 1.25, h));
  float radial = 1.0 - smoothstep(0.055, 0.145, dist);
  return along * radial;
}

vec3 rotAxis(vec3 v, vec3 axis, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

float breathMask(vec3 p) {
  vec3 origin = vec3(0.0344, 0.0, 0.037);
  vec3 F = vec3(0.408127, 0.0, 0.912925);
  vec3 S = vec3(0.912925, 0.0, -0.408127);
  vec3 d = p - origin;
  float t = dot(d, F);
  float s = abs(dot(d, S));
  float y = p.y;
  float along = smoothstep(-0.58, -0.36, t) * (1.0 - smoothstep(0.08, 0.26, t));
  float height = smoothstep(0.20, 0.34, y) * (1.0 - smoothstep(0.62, 0.74, y));
  float side = 1.0 - smoothstep(0.20, 0.30, s);
  return along * height * side;
}
`;

const VERTEX_MOVE = /* glsl */ `
{
  vec3 rest = transformed;
  vPigLocal = rest;
  float w = softMask(rest);
  vec3 rel = rest - uPokePos;
  float fall = exp(-dot(rel, rel) / max(2.0 * uPokeSig * uPokeSig, 1e-5));
  vec3 down = vec3(0.0, -1.0, 0.0);
  transformed += uPokeDir * uPokeAmp * fall * w;
  transformed += w * (down * uJiggle + uNudge);

  vec3 hitRel = rest - uHitPos;
  float hitFall = exp(-dot(hitRel, hitRel) / max(2.0 * uHitSig * uHitSig, 1e-5));
  float give = mix(0.78, 1.12, w);
  transformed += uHitDir * (uHitAmp * hitFall * give);

  float b = breathMask(rest) * uBreath;
  vec3 side = vec3(0.912925, 0.0, -0.408127);
  float sideSign = sign(dot(rest - vec3(0.0344, 0.0, 0.037), side));
  transformed += vec3(0.0, 0.0030, 0.0) * b;
  transformed += side * sideSign * (0.00105 * b);

  float eL = earWeight(rest, uEarBaseL, uEarTipL);
  if (eL > 0.001) {
    vec3 swung = rotAxis(rest - uEarBaseL, uEarAxisL, uEarL * eL);
    transformed += (uEarBaseL + swung) - rest;
  }
  float eR = earWeight(rest, uEarBaseR, uEarTipR);
  if (eR > 0.001) {
    vec3 swung = rotAxis(rest - uEarBaseR, uEarAxisR, uEarR * eR);
    transformed += (uEarBaseR + swung) - rest;
  }

  vec3 gazeDelta = side * (uGaze.x * 0.0034) + vec3(0.0, uGaze.y * 0.0024, 0.0);
  float gL = 1.0 - smoothstep(0.008, 0.034, length(rest - uEyeL));
  float gR = 1.0 - smoothstep(0.008, 0.034, length(rest - uEyeR));
  transformed += gazeDelta * max(gL, gR);
  float blinkL = 1.0 - smoothstep(0.008, 0.04, length(rest - uEyeL));
  float blinkR = 1.0 - smoothstep(0.008, 0.04, length(rest - uEyeR));
  float upperL = smoothstep(-0.004, 0.018, rest.y - uEyeL.y);
  float upperR = smoothstep(-0.004, 0.018, rest.y - uEyeR.y);
  vec3 nL = normalize(vec3(-0.76, 0.55, 0.31));
  vec3 nR = normalize(vec3(0.75, 0.46, 0.47));
  transformed += (vec3(0.0, -0.013, 0.0) * upperL - nL * 0.0045) * uBlink * blinkL;
  transformed += (vec3(0.0, -0.013, 0.0) * upperR - nR * 0.0045) * uBlink * blinkR;

  float yaw = uShift * 0.01 * smoothstep(0.02, 0.22, rest.y);
  float roll = uLean * 0.008 * smoothstep(0.02, 0.22, rest.y);
  vec3 c = vec3(0.0344, 0.0, 0.037);
  vec3 q = transformed - c;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float x1 = cy * q.x + sy * q.z;
  float z1 = -sy * q.x + cy * q.z;
  float cr = cos(roll);
  float sr = sin(roll);
  transformed = vec3(sr * q.y + cr * x1, cr * q.y - sr * x1, z1) + c;
}
`;

const FRAGMENT_COMMON = /* glsl */ `
varying vec3 vPigLocal;
uniform sampler3D uWashTex;
uniform vec3 uWashMin;
uniform vec3 uWashSize;
uniform float uBlink;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform vec3 uLidColor;

float eyeCover(vec3 p, vec3 c) {
  float dist = length(p - c);
  float disk = 1.0 - smoothstep(0.018, 0.052, dist);
  float y = p.y - c.y;
  float edge = mix(0.055, -0.058, uBlink);
  float cover = smoothstep(edge - 0.01, edge + 0.016, y);
  return cover * disk;
}
`;

function applyPigMaterial(material) {
  material.metalness = 0;
  material.metalnessMap = null;
  material.envMapIntensity = 0.62;
  material.roughness = Math.max(material.roughness ?? 0.55, 0.42);
  if (material.normalScale) material.normalScale.set(0.85, 0.85);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pokeUniforms, lifeUniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\n" + VERTEX_COMMON);
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + VERTEX_MOVE);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\n" + FRAGMENT_COMMON);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      /* glsl */ `#include <map_fragment>
      {
        vec3 washUv = (vPigLocal - uWashMin) / uWashSize;
        vec4 wash = texture(uWashTex, washUv);
        float dirt = wash.r;
        float foam = wash.g;
        float n1 = fract(sin(dot(vPigLocal * 8.5, vec3(12.9, 78.2, 37.1))) * 43758.5);
        float n2 = fract(sin(dot(vPigLocal * 23.0, vec3(19.1, 43.4, 7.7))) * 12543.2);
        float lid = max(eyeCover(vPigLocal, uEyeL), eyeCover(vPigLocal, uEyeR));
        float yL = vPigLocal.y - uEyeL.y;
        float yR = vPigLocal.y - uEyeR.y;
        float edge = mix(0.055, -0.058, uBlink);
        float crease = 0.0;
        crease = max(crease, (1.0 - smoothstep(0.0, 0.016, abs(yL - edge))) * (1.0 - smoothstep(0.018, 0.052, length(vPigLocal - uEyeL))));
        crease = max(crease, (1.0 - smoothstep(0.0, 0.016, abs(yR - edge))) * (1.0 - smoothstep(0.018, 0.052, length(vPigLocal - uEyeR))));
        vec3 lidCol = uLidColor * (0.92 + 0.08 * n1);
        diffuseColor.rgb = mix(diffuseColor.rgb, lidCol, lid * 0.96);
        diffuseColor.rgb *= 1.0 - crease * smoothstep(0.02, 0.35, uBlink) * 0.45;
        float blot = clamp(dirt * (0.55 + 0.75 * n1) * (0.8 + 0.35 * n2), 0.0, 1.0);
        vec3 mud = mix(vec3(0.09, 0.045, 0.025), vec3(0.24, 0.15, 0.07), n2);
        diffuseColor.rgb = mix(diffuseColor.rgb, mud, smoothstep(0.08, 0.7, blot) * 0.88);
        diffuseColor.rgb *= mix(1.0, 0.42, blot);
        float foamVis = clamp(foam * (0.8 + 0.25 * n1), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 0.96), foamVis * 0.96);
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      /* glsl */ `#include <roughnessmap_fragment>
      {
        vec4 washR = texture(uWashTex, (vPigLocal - uWashMin) / uWashSize);
        roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.42), washR.r);
        roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * 0.7, 0.28, 1.0), washR.g);
      }`,
    );
  };
  material.customProgramCacheKey = () => "pig-wash-life-impact-v4";
  material.needsUpdate = true;
}

function softMaskCpu(p) {
  const dx = p.x - AXIS_ORIGIN.x;
  const dz = p.z - AXIS_ORIGIN.z;
  const t = dx * FORWARD.x + dz * FORWARD.z;
  const s = Math.abs(dx * SIDE.x + dz * SIDE.z);
  const y = p.y;
  const smoother = (edge0, edge1, x) => {
    const u = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return u * u * (3 - 2 * u);
  };
  const belly =
    smoother(-0.5, -0.38, t) *
    (1 - smoother(-0.04, 0.1, t)) *
    smoother(0.1, 0.18, y) *
    (1 - smoother(0.36, 0.48, y)) *
    (1 - smoother(0.2, 0.32, s));
  const jowl =
    smoother(0.22, 0.32, t) *
    (1 - smoother(0.52, 0.6, t)) *
    smoother(0.36, 0.44, y) *
    (1 - smoother(0.58, 0.66, y)) *
    smoother(0.02, 0.08, s) *
    (1 - smoother(0.2, 0.28, s));
  const neck =
    smoother(0.12, 0.22, t) *
    (1 - smoother(0.34, 0.42, t)) *
    smoother(0.28, 0.36, y) *
    (1 - smoother(0.52, 0.62, y)) *
    (1 - smoother(0.16, 0.26, s)) *
    0.7;
  return Math.min(1, Math.max(0, belly + jowl + neck));
}

function bodyT(p) {
  return (p.x - AXIS_ORIGIN.x) * FORWARD.x + (p.z - AXIS_ORIGIN.z) * FORWARD.z;
}

const washData = new Uint8Array(GX * GY * GZ * 4);
const washBase = new Uint8Array(washData.length);
const surface = new Uint8Array(GX * GY * GZ);
const score = new Uint8Array(GX * GY * GZ);
let surfaceCount = 0;
let dirtSum = 0;
let foamSum = 0;
let initialDirtAvg = 1;
let scoredSurface = 0;

function cellId(ix, iy, iz) {
  return ix + GX * (iy + GY * iz);
}
function cellOffset(ix, iy, iz) {
  return cellId(ix, iy, iz) * 4;
}
function cellOf(x, y, z) {
  const ix = Math.min(GX - 1, Math.max(0, Math.floor(((x - WASH_MIN.x) / WASH_SIZE.x) * GX)));
  const iy = Math.min(GY - 1, Math.max(0, Math.floor(((y - WASH_MIN.y) / WASH_SIZE.y) * GY)));
  const iz = Math.min(GZ - 1, Math.max(0, Math.floor(((z - WASH_MIN.z) / WASH_SIZE.z) * GZ)));
  return [ix, iy, iz];
}
function hash3(ix, iy, iz) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const washTex = new THREE.Data3DTexture(washData, GX, GY, GZ);
washTex.format = THREE.RGBAFormat;
washTex.type = THREE.UnsignedByteType;
washTex.magFilter = THREE.LinearFilter;
washTex.minFilter = THREE.LinearFilter;
washTex.wrapS = THREE.ClampToEdgeWrapping;
washTex.wrapT = THREE.ClampToEdgeWrapping;
washTex.wrapR = THREE.ClampToEdgeWrapping;
washTex.generateMipmaps = false;
washTex.unpackAlignment = 1;
washTex.colorSpace = THREE.NoColorSpace;
washTex.needsUpdate = true;
lifeUniforms.uWashTex.value = washTex;

function rebuildDirt() {
  surface.fill(0);
  score.fill(0);
  washData.fill(0);
  const positions = pigMesh.geometry.attributes.position;
  const normals = pigMesh.geometry.attributes.normal;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const [ix, iy, iz] = cellOf(positions.getX(i), y, positions.getZ(i));
    const id = cellId(ix, iy, iz);
    surface[id] = 1;
    if (y >= 0.06 && normals.getY(i) > -0.42) score[id] = 1;
  }
  const copy = surface.slice();
  for (let iz = 0; iz < GZ; iz++) {
    for (let iy = 0; iy < GY; iy++) {
      for (let ix = 0; ix < GX; ix++) {
        if (!copy[cellId(ix, iy, iz)]) continue;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = ix + dx;
              const y = iy + dy;
              const z = iz + dz;
              if (x < 0 || y < 0 || z < 0 || x >= GX || y >= GY || z >= GZ) continue;
              surface[cellId(x, y, z)] = 1;
            }
          }
        }
      }
    }
  }
  dirtSum = 0;
  foamSum = 0;
  surfaceCount = 0;
  scoredSurface = 0;
  for (let iz = 0; iz < GZ; iz++) {
    for (let iy = 0; iy < GY; iy++) {
      for (let ix = 0; ix < GX; ix++) {
        const id = cellId(ix, iy, iz);
        if (!surface[id]) continue;
        surfaceCount++;
        const y = WASH_MIN.y + ((iy + 0.5) / GY) * WASH_SIZE.y;
        let dirt = 0.55 + 0.45 * hash3(ix, iy, iz);
        dirt *= 0.72 + 0.5 * hash3(ix >> 2, iy >> 2, iz >> 2);
        if (dirt < 0.52) dirt = 0.52;
        if (y < 0.4) dirt = Math.min(1, dirt + 0.14);
        const value = Math.round(Math.min(1, dirt) * 255);
        washData[id * 4] = value;
        washData[id * 4 + 1] = 0;
        if (score[id]) {
          dirtSum += value;
          scoredSurface++;
        }
      }
    }
  }
  washBase.set(washData);
  initialDirtAvg = scoredSurface ? dirtSum / scoredSurface / 255 : 1;
  washTex.needsUpdate = true;
}

function dirtAvg() {
  return scoredSurface ? dirtSum / scoredSurface / 255 : 0;
}
function foamAvg() {
  return scoredSurface ? foamSum / scoredSurface / 255 : 0;
}

function writeCell(ix, iy, iz, dirt, foam) {
  const id = cellId(ix, iy, iz);
  const o = id * 4;
  const nextD = Math.max(0, Math.min(255, dirt | 0));
  const nextF = Math.max(0, Math.min(255, foam | 0));
  if (score[id]) {
    dirtSum += nextD - washData[o];
    foamSum += nextF - washData[o + 1];
  }
  washData[o] = nextD;
  washData[o + 1] = nextF;
}

function splat(local, mode, dt) {
  const cx = ((local.x - WASH_MIN.x) / WASH_SIZE.x) * GX;
  const cy = ((local.y - WASH_MIN.y) / WASH_SIZE.y) * GY;
  const cz = ((local.z - WASH_MIN.z) / WASH_SIZE.z) * GZ;
  const rx = (SPLAT_RADIUS / WASH_SIZE.x) * GX;
  const ry = (SPLAT_RADIUS / WASH_SIZE.y) * GY;
  const rz = (SPLAT_RADIUS / WASH_SIZE.z) * GZ;
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(GX - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(GY - 1, Math.ceil(cy + ry));
  const z0 = Math.max(0, Math.floor(cz - rz));
  const z1 = Math.min(GZ - 1, Math.ceil(cz + rz));
  const r2 = SPLAT_RADIUS * SPLAT_RADIUS;
  for (let iz = z0; iz <= z1; iz++) {
    const pz = WASH_MIN.z + ((iz + 0.5) / GZ) * WASH_SIZE.z;
    for (let iy = y0; iy <= y1; iy++) {
      const py = WASH_MIN.y + ((iy + 0.5) / GY) * WASH_SIZE.y;
      for (let ix = x0; ix <= x1; ix++) {
        const px = WASH_MIN.x + ((ix + 0.5) / GX) * WASH_SIZE.x;
        const dx = px - local.x;
        const dy = py - local.y;
        const dz = pz - local.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const fall = 1 - d2 / r2;
        const o = cellOffset(ix, iy, iz);
        let dirt = washData[o];
        let foam = washData[o + 1];
        if (mode === "foam") {
          foam = Math.min(255, foam + 520 * fall * dt);
          dirt = Math.max(0, dirt - 28 * fall * dt);
        } else {
          const boost = 1 + (foam / 255) * 1.5;
          dirt = Math.max(0, dirt - 300 * boost * fall * dt);
          foam = Math.max(0, foam - 460 * fall * dt);
        }
        writeCell(ix, iy, iz, dirt, foam);
      }
    }
  }
  washTex.needsUpdate = true;
}

function regionScale(local) {
  let scale = 1;
  const y = local.y;
  const t = bodyT(local);
  if (y < 0.1) scale *= 0.22 + 0.78 * (y / 0.1);
  if (t > 0.55) scale *= 1 - 0.62 * Math.min(1, (t - 0.55) / 0.12);
  return scale;
}

function makeSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const sprite = makeSprite();
function makePoints(count, size) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  positions.fill(0);
  for (let i = 1; i < positions.length; i += 3) positions[i] = -6;
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: sprite,
    color: 0xffffff,
    size,
    transparent: true,
    depthWrite: false,
    opacity: 0.88,
    sizeAttenuation: true,
    vertexColors: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);
  const life = new Float32Array(count);
  const maxLife = new Float32Array(count);
  const vel = new Float32Array(count * 3);
  const rgb = new Float32Array(count * 3);
  return { points, life, maxLife, vel, rgb, cursor: 0, count };
}
const waterPoints = makePoints(520, 0.055);
const foamPoints = makePoints(360, 0.095);
waterPoints.points.material.color.set(0xd5ecf8);
foamPoints.points.material.color.set(0xf3f1ea);

function spawnDrop(pool, x, y, z, vx, vy, vz, life) {
  const i = pool.cursor;
  pool.cursor = (pool.cursor + 1) % pool.count;
  const p = pool.points.geometry.attributes.position.array;
  p[i * 3] = x;
  p[i * 3 + 1] = y;
  p[i * 3 + 2] = z;
  pool.vel[i * 3] = vx;
  pool.vel[i * 3 + 1] = vy;
  pool.vel[i * 3 + 2] = vz;
  pool.life[i] = life;
  pool.maxLife[i] = life;
}

function stepPoints(pool, dt, gravity) {
  const p = pool.points.geometry.attributes.position.array;
  let dirty = false;
  for (let i = 0; i < pool.count; i++) {
    if (pool.life[i] <= 0) continue;
    dirty = true;
    pool.life[i] -= dt;
    if (pool.life[i] <= 0) {
      p[i * 3 + 1] = -6;
      continue;
    }
    pool.vel[i * 3 + 1] -= gravity * dt;
    p[i * 3] += pool.vel[i * 3] * dt;
    p[i * 3 + 1] += pool.vel[i * 3 + 1] * dt;
    p[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
  }
  if (dirty) pool.points.geometry.attributes.position.needsUpdate = true;
  const fade = pool === foamPoints ? 0.9 : 0.85;
  pool.points.material.opacity = fade;
}

const stream = new THREE.Mesh(
  new THREE.CylinderGeometry(0.016, 0.007, 1, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xd7eef8,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
stream.visible = false;
stream.frustumCulled = false;
stream.renderOrder = 2;
scene.add(stream);

const _nozzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _local = new THREE.Vector3();
const _normal = new THREE.Vector3();

function placeStream(from, to, foam) {
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len < 0.04) {
    stream.visible = false;
    return;
  }
  _dir.multiplyScalar(1 / len);
  stream.visible = true;
  stream.scale.set(foam ? 1.7 : 1, len, foam ? 1.7 : 1);
  stream.position.copy(from).addScaledVector(_dir, len * 0.5);
  stream.quaternion.setFromUnitVectors(_up, _dir);
  stream.material.color.set(foam ? 0xf4f2eb : 0xd7eef8);
  stream.material.opacity = foam ? 0.62 : 0.55;
}

function nozzleFrom(ndcX) {
  const dist = 0.5;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * dist;
  const halfW = halfH * camera.aspect;
  _nozzle.set(THREE.MathUtils.clamp(ndcX, -1, 1) * halfW * 0.62, -halfH * 0.9, -dist);
  _nozzle.applyMatrix4(camera.matrixWorld);
  return _nozzle;
}

const game = {
  mode: "water",
  tank: TANK_MAX,
  cleared: false,
  shownClean: 0,
  paused: false,
};

const spray = {
  active: false,
  pointerId: null,
  ndcX: 0,
  ndcY: 0,
  useNdc: false,
};

const pointers = new Map();
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const clock = new THREE.Clock();
let sprayCarry = 0;

const blink = { value: 0, phase: "wait", t: 0, wait: 0.55, hold: 0.06, double: false, lock: null };
const gaze = { x: 0, y: 0, tx: 0, ty: 0, t: 0, wait: 1.2 };
const ears = {
  L: { ang: 0, phase: "wait", t: 0, wait: 0.7, peak: 0, attack: 0.05, again: false, lock: null },
  R: { ang: 0, phase: "wait", t: 0, wait: 1.35, peak: 0, attack: 0.05, again: false, lock: null },
};
const life = { breath: 0, shift: 0, lean: 0, phase: 0, time: 0 };

function stepBlink(dt) {
  if (blink.lock !== null) {
    blink.value = blink.lock;
    lifeUniforms.uBlink.value = blink.value;
    return;
  }
  blink.t += dt;
  if (blink.phase === "wait") {
    if (blink.t >= blink.wait) {
      blink.phase = "close";
      blink.t = 0;
      blink.hold = 0.04 + Math.random() * 0.05;
      blink.double = Math.random() < 0.3;
    }
  } else if (blink.phase === "close") {
    blink.value = Math.min(1, blink.t / 0.055);
    if (blink.value >= 1) {
      blink.phase = "hold";
      blink.t = 0;
    }
  } else if (blink.phase === "hold") {
    blink.value = 1;
    if (blink.t >= blink.hold) {
      blink.phase = "open";
      blink.t = 0;
    }
  } else {
    blink.value = 1 - Math.min(1, blink.t / 0.1);
    if (blink.value <= 0) {
      blink.value = 0;
      if (blink.double) {
        blink.double = false;
        blink.phase = "close";
        blink.t = 0;
        blink.hold = 0.03;
      } else {
        blink.phase = "wait";
        blink.t = 0;
        blink.wait = 2.2 + Math.random() * 4.2;
      }
    }
  }
  lifeUniforms.uBlink.value = blink.value;
}

function stepGaze(dt) {
  gaze.t += dt;
  if (gaze.t >= gaze.wait) {
    gaze.t = 0;
    gaze.wait = 0.85 + Math.random() * 2.3;
    if (Math.random() < 0.34) {
      gaze.tx = 0;
      gaze.ty = 0;
    } else {
      gaze.tx = (Math.random() * 2 - 1) * 0.85;
      gaze.ty = (Math.random() * 2 - 1) * 0.5;
    }
  }
  const k = 1 - Math.exp(-18 * dt);
  gaze.x += (gaze.tx - gaze.x) * k;
  gaze.y += (gaze.ty - gaze.y) * k;
  lifeUniforms.uGaze.value.set(gaze.x, gaze.y);
}

function stepEar(ear, dt) {
  if (ear.lock !== null) {
    ear.ang = ear.lock;
    return;
  }
  ear.t += dt;
  if (ear.phase === "wait") {
    if (ear.t < ear.wait) return;
    ear.phase = "attack";
    ear.t = 0;
    const twitch = Math.random() < 0.42;
    const mag = twitch ? 0.025 + Math.random() * 0.03 : 0.07 + Math.random() * 0.05;
    ear.peak = Math.random() < 0.5 ? -mag : mag;
    ear.attack = 0.035 + Math.random() * 0.03;
    ear.again = Math.random() < 0.22;
  } else if (ear.phase === "attack") {
    const u = Math.min(1, ear.t / ear.attack);
    ear.ang = ear.peak * u * u;
    if (u >= 1) {
      ear.phase = "recover";
      ear.t = 0;
    }
  } else {
    ear.ang *= Math.exp(-10 * dt);
    if (Math.abs(ear.ang) < 0.002) {
      ear.ang = 0;
      if (ear.again) {
        ear.again = false;
        ear.phase = "attack";
        ear.t = 0;
        ear.peak *= 0.65;
        ear.attack = 0.04;
      } else {
        ear.phase = "wait";
        ear.t = 0;
        ear.wait = 1.4 + Math.random() * 3.6;
      }
    }
  }
}

function stepLife(dt) {
  life.time += dt;
  life.phase += dt * (1.85 + 0.07 * Math.sin(life.time * 0.07));
  const s = Math.sin(life.phase);
  life.breath = s >= 0 ? Math.pow(s, 0.9) : -Math.pow(-s, 1.15) * 0.72;
  life.shift = 0.62 * Math.sin(life.time * 0.23) + 0.38 * Math.sin(life.time * 0.097 + 1.7);
  life.lean = 0.58 * Math.sin(life.time * 0.17 + 0.5) + 0.42 * Math.sin(life.time * 0.061);
  stepBlink(dt);
  stepGaze(dt);
  stepEar(ears.L, dt);
  stepEar(ears.R, dt);
  lifeUniforms.uBreath.value = life.breath;
  lifeUniforms.uShift.value = life.shift;
  lifeUniforms.uLean.value = life.lean;
  lifeUniforms.uEarL.value = ears.L.ang;
  lifeUniforms.uEarR.value = ears.R.ang;
}

function stepImpact(dt) {
  if (!spray.active) impact.goal = 0;
  if (impact.amp < 0.0003 && impact.goal < 0.0001) {
    impact.pos.copy(impact.desired);
    impact.dir.copy(impact.desiredDir);
    if (impact.dir.lengthSq() > 1e-8) impact.dir.normalize();
  } else {
    const k = 1 - Math.exp(-20 * dt);
    impact.pos.lerp(impact.desired, k);
    impact.dir.lerp(impact.desiredDir, k);
    if (impact.dir.lengthSq() > 1e-8) impact.dir.normalize();
  }
  const w = 24;
  const z = 1.18;
  const h = dt / 4;
  for (let i = 0; i < 4; i++) {
    const acc = -2 * z * w * impact.vel - w * w * (impact.amp - impact.goal);
    impact.vel += acc * h;
    impact.amp += impact.vel * h;
  }
  impact.amp = Math.max(0, Math.min(0.006, impact.amp));
  lifeUniforms.uHitPos.value.copy(impact.pos);
  lifeUniforms.uHitDir.value.copy(impact.dir);
  lifeUniforms.uHitAmp.value = impact.amp;
}

const STIFF = 11;
const DAMP = 0.92;
const JIGGLE_STIFF = 8.5;
const JIGGLE_DAMP = 0.95;
const NUDGE_STIFF = 7;
const NUDGE_DAMP = 0.9;
const _nudgeDelta = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();

function stepSoftBody(dt) {
  const acc = -2 * DAMP * STIFF * poke.vel - STIFF * STIFF * (poke.amp - poke.target);
  poke.vel += acc * dt;
  poke.amp += poke.vel * dt;
  const jAcc = -2 * JIGGLE_DAMP * JIGGLE_STIFF * poke.jiggleVel - JIGGLE_STIFF * JIGGLE_STIFF * (poke.jiggle - poke.jiggleTarget);
  poke.jiggleVel += jAcc * dt;
  poke.jiggle += poke.jiggleVel * dt;
  poke.amp = Math.max(-0.016, Math.min(0.016, poke.amp));
  poke.jiggle = Math.max(-0.008, Math.min(0.008, poke.jiggle));
  pokeUniforms.uPokeAmp.value = poke.amp;
  pokeUniforms.uJiggle.value = poke.jiggle;

  const az = controls.getAzimuthalAngle();
  const pol = controls.getPolarAngle();
  const dAz = az - lastAzimuth;
  const dPol = pol - lastPolar;
  lastAzimuth = az;
  lastPolar = pol;
  _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  _camUp.setFromMatrixColumn(camera.matrixWorld, 1);
  nudge.target.copy(_camRight).multiplyScalar(-dAz * 0.55).addScaledVector(_camUp, dPol * 0.35);
  const tLen = nudge.target.length();
  if (tLen > 0.006) nudge.target.multiplyScalar(0.006 / tLen);
  _nudgeDelta.copy(nudge.target).sub(nudge.current);
  nudge.velocity.addScaledVector(_nudgeDelta, NUDGE_STIFF * NUDGE_STIFF * dt);
  nudge.velocity.multiplyScalar(Math.exp(-2 * NUDGE_DAMP * NUDGE_STIFF * dt));
  nudge.current.addScaledVector(nudge.velocity, dt);
  const nLen = nudge.current.length();
  if (nLen > 0.007) nudge.current.multiplyScalar(0.007 / nLen);
  pokeUniforms.uNudge.value.copy(nudge.current);
  nudge.target.multiplyScalar(0.4);
}

function resize() {
  const w = Math.max(1, stage.clientWidth);
  const h = Math.max(1, stage.clientHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", resize);
resize();

function framePig(root) {
  const heading = Math.atan2(FORWARD.x, FORWARD.z);
  root.rotation.y = -heading;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  const framed = new THREE.Box3().setFromObject(root);
  const size = framed.getSize(new THREE.Vector3());
  const mid = framed.getCenter(new THREE.Vector3());
  controls.target.set(mid.x, mid.y * 0.98, mid.z);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
  const span = Math.max(size.y * 0.92, size.z * 0.72);
  let dist = span / (2 * Math.tan(hFov * 0.5));
  dist *= 0.86;
  const dir = new THREE.Vector3(0.62, 0.34, 0.71).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.minDistance = dist * 0.72;
  controls.maxDistance = dist * 1.45;
  controls.update();
  home.pos.copy(camera.position);
  home.target.copy(controls.target);
  lastAzimuth = controls.getAzimuthalAngle();
  lastPolar = controls.getPolarAngle();
}

function prepareModel(gltf) {
  const root = new THREE.Group();
  root.name = "pigRoot";
  root.add(gltf.scene);
  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    obj.frustumCulled = false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((mat) => {
      if (!mat) return;
      applyPigMaterial(mat);
      if (mat.map) {
        mat.map.anisotropy = 8;
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }
      if (mat.normalMap) mat.normalMap.anisotropy = 8;
      if (mat.roughnessMap) mat.roughnessMap.anisotropy = 8;
    });
    pigMeshes.push(obj);
    pigMesh = obj;
  });
  rebuildDirt();
  framePig(root);
  scene.add(root);
  pigRoot = root;
  document.body.classList.add("is-ready");
  updateHud(true);
  window.__PIG_READY__ = true;
}

const loader = new GLTFLoader();
loader.load(
  MODEL_URL,
  (gltf) => prepareModel(gltf),
  (event) => {
    if (!loadingEl || !event.total) return;
    loadingEl.textContent = `正在载入小猪… ${Math.min(100, Math.round((100 * event.loaded) / event.total))}%`;
  },
  () => {
    if (loadingEl) loadingEl.textContent = "模型载入失败。请用本地 HTTP 打开本页。";
  },
);

function eventNdc(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

function aimFromNdc(x, y) {
  ndc.set(x, y);
  raycaster.setFromCamera(ndc, camera);
  const hits = pigRoot ? raycaster.intersectObjects(pigMeshes, false) : [];
  if (hits.length) return { hit: hits[0], point: hits[0].point };
  const planePoint = controls.target;
  const planeNormal = new THREE.Vector3();
  camera.getWorldDirection(planeNormal);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, planePoint);
  const point = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(plane, point)) point.copy(planePoint);
  return { hit: null, point };
}

function sprayFrame(dt) {
  if (!spray.active || !pigMesh || game.cleared) {
    stream.visible = false;
    poke.target = 0;
    return;
  }
  if (game.tank <= 0) {
    game.tank = 0;
    stream.visible = false;
    impact.goal = 0;
    poke.target = 0;
    return;
  }
  game.tank = Math.max(0, game.tank - TANK_DRAIN * dt);
  const aim = aimFromNdc(spray.ndcX, spray.ndcY);
  const from = nozzleFrom(spray.ndcX).clone();
  placeStream(from, aim.point, game.mode === "foam");
  _dir.subVectors(aim.point, from);
  const dist = Math.max(0.2, _dir.length());
  _dir.multiplyScalar(1 / dist);
  const speed = dist / 0.16;
  const pool = game.mode === "foam" ? foamPoints : waterPoints;
  const rate = game.mode === "foam" ? 240 : 380;
  sprayCarry += rate * dt;
  let spawned = 0;
  while (sprayCarry >= 1 && spawned < 24) {
    sprayCarry -= 1;
    spawned++;
    const jitter = _dir.clone();
    jitter.x += (Math.random() - 0.5) * 0.08;
    jitter.y += (Math.random() - 0.5) * 0.08;
    jitter.z += (Math.random() - 0.5) * 0.08;
    jitter.normalize().multiplyScalar(speed);
    spawnDrop(pool, from.x, from.y, from.z, jitter.x, jitter.y, jitter.z, 0.18 + Math.random() * 0.08);
  }
  if (aim.hit) {
    _local.copy(aim.hit.point);
    pigMesh.worldToLocal(_local);
    splat(_local, game.mode, dt);
    if (aim.hit.normal) _normal.copy(aim.hit.normal);
    else _normal.set(0, 1, 0);
    _normal.normalize();
    impact.desired.copy(_local);
    impact.desiredDir.copy(_normal).multiplyScalar(-1);
    impact.goal = 0.0034 * regionScale(_local);
    const splash = game.mode === "foam" ? foamPoints : waterPoints;
    for (let i = 0; i < 3; i++) {
      const vx = (Math.random() - 0.5) * 0.8;
      const vy = 0.3 + Math.random() * 0.5;
      const vz = (Math.random() - 0.5) * 0.8;
      spawnDrop(splash, aim.point.x, aim.point.y, aim.point.z, vx, vy, vz, 0.16);
    }
    if (game.mode === "water") {
      const soft = softMaskCpu(_local);
      poke.target = soft > 0.25 ? 0.0016 * soft : 0;
    } else {
      poke.target = 0;
    }
  } else {
    impact.goal = 0;
    poke.target = 0;
  }
  maybeClear();
}

function shownCleanRatio() {
  if (!scoredSurface || !initialDirtAvg) return 0;
  const washed = 1 - THREE.MathUtils.clamp(dirtAvg() / initialDirtAvg, 0, 1);
  return THREE.MathUtils.clamp(washed * (1 - foamAvg() * 0.55), 0, 1);
}

function maybeClear() {
  if (game.cleared || !pigMesh) return;
  if (dirtAvg() <= CLEAN_DIRT && foamAvg() <= CLEAN_FOAM) {
    game.cleared = true;
    spray.active = false;
    stream.visible = false;
    clearEl.hidden = false;
  }
}

function updateHud(force) {
  const ratio = game.cleared ? 1 : shownCleanRatio();
  const pct = Math.round(ratio * 100);
  if (force || pct !== game.shownClean) {
    game.shownClean = pct;
    cleanEl.textContent = `清洁度 ${pct}%`;
  }
  const tankPct = Math.max(0, Math.round((game.tank / TANK_MAX) * 100));
  tankFill.style.transform = `scaleX(${game.tank / TANK_MAX})`;
  tankEl.classList.toggle("is-low", tankPct < 18);
  tankText.textContent = game.tank <= 0 ? "空了" : `${tankPct}%`;
  if (game.cleared) hintEl.textContent = "已经洗干净了。";
  else if (game.tank <= 0) hintEl.textContent = "水箱空了。点「重来」重新装满。";
  else if (game.mode === "foam") hintEl.textContent = "泡沫会留在身上。换清水，把泡沫和剩下的泥一起冲掉。";
  else hintEl.textContent = "按住冲洗泥点。也可先喷泡沫，再换清水冲掉。双指转动，捏合缩放。";
}

function setMode(mode) {
  game.mode = mode === "foam" ? "foam" : "water";
  waterBtn.classList.toggle("is-on", game.mode === "water");
  foamBtn.classList.toggle("is-on", game.mode === "foam");
  updateHud(true);
}

function retry() {
  if (!pigMesh) return;
  washData.set(washBase);
  washTex.needsUpdate = true;
  dirtSum = 0;
  foamSum = 0;
  scoredSurface = 0;
  for (let i = 0; i < score.length; i++) {
    if (!score[i]) continue;
    scoredSurface++;
    dirtSum += washData[i * 4];
    foamSum += washData[i * 4 + 1];
  }
  game.tank = TANK_MAX;
  game.cleared = false;
  game.mode = "water";
  spray.active = false;
  stream.visible = false;
  impact.amp = 0;
  impact.vel = 0;
  impact.goal = 0;
  poke.amp = 0;
  poke.vel = 0;
  poke.target = 0;
  clearEl.hidden = true;
  waterBtn.classList.add("is-on");
  foamBtn.classList.remove("is-on");
  camera.position.copy(home.pos);
  controls.target.copy(home.target);
  controls.update();
  lastAzimuth = controls.getAzimuthalAngle();
  lastPolar = controls.getPolarAngle();
  updateHud(true);
}

waterBtn.addEventListener("click", () => setMode("water"));
foamBtn.addEventListener("click", () => setMode("foam"));
document.getElementById("retry").addEventListener("click", retry);
document.getElementById("retry-small").addEventListener("click", retry);

function pointerNdc(event) {
  eventNdc(event.clientX, event.clientY);
  spray.ndcX = ndc.x;
  spray.ndcY = ndc.y;
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (pointers.size >= 2 || game.cleared) {
    spray.active = false;
    return;
  }
  spray.active = true;
  spray.pointerId = event.pointerId;
  spray.useNdc = false;
  pointerNdc(event);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!spray.active || event.pointerId !== spray.pointerId) return;
  pointerNdc(event);
});
function endPointer(event) {
  pointers.delete(event.pointerId);
  if (spray.pointerId !== event.pointerId && pointers.size > 0) {
    if (pointers.size >= 2) spray.active = false;
    return;
  }
  spray.pointerId = null;
  spray.active = false;
  if (pointers.size === 1 && !game.cleared) {
    const [id, pos] = pointers.entries().next().value;
    spray.active = true;
    spray.pointerId = id;
    eventNdc(pos.x, pos.y);
    spray.ndcX = ndc.x;
    spray.ndcY = ndc.y;
  }
}
renderer.domElement.addEventListener("pointerup", endPointer);
renderer.domElement.addEventListener("pointercancel", endPointer);
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
renderer.domElement.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  controls.update();
  if (pigRoot) {
    camera.updateMatrixWorld();
    pigRoot.updateMatrixWorld(true);
    if (!game.paused) stepLife(dt);
    sprayFrame(dt);
    stepImpact(dt);
    stepSoftBody(dt);
    updateHud(false);
  }
  stepPoints(waterPoints, dt, 1.4);
  stepPoints(foamPoints, dt, 0.35);
  renderer.render(scene, camera);
}
animate();

window.__pig = {
  get ready() {
    return !!pigRoot;
  },
  state() {
    return {
      ready: !!pigRoot,
      mode: game.mode,
      tank: game.tank,
      cleared: game.cleared,
      dirt: dirtAvg(),
      foam: foamAvg(),
      clean: game.cleared ? 1 : shownCleanRatio(),
      blink: blink.value,
      gazeX: gaze.x,
      gazeY: gaze.y,
      earL: ears.L.ang,
      earR: ears.R.ang,
      breath: life.breath,
      shift: life.shift,
      lean: life.lean,
      hitAmp: impact.amp,
      spraying: spray.active,
      surfaceCount,
    };
  },
  setMode,
  retry,
  setAim(x, y) {
    spray.useNdc = true;
    spray.active = !game.cleared && game.tank > 0;
    spray.ndcX = x;
    spray.ndcY = y;
  },
  stop() {
    spray.active = false;
    spray.useNdc = false;
  },
  setBlink(value) {
    blink.lock = value;
    if (value !== null) lifeUniforms.uBlink.value = value;
  },
  pause(value) {
    game.paused = !!value;
  },
  setEars(left, right) {
    ears.L.lock = left;
    ears.R.lock = right;
    if (left !== null) lifeUniforms.uEarL.value = left;
    if (right !== null) lifeUniforms.uEarR.value = right;
  },
  setGaze(x, y) {
    gaze.x = x;
    gaze.y = y;
    gaze.tx = x;
    gaze.ty = y;
    lifeUniforms.uGaze.value.set(x, y);
  },
};
