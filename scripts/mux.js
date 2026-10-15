// 無音の動画と音声を合わせて最終版を書き出す。
import { spawnSync } from 'node:child_process';

const r = spawnSync('ffmpeg', [
  '-y', '-v', 'error', '-i', 'out/video.mp4', '-i', 'out/audio.wav',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  'out/magic-attack-ja.mp4',
], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('wrote out/magic-attack-ja.mp4');
