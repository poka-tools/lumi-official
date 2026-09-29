import { state, loadAll } from '../state.js';
import { put, uid } from '../db.js';
import { workedHours, shiftTotal, backAmount } from '../calc.js';
import { yen, esc } from '../format.js';
import { navigate } from '../app.js';
import { icon } from './icons.js';
import { openItemPicker } from './itempicker.js';
import { toast } from './toast.js';

export let editingShift = null;
export function setEditingShift(s) { editingShift = s; }

const KIND_EMOJI = { income: '💰', penalty: '⚠️', deduction: '🧾' };
const itemEmoji = (it) => it.icon || KIND_EMOJI[it.kind || 'income'] || '💰';

export async function renderRecord(el) {
  const today = new Date().toISOString().slice(0, 10);
  // 新規記録は「前回の勤務」の時間帯・休憩をプリフィル（2回目以降の入力を最小化）。
  // 前回シフトが無ければプロフィールの初期値にフォールバックする。
  const lastShift = editingShift ? null
    : [...state.shifts]
        .filter((x) => x.start && x.end && !x.recordOnly)
        .sort((a, b) => (b.date || '').localeCompare(a.date))[0];
  const s = editingShift || {
    id: uid(), date: today,
    start: (lastShift && lastShift.start) || state.profile.defaultStart || '20:00',
    end: (lastShift && lastShift.end) || state.profile.defaultEnd || '01:00',
    breakMin: Number((lastShift && lastShift.breakMin) ?? state.profile.defaultBreakMin) || 0,
    confirmed: false, entries: [],
  };
  if (!s.id) s.id = uid();

  // 歩合の作業用ステート（項目id -> {count, sales}）。既存エントリーから初期化。
  const picked = {};
  for (const e of (s.entries || [])) {
    if (e && e.backItemId) picked[e.backItemId] = { count: Number(e.count) || 0, sales: Number(e.sales) || 0 };
  }

  const incBody = state.backItems.length === 0
    ? '<p class="muted">先に「設定」で歩合項目を登録してください。</p>'
    : `<div class="inc-head">
         <div class="inc-head-title">${icon('money')} 入った歩合</div>
         <div class="inc-head-sub">「歩合項目を選んで入力」から件数を入力できます</div>
       </div>
       <div id="incSummary"></div>
       <button class="btn btn-ghost inc-open" id="incOpen" type="button">${icon('plus')} 歩合項目を選んで入力する</button>`;

  el.innerHTML = `
    <h2>収入を記録</h2>
    <div class="card">
      <div class="field"><label>日付</label><input id="date" type="date" value="${esc(s.date)}"></div>
      <div class="row">
        <div class="field" style="flex:1"><label>開始</label><input id="start" type="time" value="${esc(s.start)}"></div>
        <div class="field" style="flex:1"><label>終了</label><input id="end" type="time" value="${esc(s.end)}"></div>
        <div class="field" style="flex:1"><label>休憩(分)</label><input id="break" type="number" inputmode="numeric" placeholder="0" value="${Number(s.breakMin) || ''}"></div>
      </div>
      <div class="row" style="gap:16px;flex-wrap:wrap">
        <label><input id="confirmed" type="checkbox" ${s.confirmed ? 'checked' : ''}> 確定（実績）にする</label>
      </div>
    </div>

    <div class="card">
      <h3>歩合・ペナルティ実績</h3>
      ${incBody}
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between">
        <span>この日の概算</span><strong id="preview" class="big-amount" style="font-size:24px"></strong>
      </div>
      <div class="muted" id="hours"></div>
    </div>
    <button class="btn" id="save">保存</button>`;

  const collect = () => {
    s.date = el.querySelector('#date').value;
    s.start = el.querySelector('#start').value;
    s.end = el.querySelector('#end').value;
    s.breakMin = Number(el.querySelector('#break').value) || 0;
    s.confirmed = el.querySelector('#confirmed').checked;
    s.entries = Object.entries(picked)
      .map(([id, e]) => ({ backItemId: id, count: Number(e.count) || 0, sales: Number(e.sales) || 0 }))
      .filter((e) => e.count || e.sales);
    return s;
  };

  // ===== 入った歩合の要約（入力済み項目だけ・カレンダー日別シートと同じ見た目）=====
  const summaryBox = el.querySelector('#incSummary');
  const renderIncSummary = () => {
    if (!summaryBox) return;
    const rows = state.backItems
      .map((it) => ({ it, c: Number((picked[it.id] || {}).count) || 0, sl: Number((picked[it.id] || {}).sales) || 0 }))
      .filter((r) => r.c > 0 || r.sl > 0);
    if (!rows.length) {
      summaryBox.innerHTML = `<p class="inc-empty">まだ歩合が入力されていません。<br>下のボタンから項目を選んで入力できます。</p>`;
      return;
    }
    summaryBox.innerHTML = `<div class="inc-sum-list">${rows.map(({ it, c, sl }) => {
      const amt = backAmount(it, { count: c, sales: sl });
      const neg = it.kind === 'penalty' || it.kind === 'deduction';
      const qtyTxt = c > 0 ? `×${c}` : (sl > 0 ? `売上${yen(sl)}` : '');
      return `<div class="inc-sum-row">
        <span class="inc-sum-emoji">${esc(itemEmoji(it))}</span>
        <span class="inc-sum-name">${esc(it.name || '（名称未設定）')}</span>
        <span class="inc-sum-qty">${qtyTxt}</span>
        <span class="inc-sum-amt${neg ? ' neg' : ''}">${yen(amt)}</span>
      </div>`;
    }).join('')}</div>`;
  };

  const updatePreview = () => {
    const cur = collect();
    el.querySelector('#preview').textContent = yen(shiftTotal(state.profile, state.backItems, cur));
    el.querySelector('#hours').textContent = `実働 ${workedHours(cur)} 時間`;
  };

  const openBtn = el.querySelector('#incOpen');
  if (openBtn) openBtn.onclick = () => {
    openItemPicker({
      initial: picked,
      onApply: (entries) => {
        // 入力済みだけ返るので、picked を丸ごと差し替え（未選択は消える＝正しい挙動）
        for (const k of Object.keys(picked)) delete picked[k];
        Object.assign(picked, entries);
        renderIncSummary();
        updatePreview();
      },
    });
  };

  el.querySelectorAll('#date,#start,#end,#break,#confirmed').forEach((i) => { i.oninput = updatePreview; });
  renderIncSummary();
  updatePreview();

  el.querySelector('#save').onclick = async () => {
    const saved = { ...collect(), savedAt: Date.now() };
    await put('shifts', saved);
    setEditingShift(null);
    await loadAll();
    const total = shiftTotal(state.profile, state.backItems, saved);
    if (saved.absent || total <= 0) {
      toast('保存しました');
    } else {
      await showSavedCelebration(saved, total);
    }
    navigate('home');
  };
}

