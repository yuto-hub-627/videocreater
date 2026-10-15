import * as THREE from 'three';
import {
  WIDTH, HEIGHT, TITLE, STEPS, STEPS_START, STEP_LEN, FINALE_START, OUTRO_START, DURATION,
  CYCLE, captions, attacks, stepAt,
} from './timeline.js';

// ---------- 小道具 ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - clamp(k), 3);
const easeIn = (k) => Math.pow(clamp(k), 2);
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randDir(r) {
  const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
}
// 温度っぽい色：1=白, 0.7=黄, 0.4=橙, 0=赤
function fireColor(h) {
  const stops = [[0, [0.9, 0.12, 0.04]], [0.4, [1, 0.45, 0.08]], [0.7, [1, 0.8, 0.3]], [1, [1, 1, 0.92]]];
  h = clamp(h);
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const k = (h - a) / (b - a);
      return [lerp(ca[0], cb[0], k), lerp(ca[1], cb[1], k), lerp(ca[2], cb[2], k)];
    }
  }
  return stops[stops.length - 1][1];
}

// ---------- レンダラ ----------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const PLAYER = new THREE.Vector3(-2.0, 0, 0.9);
const ENEMY = new THREE.Vector3(1.7, 0, -1.0);
const CAP_R = 0.36, CAP_L = 0.56, CAP_H = CAP_L + CAP_R * 2;
const ATTACKS = attacks();
const MAX_PARTICLES = 6000;

