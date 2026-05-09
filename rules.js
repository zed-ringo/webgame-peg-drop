(() => {
  const lap = Math.max(0, Number(localStorage.getItem('peg-drop:clears')) || 0);
  const BOMB_LAP = 1, STAR_LAP = 2;

  const pegs = [
    { color:'#4cb1ff', name:'青ペグ', desc:'まる玉で BREAK → 相手に +2 ダメージがめ' },
    { color:'#ff6b7a', name:'赤ペグ', desc:'とげ玉で BREAK → 相手に +2 ダメージがめ' },
    { color:'#74d756', name:'緑ペグ', desc:'しずく玉で SPLIT、玉が分裂するがめ' },
    { color:'#c8c0d4', name:'グレーペグ', desc:'どの玉でも 1 ダメージの中継ペグがめ' },
    { color:'#ff97c2', name:'紫ペグ', desc:'当てると自分の HP が +2 回復するがめ', icon:'＋' },
    { color:'#ffae3a', name:'ボムペグ', desc:'どの玉でも当たると大ばくはつ、まわりも巻きこむがめ！', icon:'×', unlockLap: BOMB_LAP },
  ];
  const orbs = [
    { color:'#4cb1ff', name:'まる玉',   desc:'青ペグ専用 BREAK 玉がめ' },
    { color:'#ff6b7a', name:'とげ玉',   desc:'赤ペグ専用 BREAK 玉がめ' },
    { color:'#74d756', name:'しずく玉', desc:'緑ペグで SPLIT(分裂)する玉がめ' },
    { color:'#ffd84a', name:'スター玉', desc:'なんでも壊せる万能玉がめ。ときどき出てくるがめ〜', icon:'★', unlockLap: STAR_LAP },
  ];

  function row(p) {
    const locked = p.unlockLap && lap < p.unlockLap;
    const lockNote = locked ? `<span class="rule-lock">🔒 ぼうけん ${p.unlockLap} 回クリアでなかまになるがめ</span>` : '';
    const iconChar = p.icon || '';
    return (
      `<li class="rule-row${locked ? ' rule-locked' : ''}">` +
        `<span class="rule-disc" style="background:${p.color}">${iconChar}</span>` +
        `<div class="rule-meta"><strong class="rule-name">${p.name}</strong>${lockNote}` +
        `<span class="rule-desc">${p.desc}</span></div>` +
      `</li>`
    );
  }

  const controls = document.querySelector('.controls') || document.body;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '?';
  button.title = 'ペグと玉の図鑑';
  button.setAttribute('aria-label', 'ペグと玉の図鑑');
  button.className = 'icon-btn icon-btn-help';
  controls.appendChild(button);

  const dialog = document.createElement('dialog');
  dialog.className = 'rules-dialog';
  dialog.innerHTML =
    `<form method="dialog">` +
      `<span>BOOK</span>` +
      `<h2>ペグ &amp; 玉ずかん</h2>` +
      `<div class="rule-scroll">` +
        `<h3 class="rule-section">ペグ</h3>` +
        `<ul class="rule-list">${pegs.map(row).join('')}</ul>` +
        `<h3 class="rule-section">玉</h3>` +
        `<ul class="rule-list">${orbs.map(row).join('')}</ul>` +
      `</div>` +
      `<menu><button class="primary" value="close">閉じるがめ</button></menu>` +
    `</form>`;
  document.body.appendChild(dialog);

  button.addEventListener('click', () => {
    if (dialog.showModal) dialog.showModal();
  });
})();