// 保存後の「働いた分が増えた」お祝い表示。今日の給与を数字でカウントアップし、
// 入ったバックを「＋¥○○ 項目名」で見せる。過度な演出はしない（軽いお祝い）。
function showSavedCelebration(shift, total) {
  const items = state.backItems;
  const byId = new Map(items.map((it) => [it.id, it]));
  const backRows = (shift.entries || [])
    .map((e) => {
      const it = byId.get(e.backItemId);
      if (!it) return null;
      const amt = backAmount(it, { count: e.count, sales: e.sales });
      if (!amt) return null;
      return { name: it.name || '歩合', emoji: itemEmoji(it), amt };
    })
    .filter(Boolean)
    .sort((a, b) => b.amt - a.amt);

  const isToday = shift.date === new Date().toISOString().slice(0, 10);
  const dateLabel = isToday ? '今日の給与'
    : `${Number((shift.date || '').slice(5, 7))}/${Number((shift.date || '').slice(8, 10))}の給与`;

  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal-card save-cele">
        <div class="sc-spark">✦</div>
        <div class="sc-greet">おつかれさま♡</div>
        <div class="sc-label">${esc(dateLabel)}</div>
        <div class="sc-amount" id="scAmount">¥0</div>
        ${backRows.length ? `<div class="sc-backs">${backRows.map((r) => `
          <div class="sc-back-row">
            <span class="sc-back-name">${esc(r.emoji)} ${esc(r.name)}</span>
            <span class="sc-back-amt${r.amt < 0 ? ' neg' : ''}">${r.amt < 0 ? '−' : '＋'}${yen(Math.abs(r.amt))}</span>
          </div>`).join('')}</div>` : ''}
        <button class="btn sc-ok" id="scOk" type="button">ホームで確認する</button>
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));

    // 金額のカウントアップ（視差効果を減らす設定なら即表示）
    const amtEl = back.querySelector('#scAmount');
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof requestAnimationFrame !== 'function') {
      amtEl.textContent = yen(total);
    } else {
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 700);
        amtEl.textContent = yen(Math.round(total * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    const close = () => {
      back.classList.remove('show');
      setTimeout(() => back.remove(), 180);
      resolve();
    };
    back.querySelector('#scOk').onclick = close;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
  });
}
