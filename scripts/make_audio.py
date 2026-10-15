"""BGM と効果音を numpy だけで合成して out/audio.wav を作る。

out/events.json（render.js が書き出す）のタイミングに合わせて効果音を置く。
"""
import json
import wave
from pathlib import Path

import numpy as np

SR = 44100
rng = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def env(n, attack, release):
    """attack 秒で立ち上がり、release 秒の指数減衰。"""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / max(release, 1e-4))


def band(x, lo, hi):
    """FFT でバンドパス（lo/hi は Hz）。"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    mask = np.clip((f - lo * 0.7) / (lo * 0.3 + 1e-9), 0, 1) * np.clip((hi * 1.3 - f) / (hi * 0.3), 0, 1)
    return np.fft.irfft(X * mask, len(x))


def sweep_noise(dur, f0, f1, width=0.6):
    """中心周波数が f0→f1 に動くノイズ（短いチャンクを重ねて近似）。"""
    n = int(dur * SR)
    out = np.zeros(n)
    hop = 512
    win = np.hanning(hop * 2)
    noise = rng.standard_normal(n + hop * 2)
    for i in range(0, n, hop):
        k = i / n
        fc = f0 * (f1 / f0) ** k
        seg = band(noise[i:i + hop * 2], fc * (1 - width / 2), fc * (1 + width / 2)) * win
        end = min(n, i + hop * 2)
        out[i:end] += seg[: end - i]
    return out / (np.abs(out).max() + 1e-9)


def sine_sweep(dur, f0, f1):
    t = t_axis(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# ---------- 効果音 ----------
def sfx_charge(dur=0.6):
    n = int(dur * SR)
    s = sweep_noise(dur, 400, 3000, 0.5) * 0.5 + sine_sweep(dur, 180, 720) * 0.35
    rise = np.linspace(0, 1, n) ** 1.6
    return s * rise * 0.5


def sfx_whoosh():
    dur = 0.45
    n = int(dur * SR)
    s = sweep_noise(dur, 1800, 500, 0.8)
    e = np.sin(np.pi * np.clip(np.arange(n) / n, 0, 1)) ** 1.5
    return s * e * 0.7


def sfx_boom(big=False):
    dur = 1.6 if big else 0.8
    n = int(dur * SR)
    body = sine_sweep(dur, 110, 38) * env(n, 0.003, 0.35 if big else 0.18)
    noise = band(rng.standard_normal(n), 60, 1800) * env(n, 0.001, 0.25 if big else 0.08)
    noise /= np.abs(noise).max() + 1e-9
    click = band(rng.standard_normal(n), 2000, 9000) * env(n, 0.0005, 0.012)
    click /= np.abs(click).max() + 1e-9
    s = body * 1.0 + noise * 0.6 + click * 0.35
    return np.tanh(s * 1.6) * (0.95 if big else 0.8)


def sfx_crackle(dur):
    n = int(dur * SR)
    s = np.zeros(n)
    t = np.arange(n) / SR
    density = 70 * np.exp(-t / (dur * 0.45))
    pos = np.nonzero(rng.random(n) < density / SR)[0]
    pop = band(rng.standard_normal(400), 1500, 8000) * env(400, 0.0002, 0.002)
    for p in pos:
        end = min(n, p + len(pop))
        s[p:end] += pop[: end - p] * rng.uniform(0.2, 1)
    roar = band(rng.standard_normal(n), 80, 700)
    roar /= np.abs(roar).max() + 1e-9
    fade = np.exp(-t / (dur * 0.4))
    return (s * 0.5 + roar * 0.25) * fade


def bell(freqs, dur, decay):
    n = int(dur * SR)
    t = t_axis(dur)
    s = sum(np.sin(2 * np.pi * f * t) * (0.6 ** i) for i, f in enumerate(freqs))
    return s * env(n, 0.002, decay)


def sfx_crit():
    a = bell([1318, 2636], 0.5, 0.12)
    b = bell([1760, 3520], 0.6, 0.18)
    out = np.zeros(len(a) + int(0.07 * SR) + len(b))
    out[: len(a)] += a
    out[int(0.07 * SR): int(0.07 * SR) + len(b)] += b
    return out * 0.35


def sfx_pop():
    dur = 0.12
    return sine_sweep(dur, 500, 1100) * env(int(dur * SR), 0.002, 0.04) * 0.4


def sfx_swoosh():
    dur = 0.4
    n = int(dur * SR)
    return sweep_noise(dur, 600, 2600, 0.7) * np.sin(np.pi * np.arange(n) / n) * 0.35


def sfx_ding():
    return bell([1046.5, 1568, 2093], 1.2, 0.35) * 0.4


def sfx_type(dur):
    n = int(dur * SR)
    s = np.zeros(n)
    tick = band(rng.standard_normal(600), 2500, 7000) * env(600, 0.0003, 0.004)
    tick /= np.abs(tick).max() + 1e-9
    step = int(SR / 15)
    for p in range(0, n, step):
        end = min(n, p + len(tick))
        s[p:end] += tick[: end - p] * rng.uniform(0.5, 1)
    return s * 0.12


# ---------- BGM ----------
BPM = 96
BEAT = 60 / BPM
NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
# Am - F - C - G（各1小節）
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]


def pad_voice(freq, dur):
    t = t_axis(dur)
    s = sum(np.sin(2 * np.pi * freq * k * t + k) / k ** 1.4 for k in range(1, 6))
    s += 0.5 * np.sin(2 * np.pi * freq * 1.004 * t)
    n = len(t)
    a = np.clip(t / 0.4, 0, 1) * np.clip((dur - t) / 0.5, 0, 1)
    return s * a / n ** 0 * 0.12


def pluck(freq, dur=0.5):
    n = int(dur * SR)
    t = t_axis(dur)
    s = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)
    return s * env(n, 0.003, 0.14) * 0.16


def kick():
    dur = 0.35
    return sine_sweep(dur, 120, 45) * env(int(dur * SR), 0.002, 0.09) * 0.5


def hat():
    dur = 0.06
    n = int(dur * SR)
    h = band(rng.standard_normal(n), 6000, 15000)
    return h / (np.abs(h).max() + 1e-9) * env(n, 0.0005, 0.015) * 0.08


def place(buf, clip, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf) or i + len(clip) <= 0:
        return
    j = max(0, -i)
    end = min(len(buf), i + len(clip))
    buf[max(i, 0):end] += clip[j: j + end - max(i, 0)] * gain


def make_bgm(duration):
    buf = np.zeros(int(duration * SR) + SR)
    bar = BEAT * 4
    nbars = int(duration / bar) + 1
    arp_pattern = [0, 1, 2, 1, 2, 0, 1, 2]
    for b in range(nbars):
        chord = CHORDS[b % 4]
        t0 = b * bar
        for m in chord:
            place(buf, pad_voice(NOTE(m), bar + 0.4), t0)
        place(buf, pad_voice(NOTE(chord[0] - 12), bar + 0.4), t0, 0.9)
        for i, idx in enumerate(arp_pattern):
            place(buf, pluck(NOTE(chord[idx] + 12)), t0 + i * BEAT / 2)
        if b >= 1:  # 1小節目はドラムなし
            for k in range(4):
                if k in (0, 2):
                    place(buf, kick(), t0 + k * BEAT)
                place(buf, hat(), t0 + k * BEAT + BEAT / 2)
    # ゆっくりフェードイン・アウト
    t = np.arange(len(buf)) / SR
    buf *= np.clip(t / 0.8, 0, 1) * np.clip((duration - t) / 1.5, 0, 1)
    return buf


def main():
    data = json.loads(Path('out/events.json').read_text())
    duration = data['duration']
    n = int(duration * SR)
    sfx = np.zeros(n + SR * 3)
    duck = np.zeros(n + SR * 3)  # 衝撃音のときに BGM を少し下げる

    for e in data['events']:
        typ, at, vol = e['type'], e['t'], e.get('vol', 1)
        if typ == 'charge':
            clip = sfx_charge()
        elif typ == 'whoosh':
            clip = sfx_whoosh()
        elif typ in ('boom', 'bigboom'):
            clip = sfx_boom(typ == 'bigboom')
            place(duck, np.exp(-np.arange(int(0.6 * SR)) / SR / 0.25), at)
        elif typ == 'crackle':
            clip = sfx_crackle(e['dur'])
        elif typ == 'crit':
            clip = sfx_crit()
        elif typ == 'pop':
            clip = sfx_pop()
        elif typ == 'swoosh':
            clip = sfx_swoosh()
        elif typ == 'ding':
            clip = sfx_ding()
        elif typ == 'type':
            clip = sfx_type(e['dur'])
        else:
            continue
        place(sfx, clip, at, vol)

    bgm = make_bgm(duration)[: len(sfx)]
    bgm = np.pad(bgm, (0, len(sfx) - len(bgm)))
    bgm *= 1 - 0.5 * np.clip(duck, 0, 1)
    mix = bgm * 0.55 + sfx
    mix = mix[:n]
    mix = np.tanh(mix * 1.1)
    mix /= np.abs(mix).max() + 1e-9
    mix *= 0.89  # 約 -1 dBFS

    # ほんの少しだけ左右に広げる（BGM を遅延させた疑似ステレオ）
    d = int(0.012 * SR)
    left = mix
    right = np.concatenate([mix[:d], mix[:-d]]) * 0.15 + mix * 0.85
    stereo = np.stack([left, right], axis=1)
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open('out/audio.wav', 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f'wrote out/audio.wav ({duration:.2f}s)')


if __name__ == '__main__':
    main()
