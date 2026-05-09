(() => {
  const rules = [
    "左の盤面で砲台をタップして玉を落とすがめ。次の玉はキューで予習できるがめ〜",
    "玉と同じ色のペグで BREAK!（青-まる／赤-とげ）・SPLIT!（緑-しずく）が起きて大ダメージがめ！",
    "紫(ピンク)ペグは HEAL+ で自分を回復するがめ。先に相手の HP を 0 にしたら勝ちがめ〜",
    "玉が動かなくなったら 1 秒で自動消滅するがめ。詰まりは怖くないがめ！",
    "ペグの配置はステージごとに変わるがめ。よく観察して玉のコースを読むがめ〜"
  ];
  const controls = document.querySelector(".controls") || document.body;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "?";
  button.title = "ルール";
  button.setAttribute("aria-label", "ルール説明");
  button.className = "icon-btn icon-btn-help";
  controls.appendChild(button);
  const dialog = document.createElement("dialog");
  dialog.className = "rules-dialog";
  dialog.innerHTML = `<form method="dialog"><span>RULES</span><h2>Peg Drop — VS</h2><ul>${rules.map((r) => `<li>${r}</li>`).join("")}</ul><menu><button class="primary" value="close">閉じる</button></menu></form>`;
  document.body.appendChild(dialog);
  button.addEventListener("click", () => dialog.showModal ? dialog.showModal() : alert(rules.join("\n")));
})();
