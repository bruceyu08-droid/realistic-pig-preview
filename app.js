import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODEL_URL = "./models/pig.glb";

// Principal body axis in the original mesh (from vertex PCA).
const FORWARD = new THREE.Vector3(0.408127, 0.0, 0.912925);
const SIDE = new THREE.Vector3(0.912925, 0.0, -0.408127);
const AXIS_ORIGIN = new THREE.Vector3(0.0344, 0.0, 0.037);

const pokeUniforms = {
  uPokePos: { value: new THREE.Vector3(0, 0.25, 0) },
  uPokeDir: { value: new THREE.Vector3(0, -1, 0) },
  uPokeAmp: { value: 0 },
  uPokeSig: { value: 0.14 },
  uJiggle: { value: 0 },
  uNudge: { value: new THREE.Vector3() },
};

const poke = {
  amp: 0,
  vel: 0,
  target: 0,
  jiggle: 0,
  jiggleVel: 0,
  jiggleTarget: 0,
  grabbing: false,
  pointerId: null,
};

const nudge = {
  current: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  target: new THREE.Vector3(),
};

let lastAzimuth = 0;
let lastPolar = 0;
let pigRoot = null;
const pigMeshes = [];

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe2e0dd);
scene.fog = new THREE.Fog(0xe2e0dd, 3.8, 9.5);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 40);
camera.position.set(1.35, 0.92, 2.35);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.05;
controls.maxDistance = 5.4;
controls.minPolarAngle = 0.18;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 0.38, 0);
controls.update();
lastAzimuth = controls.getAzimuthalAngle();
lastPolar = controls.getPolarAngle();

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
pmrem.dispose();

