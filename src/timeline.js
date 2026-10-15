// 動画全体の台本とタイミング。シーン描画・テロップ・効果音はすべてここを参照する。

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const TITLE = { small: 'ゲーム制作', big: '魔法攻撃のつくりかた！' };

// 各ステップで追加される演出（累積で効いていく）
export const FEATURES = ['charge', 'core', 'trail', 'burst', 'reaction', 'sound', 'aftermath', 'numbers'];

export const STEP_LEN = 5.0;
export const STEPS_START = 7.0;

export const STEPS = [
  { name: 'チャージ！', good: '撃つ前に…\n空気から炎を集める！', bad: 'でも、投げるものが\nなにもない。' },
  { name: 'コア！', good: '手の中でふくらむ…\n熱い火の玉！', bad: 'でも飛んでる間は\nただの点。' },
  { name: 'トレイル！', good: 'うしろになびく…\n炎のしっぽ！', bad: 'でも当たっても\n枕みたいにふんわり。' },
  { name: 'バースト！', good: '閃光と…\n敵を突きぬける火花！', bad: 'でも敵は\nまったく効いてない。' },
  { name: 'リアクション！', good: '白く光らせて…\nのけぞらせる！', bad: 'でも目をそらすと\n当たったか分からない。' },
  { name: 'サウンド！', good: '撃つときにヒュッ…\n当たればドーン！', bad: 'でもまばたきしたら\nもう無傷に見える。' },
  { name: '余韻！', good: '敵を燃やして…\nじわっと消していく！', bad: 'でもどれだけ効いたか\n分からない。' },
  { name: 'ダメージ数値！', good: '小さく、パンチよく…\nクリティカルは大きく！', bad: null },
];

export const FINALE_START = STEPS_START + STEP_LEN * STEPS.length; // 47
export const OUTRO_START = FINALE_START + 3.6;
export const DURATION = OUTRO_START + 3.6;

// 攻撃1回分のタイミング（サイクル内のローカル時間）
export const CYCLE = { cast: 0.6, flight: 0.42, length: 2.5 };
CYCLE.impact = CYCLE.cast + CYCLE.flight;

// テロップ。at から1文字ずつタイプされ、until で消える。
export function captions() {
  const list = [];
  list.push({ id: 'intro-bad', text: '手ごたえゼロ。', color: 'bad', at: 1.0, until: 4.8, pos: 'introTop' });
  list.push({ id: 'intro-good', text: 'これぞ魔法！', color: 'good', at: 1.9, until: 4.8, pos: 'introBottom' });
  list.push({ id: 'diff', text: 'その差は…\n8つのステップ！', color: 'gold', at: 5.1, until: 6.9, pos: 'main', emphasis: 1 });
  STEPS.forEach((s, i) => {
    const t0 = STEPS_START + i * STEP_LEN;
    if (s.bad) {
      list.push({ id: `s${i}-good`, text: s.good, color: 'good', at: t0 + 0.35, until: t0 + 2.75, pos: 'main' });
      list.push({ id: `s${i}-bad`, text: s.bad, color: 'bad', at: t0 + 2.85, until: t0 + STEP_LEN - 0.05, pos: 'main' });
    } else {
      list.push({ id: `s${i}-good`, text: s.good, color: 'good', at: t0 + 0.35, until: t0 + STEP_LEN - 0.05, pos: 'main' });
    }
  });
  list.push({ id: 'fin', text: 'HPゼロ？\n灰になるまで燃やせ！', color: 'good', at: FINALE_START + 0.2, until: OUTRO_START - 0.05, pos: 'main', goldLine: 1 });
  list.push({ id: 'save', text: '保存して\nあとで見返そう！', color: 'gold', at: OUTRO_START + 0.3, until: DURATION, pos: 'main' });
  return list;
}

// 画面に出ている攻撃サイクルの一覧。features は有効な演出の集合。
export function attacks() {
  const all = new Set(FEATURES);
  const list = [];
  // イントロ：上は演出なし、下はフル演出
  for (const start of [0.35, 2.6]) {
    list.push({ world: 'top', seg: 'intro', start, features: new Set(), dmg: 0 });
    list.push({ world: 'bottom', seg: 'intro', start, features: all, dmg: 0, sound: true, sfxText: true });
  }
  STEPS.forEach((s, i) => {
    const t0 = STEPS_START + i * STEP_LEN;
    const features = new Set(FEATURES.slice(0, i + 1));
    const sound = i >= 5;
    const sfxText = i === 5;
    list.push({ world: 'main', seg: i, start: t0 + 0.2, features, sound, sfxText, dmg: 26 + i });
    list.push({ world: 'main', seg: i, start: t0 + 2.6, features, sound, sfxText, dmg: i === 7 ? 121 : 28 + i, crit: i === 7 });
  });
  list.push({ world: 'main', seg: 'fin', start: FINALE_START, features: all, sound: true, dmg: 34, kill: true });
  list.push({ world: 'main', seg: 'outro', start: OUTRO_START + 0.7, features: all, sound: true, dmg: 32 });
  return list;
}

// 現在のステップ番号（0始まり、範囲外は -1）
export function stepAt(t) {
  if (t < STEPS_START || t >= FINALE_START) return -1;
  return Math.floor((t - STEPS_START) / STEP_LEN);
}