const floorVert = `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const floorFrag = `
uniform vec3 uLight0; uniform float uLight0I;
uniform vec3 uLight1; uniform float uLight1I;
varying vec3 vWorld;
float line(float x, float w) { float d = abs(fract(x) - 0.5); return smoothstep(0.5 - w, 0.5, d); }
void main() {
  vec2 p = vWorld.xz / 0.55;
  float g = max(line(p.x, 0.035), line(p.y, 0.035));
  vec2 c = vWorld.xz - vec2(-0.1, -0.05);
  float fade = 1.0 - smoothstep(1.6, 4.2, length(c * vec2(0.85, 1.25)));
  vec3 base = vec3(0.10, 0.14, 0.26);
  vec3 col = base * 0.55 + vec3(0.42, 0.52, 0.78) * g * 0.55;
  float l0 = uLight0I / (1.0 + 3.0 * dot(vWorld - uLight0, vWorld - uLight0));
  float l1 = uLight1I / (1.0 + 3.0 * dot(vWorld - uLight1, vWorld - uLight1));
  col += vec3(1.0, 0.55, 0.2) * (l0 + l1) * (0.35 + g);
  gl_FragColor = vec4(col * fade, fade * 0.95);
}`;
const pointVert = `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  vColor = aColor; vAlpha = aAlpha;
  gl_Position = projectionMatrix * mv;
}`;
const pointFrag = `
varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.2);
  vec3 c = vColor * a * vAlpha;
  // 透明キャンバス上で加算合成するため、明るさをそのままアルファにする（乗算済みアルファ）
  gl_FragColor = vec4(c, clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0));
}`;

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const BLOB = blobTexture();

class World {
  constructor(name) {
    this.name = name;
    this.attacks = ATTACKS.filter((a) => a.world === name);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    this.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1530, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-3, 6, 4);
    this.scene.add(key);
    this.fireLight = new THREE.PointLight(0xff8a30, 0, 6, 1.5);
    this.scene.add(this.fireLight);
    this.hitLight = new THREE.PointLight(0xffa040, 0, 6, 1.5);
    this.scene.add(this.hitLight);

    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: floorVert, fragmentShader: floorFrag, transparent: true, depthWrite: false,
      uniforms: {
        uLight0: { value: new THREE.Vector3() }, uLight0I: { value: 0 },
        uLight1: { value: new THREE.Vector3() }, uLight1I: { value: 0 },
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const geo = new THREE.CapsuleGeometry(CAP_R, CAP_L, 8, 32);
    geo.translate(0, CAP_H / 2, 0);
    this.player = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xff7a1f, roughness: 0.45 }));
    this.enemyMat = new THREE.MeshStandardMaterial({ color: 0x7a68f2, roughness: 0.45 });
    this.enemy = new THREE.Mesh(geo, this.enemyMat);
    this.scene.add(this.player, this.enemy);

    const blobMat = new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false });
    this.playerShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), blobMat);
    this.enemyShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), blobMat.clone());
    for (const s of [this.playerShadow, this.enemyShadow]) { s.rotation.x = -Math.PI / 2; s.position.y = 0.005; this.scene.add(s); }

    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    pg.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    pg.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    this.pointMat = new THREE.ShaderMaterial({
      vertexShader: pointVert, fragmentShader: pointFrag, uniforms: { uScale: { value: 1000 } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.points = new THREE.Points(pg, this.pointMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.scene.add(this.points);
  }

  emit(p, col, size, alpha) {
    if (this.n >= MAX_PARTICLES || alpha <= 0.002) return;
    const i = this.n++;
    this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.y; this.pPos[i * 3 + 2] = p.z;
    this.pCol[i * 3] = col[0]; this.pCol[i * 3 + 1] = col[1]; this.pCol[i * 3 + 2] = col[2];
    this.pSize[i] = size;
    this.pAlpha[i] = alpha;
  }

  hand() { return PLAYER.clone().add(new THREE.Vector3(0.62, 0.8, -0.18)); }
  target() {
    const c = ENEMY.clone().add(new THREE.Vector3(0, 0.66, 0));
    return c.add(this.hand().sub(c).setY(0).normalize().multiplyScalar(CAP_R * 0.8));
  }
  pathAt(u) {
    const p = this.hand().lerp(this.target(), u);
    p.y += Math.sin(Math.PI * u) * 0.3;
    return p;
  }

  // ある時刻での HP（0..1）と、少し遅れて追いかける白いバー
  hpAt(t, seg) {
    const segAttacks = this.attacks.filter((a) => a.seg === seg);
    let hp = seg === 'fin' ? 0.3 : 1;
    for (const a of segAttacks) {
      if (t >= a.start + CYCLE.impact) hp -= a.kill ? 1 : a.crit ? 0.5 : 0.28;
    }
    return clamp(hp);
  }

  segAt(t) {
    if (this.name !== 'main') return 'intro';
    if (t >= OUTRO_START) return 'outro';
    if (t >= FINALE_START) return 'fin';
    return Math.max(0, stepAt(t));
  }

  update(t) {
    this.n = 0;
    let fireI = 0, hitI = 0, shake = 0;
    const firePos = new THREE.Vector3(), hitPos = new THREE.Vector3();

    // 待機モーション
    const breathe = 1 + 0.018 * Math.sin(t * 3.1);
    this.player.position.copy(PLAYER);
    this.player.rotation.set(0, 0, 0);
    this.player.scale.set(1, breathe, 1);
    this.enemy.position.copy(ENEMY);
    this.enemy.rotation.set(0, 0, 0);
    this.enemy.scale.set(1, 1 + 0.018 * Math.sin(t * 2.7 + 1), 1);
    this.enemy.visible = true;
    this.enemyMat.color.set(0x7a68f2);
    this.enemyMat.emissive.set(0x000000);
    this.enemyMat.emissiveIntensity = 1;
    this.ui = { dmg: [], sfx: [] };

    const dirFlat = ENEMY.clone().sub(PLAYER).setY(0).normalize();
    const side = new THREE.Vector3(-dirFlat.z, 0, dirFlat.x);

    this.attacks.forEach((a, ai) => {
      const tau = t - a.start;
      if (tau < 0 || tau > 3.6) return;
      const f = a.features;
      const seed = ai * 7919 + (this.name === 'top' ? 1 : this.name === 'bottom' ? 2 : 3) * 104729;
      const H = this.hand();
      const flightU = (tau - CYCLE.cast) / CYCLE.flight;
      const sinceHit = tau - CYCLE.impact;

      // プレイヤーの溜め→発射モーション
      if (tau < CYCLE.cast) {
        const k = tau / CYCLE.cast;
        this.player.rotation.z = 0.12 * easeOut(k);
      } else {
        const k = (tau - CYCLE.cast) / 0.35;
        this.player.rotation.z = lerp(-0.22, 0, easeOut(k)) * (k < 1 ? 1 : 0) + (k < 0.15 ? 0.12 * (1 - k / 0.15) : 0);
      }

      // 1. チャージ
      if (f.has('charge') && tau < CYCLE.cast + 0.05) {
        const r = rng(seed + 1);
        for (let i = 0; i < 70; i++) {
          const born = r() * (CYCLE.cast - 0.18);
          const life = 0.25 + r() * 0.15;
          const d = randDir(r);
          const r0 = 0.7 + r() * 0.8;
          const age = (tau - born) / life;
          if (age < 0 || age > 1) continue;
          const p = H.clone().addScaledVector(d, r0 * (1 - easeIn(age)));
          this.emit(p, fireColor(0.45 + 0.5 * age), 0.07 + 0.05 * age, 0.4 + 0.6 * age);
        }
        const k = clamp(tau / CYCLE.cast);
        this.emit(H, fireColor(0.6), 0.5 + 1.0 * k, 0.5 * k);
        fireI = Math.max(fireI, 1.2 * k); firePos.copy(H);
      }

      // 2. 弾（コアが無ければただの点）
      const coreSize = (k) => 0.35 + 0.05 * Math.sin(t * 40 + ai);
      if (f.has('core') && tau < CYCLE.cast) {
        const k = easeOut(tau / CYCLE.cast);
        if (f.has('charge')) {
          this.emit(H, fireColor(1), coreSize() * k, 1);
          this.emit(H, fireColor(0.55), 1.2 * k, 0.8 * k);
        }
      }
      if (flightU >= 0 && flightU <= 1) {
        const p = this.pathAt(flightU);
        if (f.has('core')) {
          this.emit(p, fireColor(1), coreSize(), 1);
          this.emit(p, fireColor(0.75), 0.75, 0.9);
          this.emit(p, fireColor(0.45), 1.6, 0.55);
          fireI = Math.max(fireI, 2.2); firePos.copy(p);
        } else {
          this.emit(p, [1, 0.62, 0.35], 0.16, 1);
          this.emit(p, [1, 0.5, 0.2], 0.24, 0.35);
        }
        // 3. トレイル
        if (f.has('trail')) {
          for (let k = 1; k <= 26; k++) {
            const u = flightU - k * 0.018;
            if (u < 0) break;
            const q = this.pathAt(u);
            const fall = k / 26;
            this.emit(q, fireColor(0.9 - fall * 0.8), (f.has('core') ? 0.55 : 0.3) * (1 - fall * 0.8), 0.9 * (1 - fall));
          }
        }
      }
      if (f.has('trail') && tau > CYCLE.cast && tau < CYCLE.impact + 0.5) {
        const r = rng(seed + 3);
        for (let i = 0; i < 90; i++) {
          const born = CYCLE.cast + r() * CYCLE.flight;
          const life = 0.22 + r() * 0.25;
          const age = (tau - born) / life;
          const v = randDir(r).multiplyScalar(0.6).add(new THREE.Vector3(0, 0.9, 0));
          if (age < 0 || age > 1 || tau > CYCLE.impact + 0.5) { r(); continue; }
          if (born > CYCLE.impact) continue;
          const p = this.pathAt((born - CYCLE.cast) / CYCLE.flight).addScaledVector(v, age * life);
          this.emit(p, fireColor(0.8 - age * 0.8), 0.22 * (1 - age * 0.6), 0.85 * (1 - age));
        }
      }

      // 着弾
      if (sinceHit >= 0) {
        const T = this.target();
        const hitDir = this.target().sub(this.pathAt(0.9)).normalize();

        // 4. バースト
        if (f.has('burst')) {
          const fk = sinceHit / 0.18;
          if (fk < 1) {
            this.emit(T, [1, 1, 0.95], 3.2 * (1 - fk * 0.5), 1 - fk);
            this.emit(T, fireColor(0.6), 5.0 * (1 - fk * 0.3), 0.6 * (1 - fk));
          }
          hitI = Math.max(hitI, 4 * Math.exp(-sinceHit * 9)); hitPos.copy(T);
          const r = rng(seed + 4);
          for (let i = 0; i < 70; i++) {
            const d = hitDir.clone().multiplyScalar(1.2).add(randDir(r)).normalize();
            const speed = 3 + r() * 5;
            const life = 0.25 + r() * 0.4;
            const age = sinceHit / life;
            if (age > 1) continue;
            const g = new THREE.Vector3(0, -6, 0);
            for (let s = 0; s < 3; s++) {
              const tt = Math.max(0, sinceHit - s * 0.012);
              const p = T.clone().addScaledVector(d, speed * tt * (1 - 0.35 * tt / life)).addScaledVector(g, 0.5 * tt * tt);
              this.emit(p, fireColor(0.95 - age * 0.5), 0.075, (1 - age) * (1 - s * 0.3));
            }
          }
        }

        // 5. リアクション
        if (f.has('reaction') && !a.kill) {
          const flash = clamp(1 - sinceHit / 0.12);
          if (flash > 0) { this.enemyMat.emissive.set(0xffffff); this.enemyMat.emissiveIntensity = flash * 1.4; }
          const kb = Math.exp(-sinceHit * 7) * Math.sin(Math.min(sinceHit * 22, Math.PI * 0.5 + sinceHit * 9));
          this.enemy.position.addScaledVector(dirFlat, 0.28 * kb);
          this.enemy.rotation.z += -0.35 * kb * Math.sign(dirFlat.x);
          const sq = Math.exp(-sinceHit * 10) * Math.cos(sinceHit * 30);
          this.enemy.scale.set(1 + 0.18 * sq, 1 - 0.18 * sq, 1 + 0.18 * sq);
          shake = Math.max(shake, 0.06 * Math.exp(-sinceHit * 14));
        }

        // 7. 余韻（敵が燃えて、じわっと鎮火）
        if (f.has('aftermath') && !a.kill && sinceHit < 2.2) {
          const burn = clamp(1 - sinceHit / 1.6);
          if (sinceHit > 0.12 || !f.has('reaction')) {
            this.enemyMat.emissive.set(0xff3a00);
            this.enemyMat.emissiveIntensity = 0.3 * burn * burn;
          }
          this.flames(seed + 7, sinceHit, 1.5, 140, 1, this.enemy.position);
          fireI = Math.max(fireI, 1.6 * burn); firePos.copy(this.enemy.position).setY(0.7);
        }

        // とどめ：灰になるまで燃やす
        if (a.kill) {
          const char = smooth(0.0, 0.8, sinceHit);
          this.enemyMat.color.setRGB(lerp(0.48, 0.07, char), lerp(0.41, 0.05, char), lerp(0.95, 0.06, char));
          this.enemyMat.emissive.set(0xff4a10);
          this.enemyMat.emissiveIntensity = 0.9 * Math.sin(Math.PI * clamp(sinceHit / 1.6)) * (0.8 + 0.2 * Math.sin(t * 30));
          const melt = smooth(0.8, 1.9, sinceHit);
          this.enemy.scale.set(1 + 0.25 * melt, Math.max(0.001, 1 - melt), 1 + 0.25 * melt);
          if (melt >= 1) this.enemy.visible = false;
          this.flames(seed + 8, sinceHit, 2.0, 260, 1.5, this.enemy.position);
          this.embers(seed + 9, sinceHit, this.enemy.position);
          fireI = Math.max(fireI, 2.5 * (1 - melt)); firePos.copy(this.enemy.position).setY(0.6);
        }

        // 8. ダメージ数値
        if (f.has('numbers') && this.name === 'main' && sinceHit < 1.0) {
          this.ui.dmg.push({ value: a.dmg, crit: !!a.crit, age: sinceHit });
        }
      }

      // 6. サウンド（擬音テロップ）
      if (a.sfxText) {
        if (tau >= CYCLE.cast - 0.05 && tau < CYCLE.cast + 0.6) this.ui.sfx.push({ kind: 'whoosh', age: tau - CYCLE.cast + 0.05 });
        if (sinceHit >= 0 && sinceHit < 0.75) this.ui.sfx.push({ kind: 'boom', age: sinceHit });
      }
    });

    // アウトロ：敵の復活
    if (this.name === 'main' && t >= FINALE_START + 2.0 && t < OUTRO_START + 0.15) this.enemy.visible = false;
    if (this.name === 'main' && t >= OUTRO_START + 0.15) {
      const k = clamp((t - OUTRO_START - 0.15) / 0.45);
      const s = k >= 1 ? 1 : 1 - Math.exp(-k * 6) * Math.cos(k * 12);
      this.enemy.scale.multiplyScalar(Math.max(0.001, s));
      this.enemy.visible = k > 0;
    }

    this.playerShadow.position.set(PLAYER.x, 0.005, PLAYER.z);
    this.enemyShadow.position.set(this.enemy.position.x, 0.005, this.enemy.position.z);
    this.enemyShadow.visible = this.enemy.visible;
    this.enemyShadow.scale.setScalar(Math.max(0.01, this.enemy.scale.x * Math.min(1, this.enemy.scale.y * 3)));

    this.fireLight.position.copy(firePos); this.fireLight.intensity = fireI * 3;
    this.hitLight.position.copy(hitPos); this.hitLight.intensity = hitI * 3;
    this.floorMat.uniforms.uLight0.value.copy(firePos).setY(0); this.floorMat.uniforms.uLight0I.value = fireI * 0.35;
    this.floorMat.uniforms.uLight1.value.copy(hitPos).setY(0); this.floorMat.uniforms.uLight1I.value = hitI * 0.35;

    for (const attr of ['position', 'aColor', 'aSize', 'aAlpha']) this.points.geometry.attributes[attr].needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
    this.shake = shake;
    this.side = side;

    const seg = this.segAt(t);
    this.hp = this.hpAt(t, seg);
    this.hpTrail = this.hpAt(t - 0.35, seg);
    if (seg === 'fin' && t - FINALE_START > 1.0) this.hpVisible = false;
    else if (seg === 'fin' || seg === 'outro') this.hpVisible = !(seg === 'outro' && t < OUTRO_START + 0.4);
    else this.hpVisible = true;
    if (seg === 'outro') { this.hp = this.hpAt(t, 'outro'); this.hpTrail = this.hpAt(t - 0.35, 'outro'); }
  }

  // 敵の表面から立ちのぼる炎。出現率は時間とともに減衰する
  flames(seed, since, dur, count, scale, base) {
    const r = rng(seed);
    for (let i = 0; i < count; i++) {
      const born = dur * (1 - Math.sqrt(1 - r()));
      const life = 0.35 + r() * 0.35;
      const ang = r() * Math.PI * 2;
      const y = 0.1 + r() * (CAP_H - 0.15);
      const rise = 0.7 + r() * 0.6;
      const wob = r() * 6;
      const age = (since - born) / life;
      if (age < 0 || age > 1) continue;
      const sy = this.enemy.scale.y;
      const p = new THREE.Vector3(
        base.x + Math.cos(ang) * CAP_R * (1.15 - 0.4 * age) * this.enemy.scale.x + Math.sin(wob + age * 5) * 0.05,
        y * sy + rise * age * life * scale * 1.6,
        base.z + Math.sin(ang) * CAP_R * (1.15 - 0.4 * age) * this.enemy.scale.x,
      );
      this.emit(p, fireColor(0.8 - age * 0.8), (0.36 * scale) * (1 - age * 0.6), 0.38 * (1 - age) * smooth(0, 0.2, age));
    }
  }

  embers(seed, since, base) {
    const r = rng(seed);
    for (let i = 0; i < 160; i++) {
      const born = 0.7 + r() * 1.4;
      const life = 0.8 + r() * 0.9;
      const d = new THREE.Vector3(r() - 0.5, 0, r() - 0.5);
      const y = r() * CAP_H;
      const age = (since - born) / life;
      if (age < 0 || age > 1) continue;
      const p = new THREE.Vector3(base.x + d.x * 0.9 + d.x * age * 1.2, y * 0.6 + age * (0.8 + r() * 0.8), base.z + d.z * 0.9 + d.z * age * 1.2);
      this.emit(p, fireColor(0.5 - age * 0.4), 0.06, (1 - age));
    }
    // 床に残る灰の火種
    const ash = clamp((since - 1.6) / 0.3) * clamp(1 - (since - 2.4) / 1.0);
    if (ash > 0) {
      const r2 = rng(seed + 1);
      for (let i = 0; i < 40; i++) {
        const p = new THREE.Vector3(base.x + (r2() - 0.5) * 0.8, 0.02, base.z + (r2() - 0.5) * 0.6);
        this.emit(p, fireColor(0.2 + 0.2 * Math.sin(since * 8 + i)), 0.07, ash * 0.9);
      }
    }
  }

  // rect: キャンバス上のピクセル矩形（上原点）。centerY: 注視点を rect 内のどこに置くか
  render(rect, opts = {}) {
    const { hfov = 46, centerY = 0.5, dist = 1 } = opts;
    const cam = this.camera;
    // 注視点を rect の centerY に置くため、仮想的に縦長のフレームを用意してずらす
    const vh = rect.h * 2 * Math.max(centerY, 1 - centerY);
    const offY = vh / 2 - rect.h * centerY;
    cam.aspect = rect.w / vh;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / cam.aspect));
    cam.setViewOffset(rect.w, vh, 0, offY, rect.w, rect.h);
    const look = new THREE.Vector3(-0.15, 0.45, 0);
    cam.position.set(0.3 * dist, 4.4 * dist, 7.6 * dist);
    if (this.shake) {
      cam.position.x += Math.sin(this.lastT * 97) * this.shake;
      cam.position.y += Math.cos(this.lastT * 83) * this.shake;
    }
    cam.lookAt(look);
    cam.updateProjectionMatrix();
    // setViewOffset で縦の画角は vh 基準になるため、1ワールド単位あたりのピクセル数は vh で決まる
    this.pointMat.uniforms.uScale.value = vh / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));

    renderer.setViewport(rect.x, HEIGHT - rect.y - rect.h, rect.w, rect.h);
    renderer.setScissor(rect.x, HEIGHT - rect.y - rect.h, rect.w, rect.h);
    renderer.render(this.scene, cam);
    this.rect = rect;
  }

  // ワールド座標 → ページ座標
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: this.rect.x + (p.x + 1) / 2 * this.rect.w, y: this.rect.y + (1 - p.y) / 2 * this.rect.h };
  }
}

const worlds = { top: new World('top'), bottom: new World('bottom'), main: new World('main') };

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const layer = $('layer');
const CAPS = captions();
const CPS = 15;

function typedCount(text, elapsed) {
  let tt = 0, n = 0;
  for (const ch of text) {
    if (tt > elapsed) break;
    n++;
    tt += ch === '…' ? 0.35 : ch === '\n' ? 0.05 : 1 / CPS;
  }
  return n;
}

function wavyPath(w, amp, waves, progress) {
  const pts = [];
  const steps = 120;
  for (let i = 0; i <= steps * progress; i++) {
    const x = (i / steps) * (w - 20) + 10;
    const y = 15 + Math.sin((i / steps) * Math.PI * 2 * waves) * amp;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

const dotsEl = $('dots');
for (let i = 0; i < 8; i++) {
  const d = document.createElement('div');
  d.className = 'dot';
  d.textContent = String(i + 1);
  dotsEl.appendChild(d);
}

const CAPTION_Y = { main: 1175, introTop: 845, introBottom: 1480 };

function caption(c, t) {
  if (t < c.at || t >= c.until) return '';
  const chars = [...c.text];
  const n = typedCount(c.text, t - c.at);
  let shown = chars.slice(0, n).join('');
  const out = Math.min(1, (c.until - t) / 0.12);
  let html = shown.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (c.goldLine) {
    const [a, b] = html.split('\n');
    html = b !== undefined ? `${a}\n<span class="gold">${b}</span>` : a;
  }
  if (c.emphasis) {
    const [a, b] = html.split('\n');
    html = b !== undefined ? `${a}\n<span class="em">${b}</span>` : a;
  }
  return `<div class="caption ${c.color}" style="top:${CAPTION_Y[c.pos]}px;opacity:${out}">${html}</div>`;
}

function hpBar(world, at) {
  if (!world.hpVisible || !world.enemy.visible) return '';
  const p = world.project(at);
  const low = world.hp < 0.36 ? ' low' : '';
  return `<div class="hp" style="left:${p.x}px;top:${p.y}px">
    <div class="trail" style="width:${world.hpTrail * 100}%"></div>
    <div class="fill${low}" style="width:${world.hp * 100}%"></div></div>`;
}

function popScale(age, from = 1.7) {
  const k = clamp(age / 0.14);
  return k >= 1 ? 1 : lerp(from, 1, easeOut(k));
}

function worldUI(world) {
  let html = hpBar(world, ENEMY.clone().add(new THREE.Vector3(0, CAP_H + 0.45, 0)));
  for (const d of world.ui.dmg) {
    const p = world.project(ENEMY.clone().add(new THREE.Vector3(-0.75, CAP_H - 0.05, 0.1)));
    const y = p.y - easeOut(d.age / 0.9) * 50;
    const op = clamp((1 - d.age) / 0.3);
    const tag = d.crit ? '<span class="tag">クリティカル！</span>' : '';
    html += `<div class="dmg${d.crit ? ' crit' : ''}" style="left:${p.x}px;top:${y - (d.crit ? 70 : 56)}px;opacity:${op};transform:scale(${popScale(d.age, d.crit ? 2.2 : 1.7)})">${tag}${d.value}</div>`;
  }
  for (const s of world.ui.sfx) {
    const isBoom = s.kind === 'boom';
    const anchor = isBoom ? ENEMY.clone().add(new THREE.Vector3(0.2, CAP_H + 0.2, 0)) : PLAYER.clone().add(new THREE.Vector3(0.5, CAP_H + 0.4, 0));
    const p = world.project(anchor);
    const life = isBoom ? 0.75 : 0.6;
    const op = clamp((life - s.age) / 0.2);
    const jitter = isBoom ? Math.sin(s.age * 90) * 6 * Math.exp(-s.age * 6) : 0;
    const rot = isBoom ? 8 : -12;
    const main = world.name === 'main';
    const scaleMul = main ? 1 : 0.65;
    html += `<div class="sfx ${s.kind}" style="left:${p.x + jitter + (isBoom ? 60 : -30)}px;top:${p.y - (isBoom ? (main ? 150 : 70) : (main ? 90 : 60)) - s.age * 30}px;opacity:${op};transform:rotate(${rot}deg) scale(${popScale(s.age) * scaleMul})">${isBoom ? 'ドーン！' : 'ヒュッ！'}</div>`;
  }
  return html;
}

function renderUI(t) {
  // ヘッダー
  const small = [...TITLE.small], big = [...TITLE.big];
  const ht = clamp(t / 0.35);
  $('title-small').textContent = small.slice(0, Math.ceil(ht * small.length)).join('');
  const bt = clamp((t - 0.2) / 0.7);
  $('title-big').textContent = big.slice(0, Math.ceil(bt * big.length)).join('');
  $('underline').querySelector('path').setAttribute('d', wavyPath(720, 3.5, 7, clamp((t - 0.7) / 0.5)));

  const intro = t < 5.0;
  $('divider').style.display = intro ? 'block' : 'none';
  $('divider').querySelector('path').setAttribute('d', wavyPath(760, 5, 6, clamp((t - 0.1) / 0.6)));

  // ステップ表示
  const step = stepAt(t);
  const label = $('step-label');
  if (step >= 0) {
    const age = t - (STEPS_START + step * STEP_LEN);
    label.style.display = 'flex';
    label.style.transform = `scale(${popScale(age, 1.5)})`;
    label.querySelector('.num').textContent = String(step + 1);
    label.querySelector('.name').textContent = STEPS[step].name;
  } else {
    label.style.display = 'none';
  }

  const showDots = t >= 6.0 && t < OUTRO_START;
  dotsEl.style.opacity = showDots ? clamp((t - 6.0) / 0.4) : 0;
  [...dotsEl.children].forEach((d, i) => {
    const s = t >= FINALE_START ? 8 : step;
    d.className = 'dot' + (i === s ? ' on' : i < s ? ' done' : '');
    const age = t - (STEPS_START + i * STEP_LEN);
    d.style.transform = i === s && step >= 0 ? `scale(${popScale(age, 1.4)})` : 'scale(1)';
  });

  // テロップと3D連動UI
  let html = CAPS.map((c) => caption(c, t)).join('');
  if (intro) html += worldUI(worlds.top) + worldUI(worlds.bottom);
  else html += worldUI(worlds.main);
  layer.innerHTML = html;

  const bm = $('bookmark');
  const bmAge = t - (OUTRO_START + 1.4);
  bm.style.display = bmAge >= 0 ? 'block' : 'none';
  bm.style.transform = `translateY(${(1 - easeOut(bmAge / 0.3)) * -60}px) scale(${popScale(bmAge, 1.4)})`;
  bm.style.opacity = clamp(bmAge / 0.15);

  // イントロ→本編の暗転
  $('fade').style.opacity = clamp(1 - Math.abs(t - 5.0) / 0.18) * 0.95;
}

const INTRO_TOP = { x: 0, y: 545, w: WIDTH, h: 380 };
const INTRO_BOTTOM = { x: 0, y: 975, w: WIDTH, h: 470 };
const MAIN = { x: 0, y: 0, w: WIDTH, h: HEIGHT };

function renderAt(t) {
  t = clamp(t, 0, DURATION - 1e-4);
  renderer.setScissorTest(true);
  renderer.setScissor(0, 0, WIDTH, HEIGHT);
  renderer.clear();
  if (t < 5.0) {
    for (const [w, rect, cy] of [[worlds.top, INTRO_TOP, 0.55], [worlds.bottom, INTRO_BOTTOM, 0.5]]) {
      w.lastT = t;
      w.update(t);
      w.render(rect, { hfov: 44, centerY: cy, dist: 1.0 });
    }
  } else {
    const w = worlds.main;
    w.lastT = t;
    w.update(t);
    w.render(MAIN, { hfov: 41, centerY: 0.465, dist: 1.0 });
  }
  renderUI(t);
}

// サウンド生成用のイベント一覧（秒）
function audioEvents() {
  const ev = [];
  for (const a of ATTACKS) {
    if (!a.sound) continue;
    const f = a.features;
    const vol = a.world === 'bottom' ? 0.8 : 1;
    if (f.has('charge')) ev.push({ type: 'charge', t: a.start, vol });
    ev.push({ type: 'whoosh', t: a.start + CYCLE.cast, vol });
    ev.push({ type: a.kill ? 'bigboom' : 'boom', t: a.start + CYCLE.impact, vol });
    if (f.has('aftermath')) ev.push({ type: 'crackle', t: a.start + CYCLE.impact, dur: a.kill ? 2.4 : 1.5, vol });
    if (a.crit) ev.push({ type: 'crit', t: a.start + CYCLE.impact, vol });
  }
  for (let i = 0; i < STEPS.length; i++) ev.push({ type: 'pop', t: STEPS_START + i * STEP_LEN, vol: 1 });
  ev.push({ type: 'swoosh', t: 4.85, vol: 1 });
  ev.push({ type: 'pop', t: FINALE_START, vol: 1 });
  ev.push({ type: 'ding', t: OUTRO_START + 1.4, vol: 1 });
  for (const c of CAPS) ev.push({ type: 'type', t: c.at, dur: Math.min(1.6, [...c.text].length / CPS), vol: 0.5 });
  return ev;
}

window.VIDEO = { renderAt, audioEvents, duration: DURATION, ready: document.fonts.ready.then(() => document.fonts.load('60px "Yusei Magic"', 'あ魔法')) };

// プレビュー: ?t=秒 で静止、指定なしならリアルタイム再生
const params = new URLSearchParams(location.search);
if (!params.has('capture')) {
  if (params.has('t')) {
    window.VIDEO.ready.then(() => renderAt(parseFloat(params.get('t'))));
  } else {
    const t0 = performance.now();
    const loop = () => { renderAt(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); };
    window.VIDEO.ready.then(loop);
  }
}
