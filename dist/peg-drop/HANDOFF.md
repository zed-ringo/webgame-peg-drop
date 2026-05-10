# peg-drop — handoff notes

## 概要
玉とペグの相性で相手 HP を削り合う VS パズル。フィールドは左=自分 / 右=敵の 2 盤面。挙動・難易度・ルールは `app.js` の `STAGES` / `MATCH` / `ORBS` / `PEG_FILL` を参照。

## デザイン基準
明るい青空 + 桃色 + フィーバー黄、丸文字 + 黒縁、丸ぽちゃキャラの意匠。
派手にしすぎないことを優先（鳥嶋指摘: 「主役は演出じゃない、玉の行方」）。

### 画像アセット優先方針 (桜井 2026-05)
公式 puyo 風アセット (`assets/01_*` 〜 `assets/14_*`) を **正** とする。canvas 描画は
公式アセットがロード済みであれば `drawImage` で優先し、未ロード or 該当アセット無し
（heal / white peg など）の場合のみ自前 puyo 描画 (`drawPuyoOrb` / fallback peg) で補完する。

- 盤面フレーム: `assets/01_board_frame_blue_clean.png` / `02_board_frame_pink_clean.png`（鋲を除いた桜井版。元の `01_board_frame_blue.png` / `02_board_frame_pink.png` は装飾鋲あり、保管目的で残す）
- スタジアム背景: 廃止（`body` は単純なグラデのみ。視覚ノイズ削減）
- VS バースト: `assets/04_vs_burst.png` / `vs-burst.svg`
- STAGE pill / power button / help button: それぞれ `assets/05_*`,`06_*`,`07_*`
- cannon 装填 puyo (玉ごと): `assets/09_cannon_puyo_{blue,red,green,yellow,purple}.png`
- 小ペグ: `assets/10_small_peg_{blue,red,green,yellow,purple}.png`
- ヒットエフェクト: `assets/13_hit_effect_star_burst.png`
- 連鎖カットイン: `assets/14_chain_cutin_break_bubble.png`

### CSS パネル階層（HUD / VS bar / canvas-wrap）
3 セクションを微妙にトーン違いで重ねる:
- **HUD** = 透明背景・枠なし（ロゴ＋STAGE pill＋リセットだけが浮く）
- **.vs-bar** = 白→淡クリーム（ライト・3px 黒縁・20px 角丸）
- **.canvas-wrap** = 黄→濃オレンジの "アーケード筐体" 風（4px 黒縁・22px 角丸・厚いドロップシャドウ）
盤面装飾鋲（`.canvas-rivet`）と凡例（`.legend`）は削除済み。色＝意味の原則とヘルプボタン dialog（rules.js）で代替。

### Webfont
`M PLUS Rounded 1c` (800/900) を Google Fonts 経由で読み込み、HUD・popup・overlay
すべてに統一。stroke は `-webkit-text-stroke` + `paint-order:stroke fill` で puyo 黒縁。

## 色の対応表 (PALETTE ↔ CSS :root)
`app.js` 冒頭の `const PALETTE` と `style.css :root` は 1:1 対応。色を変えるときは両側を同時に更新する。

| 用途 | app.js (PALETTE.\*) | style.css (--\*) |
|---|---|---|
| 空 上 | `skyTop`     | `--sky-1` |
| 空 中 | `skyMid`     | `--sky-2` |
| 空 下 | `skyBot`     | `--sky-3` |
| プレイヤー基色 | `player`     | `--player` |
| プレイヤーソフト枠 | `playerSoft` | (盤面 border 用) |
| プレイヤーティント | `playerTint` | (canvas 内側) |
| 敵 基色 | `enemy`      | `--enemy` |
| 敵 ソフト枠 | `enemySoft`  | (盤面 border 用) |
| 敵 ティント | `enemyTint`  | (canvas 内側) |
| フィーバー黄 | `yellow`     | `--yellow` |
| 連鎖 BREAK | `matchBreak` | (黄系) |
| 連鎖 SPLIT | `matchSplit` | `--green` 系 |
| HEAL    | `matchHeal`  | `--green` |
| ダメージ表示 | `damageText` | `--damage` |
| 黒縁取り | `outlineDark` | `--line-dark` |

ペグ色 (`PEG_FILL`) はゲームロジック側のキー (`white/red/blue/green/heal`) を維持。色値だけパステル寄せ。

## 描画契約 (触らない)
- 座標系: `PLAYER_X0 / ENEMY_X0 / BOARD_W / BOARD_H / PEG_R / BALL_R / BOARD_LAYOUT`
- 物理: `G / JIT / damp / jitMul`
- ゲームロジック: `MATCH / DAMAGE / HEAL_AMOUNT / STAGES / pickAIPosition / pickAIOrb / regenIfEmpty`
- HP/HUD DOM id: `player-hp-fill / enemy-hp-fill / stage-num / mascot-img / enemy-img / stage-overlay / dialog`

これらに触る場合は田尻・鳥嶋を再度通す。

## reduced-motion
- CSS は `@media (prefers-reduced-motion: reduce)` で全アニメ抑制
- canvas 側は `PREFERS_REDUCED_MOTION` 定数で星のパルスを停止（背景の星は常時固定座標で軽量）

## 依存・素材
- `assets/turtle-idle.png`（プレイヤーマスコット = えすけーぷがめ）
- `assets/enemy-a-*.png` / `enemy-b-*.png` / `boss-*.png`（敵スプライト）
- `assets/orb-round.png` / `orb-spike.png` / `orb-drop.png`（現在は canvas 描画のみで使用、index.html からの参照なし）

## デプロイ
1. `peg-drop/index.html`, `style.css`, `app.js`, `rules.js`, `assets/` を `peg-drop/dist/peg-drop/` に同期
2. `./bin/rtk wrangler deploy -c peg-drop/wrangler.toml --dry-run`
3. アップロード件数を目視
4. 田尻・鳥嶋の事後レビュー両通過 → 会長承認
5. `./bin/rtk wrangler deploy -c peg-drop/wrangler.toml`

## 公開
- ルート: `webgame.beta.menu/peg-drop/*`
- リポ: `zed-ringo/webgame-peg-drop`
- account_id: `524c8bd900e5189c6a55d88f45e0f2a0`
