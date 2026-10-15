// フレームを1枚ずつ描画して ffmpeg に流し込み、無音の動画を作る。
//   node scripts/render.js                 → out/video.mp4（無音）+ out/events.json
//   node scripts/render.js --stills 1,12   → out/still-1.png, out/still-12.png
//   node scripts/render.js --from 20 --to 25
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from './serve.js';
import { FPS } from '../src/timeline.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

mkdirSync('out', { recursive: true });
const { server, url } = await startServer(0);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(`${url}/src/index.html?capture=1`);
await page.waitForFunction(() => window.VIDEO);
await page.evaluate(() => window.VIDEO.ready);
const duration = await page.evaluate(() => window.VIDEO.duration);

async function frame(t) {
  await page.evaluate((tt) => window.VIDEO.renderAt(tt), t);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });
}

if (opt('--stills')) {
  for (const s of opt('--stills').split(',')) {
    writeFileSync(`out/still-${s}.png`, await frame(parseFloat(s)));
    console.log(`out/still-${s}.png`);
  }
} else {
  const events = await page.evaluate(() => window.VIDEO.audioEvents());
  writeFileSync('out/events.json', JSON.stringify({ duration, events }, null, 1));

  const from = parseFloat(opt('--from') ?? '0');
  const to = Math.min(duration, parseFloat(opt('--to') ?? String(duration)));
  const output = opt('--out') ?? 'out/video.mp4';
  const ff = spawn('ffmpeg', [
    '-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', output,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const total = Math.round((to - from) * FPS);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const buf = await frame(from + i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 30 === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`frame ${i}/${total}  ${el.toFixed(0)}s elapsed, ~${((el / (i + 1)) * (total - i)).toFixed(0)}s left`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`wrote ${output}`);
}

await browser.close();
server.close();