const hemi = new THREE.HemisphereLight(0xf2f3f5, 0x8a8680, 0.4);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff3e8, 2.15);
key.position.set(2.3, 3.4, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 14;
key.shadow.camera.left = -2.4;
key.shadow.camera.right = 2.4;
key.shadow.camera.top = 2.4;
key.shadow.camera.bottom = -2.4;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.025;
key.shadow.radius = 5;
scene.add(key);

const fill = new THREE.DirectionalLight(0xe6eef6, 0.65);
fill.position.set(-2.6, 1.5, 1.2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xf7f4ee, 0.85);
rim.position.set(-1.4, 2.6, -3.2);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(10, 80),
  new THREE.MeshStandardMaterial({
    color: 0xc4c2bf,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.18,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = "ground";
scene.add(ground);

const SOFT_SKIN_GLSL = /* glsl */ `
uniform vec3 uPokePos;
uniform vec3 uPokeDir;
uniform float uPokeAmp;
uniform float uPokeSig;
uniform float uJiggle;
uniform vec3 uNudge;

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
`;

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

function applySoftSkin(material) {
  material.metalness = 0;
  material.metalnessMap = null;
  material.envMapIntensity = 0.62;
  material.roughness = Math.max(material.roughness ?? 0.55, 0.42);
  if (material.normalScale) material.normalScale.set(0.85, 0.85);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPokePos = pokeUniforms.uPokePos;
    shader.uniforms.uPokeDir = pokeUniforms.uPokeDir;
    shader.uniforms.uPokeAmp = pokeUniforms.uPokeAmp;
    shader.uniforms.uPokeSig = pokeUniforms.uPokeSig;
    shader.uniforms.uJiggle = pokeUniforms.uJiggle;
    shader.uniforms.uNudge = pokeUniforms.uNudge;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\n" + SOFT_SKIN_GLSL,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      {
        float w = softMask(transformed);
        vec3 rel = transformed - uPokePos;
        float fall = exp(-dot(rel, rel) / max(2.0 * uPokeSig * uPokeSig, 1e-5));
        vec3 down = vec3(0.0, -1.0, 0.0);
        transformed += uPokeDir * uPokeAmp * fall * w;
        transformed += w * (down * uJiggle + uNudge);
      }`,
    );
  };
  material.customProgramCacheKey = () => "pig-soft-skin-v1";
  material.needsUpdate = true;
}

function framePig(root) {
  const heading = Math.atan2(FORWARD.x, FORWARD.z);
  root.rotation.y = -heading;
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -box.min.y, -center.z);
  const framed = new THREE.Box3().setFromObject(root);
  const size = framed.getSize(new THREE.Vector3());
  const mid = framed.getCenter(new THREE.Vector3());
  controls.target.set(mid.x, mid.y * 0.92, mid.z);
  const dist = Math.max(size.x, size.y, size.z) * 1.55;
  camera.position.set(mid.x + dist * 0.48, mid.y + dist * 0.34, mid.z + dist * 0.86);
  controls.update();
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
      applySoftSkin(mat);
      if (mat.map) {
        mat.map.anisotropy = 8;
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }
      if (mat.normalMap) mat.normalMap.anisotropy = 8;
      if (mat.roughnessMap) mat.roughnessMap.anisotropy = 8;
    });
    pigMeshes.push(obj);
  });
  framePig(root);
  scene.add(root);
  pigRoot = root;
}

const loader = new GLTFLoader();
loader.load(
  MODEL_URL,
  (gltf) => {
    prepareModel(gltf);
    document.body.classList.add("is-ready");
    window.__PIG_READY__ = true;
  },
  undefined,
  (err) => {
    const el = document.getElementById("loading");
    if (el) el.textContent = "模型载入失败。请用本地 HTTP 打开本页（运行 ./serve.sh）。";
    console.error(err);
  },
);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const _world = new THREE.Vector3();
const _local = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _invMat = new THREE.Matrix4();
const _normalMat = new THREE.Matrix3();

function eventNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function hitPig(event) {
  if (!pigRoot) return null;
  eventNdc(event);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pigMeshes, false);
  return hits.length ? hits[0] : null;
}

function beginPoke(hit, event) {
  const mesh = hit.object;
  _invMat.copy(mesh.matrixWorld).invert();
  _local.copy(hit.point).applyMatrix4(_invMat);
  _normalMat.getNormalMatrix(_invMat);
  if (hit.face) {
    _normal.copy(hit.face.normal).applyMatrix3(_normalMat).normalize();
  } else {
    _normal.copy(hit.normal || new THREE.Vector3(0, 1, 0)).normalize();
  }
  pokeUniforms.uPokePos.value.copy(_local);
  pokeUniforms.uPokeDir.value.copy(_normal).multiplyScalar(-1).normalize();
  const softness = Math.max(0.18, softMaskCpu(_local));
  poke.target = 0.009 * softness;
  poke.jiggleTarget = softness > 0.25 ? 0.0025 : 0.004;
  poke.grabbing = true;
  poke.pointerId = event.pointerId;
  pokeUniforms.uPokeSig.value = softness > 0.35 ? 0.16 : 0.13;
  controls.enableRotate = false;
  controls.enablePan = false;
  renderer.domElement.style.cursor = "grabbing";
}

function updatePokeDrag(event) {
  const hit = hitPig(event);
  if (hit) {
    const mesh = hit.object;
    _invMat.copy(mesh.matrixWorld).invert();
    _local.copy(hit.point).applyMatrix4(_invMat);
    pokeUniforms.uPokePos.value.lerp(_local, 0.35);
    if (hit.face) {
      _normalMat.getNormalMatrix(_invMat);
      _normal.copy(hit.face.normal).applyMatrix3(_normalMat).normalize();
      pokeUniforms.uPokeDir.value.lerp(_normal.multiplyScalar(-1), 0.25).normalize();
    }
    const softness = Math.max(0.18, softMaskCpu(_local));
    poke.target = Math.min(0.014, 0.01 * softness + 0.003);
  } else {
    poke.target = Math.min(poke.target, 0.006);
  }
}

function endPoke() {
  if (!poke.grabbing) return;
  poke.grabbing = false;
  poke.pointerId = null;
  poke.target = 0;
  poke.jiggleTarget = 0;
  controls.enableRotate = true;
  controls.enablePan = true;
  renderer.domElement.style.cursor = "grab";
}

function onPointerDown(event) {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  if (poke.grabbing) return;
  const hit = hitPig(event);
  if (hit) {
    event.preventDefault();
    try {
      renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    beginPoke(hit, event);
  }
}

function onPointerMove(event) {
  if (!poke.grabbing || event.pointerId !== poke.pointerId) return;
  event.preventDefault();
  updatePokeDrag(event);
}

function onPointerUp(event) {
  if (event.pointerId !== poke.pointerId) return;
  endPoke();
  try {
    renderer.domElement.releasePointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }
}

function onPointerCancel(event) {
  if (event.pointerId !== poke.pointerId && poke.pointerId !== null) return;
  endPoke();
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerCancel);
renderer.domElement.addEventListener("lostpointercapture", endPoke);
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
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
  if (poke.grabbing) {
    poke.amp += (poke.target - poke.amp) * (1 - Math.exp(-14 * dt));
    poke.vel = 0;
    poke.jiggle += (poke.jiggleTarget - poke.jiggle) * (1 - Math.exp(-10 * dt));
    poke.jiggleVel = 0;
  } else {
    const acc = -2 * DAMP * STIFF * poke.vel - STIFF * STIFF * (poke.amp - poke.target);
    poke.vel += acc * dt;
    poke.amp += poke.vel * dt;
    const jAcc = -2 * JIGGLE_DAMP * JIGGLE_STIFF * poke.jiggleVel - JIGGLE_STIFF * JIGGLE_STIFF * (poke.jiggle - poke.jiggleTarget);
    poke.jiggleVel += jAcc * dt;
    poke.jiggle += poke.jiggleVel * dt;
  }
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
  // Soft tissue lags slightly behind a camera nudge, like loose fat.
  nudge.target
    .copy(_camRight)
    .multiplyScalar(-dAz * 0.55)
    .addScaledVector(_camUp, dPol * 0.35);
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

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  controls.update();
  if (pigRoot) stepSoftBody(dt);
  renderer.render(scene, camera);
}

animate();

window.__pigSetView = (name) => {
  const t = controls.target;
  if (name === "front") {
    camera.position.set(t.x + 0.12, t.y + 0.22, t.z + 1.55);
  } else if (name === "side") {
    camera.position.set(t.x + 1.65, t.y + 0.32, t.z + 0.12);
  } else if (name === "threeQuarter") {
    camera.position.set(t.x + 0.95, t.y + 0.48, t.z + 1.45);
  } else if (name === "close") {
    camera.position.set(t.x + 0.62, t.y + 0.26, t.z + 1.28);
  }
  controls.update();
  lastAzimuth = controls.getAzimuthalAngle();
  lastPolar = controls.getPolarAngle();
};
