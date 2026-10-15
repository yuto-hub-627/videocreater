# videocreater

Instagram リール用の縦型動画（1080×1920 / 30fps）をコードで作るプロジェクト。

## 魔法攻撃のつくりかた（日本語版）

ゲームの魔法攻撃を「気持ちよく」する 8 ステップを、オレンジ（プレイヤー）と紫（敵）のカプセルで見せる約 54 秒のリール。
3D シーン（three.js）・テロップ・BGM/効果音はすべてこのリポジトリ内で生成している。

完成版: `output/magic-attack-ja.mp4`

| 時間 | 内容 |
| --- | --- |
| 0–5s | 比較（上：手ごたえゼロ / 下：これぞ魔法！） |
| 5–7s | その差は… 8つのステップ！ |
| 7–47s | ①チャージ ②コア ③トレイル ④バースト ⑤リアクション ⑥サウンド ⑦余韻 ⑧ダメージ数値（各5秒、演出が累積） |
| 47–50.6s | HPゼロ？ 灰になるまで燃やせ！ |
| 50.6–54.2s | 保存して あとで見返そう！ |

## 使い方

```sh
npm install
npm run build        # フレーム描画 → 音声合成 → 合成。out/magic-attack-ja.mp4 ができる
```

個別に動かす場合:

```sh
npm run preview                               # http://127.0.0.1:8080/src/index.html（?t=12.5 で静止画）
node scripts/render.js --stills 3,24.2        # 指定秒の静止画を out/ に書き出す
node scripts/render.js --from 20 --to 26 --out out/part.mp4
```

必要なもの: Node.js 18+、Python 3 + numpy、ffmpeg、Chromium（Playwright）。
Playwright 同梱の Chromium が無い環境では `CHROMIUM_PATH` で実行ファイルを指定する。

## 編集のしかた

- 台本・タイミング: `src/timeline.js`（テロップ文言、ステップ名、各攻撃の発生時刻）
- 3D 演出・UI: `src/main.js`、見た目: `src/style.css`
- 音: `scripts/make_audio.py`（効果音のタイミングは描画側から `out/events.json` に書き出される）

フォント: [Yusei Magic](https://fonts.google.com/specimen/Yusei+Magic)（SIL Open Font License, `assets/fonts/OFL.txt`）
