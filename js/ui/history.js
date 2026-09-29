import { state, shiftsOfMonth } from '../state.js';
import { plStatement, monthlyEstimate, nightPremium } from '../calc.js';
import { eventIncomeInMonth } from '../events-logic.js';
import { yen, esc } from '../format.js';
import { isPremium } from '../entitlement.js';
import { lockScreen, wireLockCta } from './premium-gate.js';

// 月ごとの収入サマリーを算出する（純粋な集計）。
function monthSummary(month) {
  const wage = state.profile, items = state.backItems;
  const cur = shiftsOfMonth(month);
  const eventInc = eventIncomeInMonth(state.reservations, state.events, month);
  const pl = plStatement(wage, items, cur);
  const total = monthlyEstimate(wage, items, cur) + eventInc; // 時給＋歩合＋イベント歩合
  const night = cur.reduce((s, sh) => s + nightPremium(wage, sh), 0);
  const workDays = cur.filter((s) => !s.absent && !s.recordOnly).length;
  return {
    month, total, workDays,
    avg: workDays ? Math.round(total / workDays) : 0,
    wage: pl.wageTotal,
    night,
    incentive: pl.incentiveTotal + eventInc,
    penalty: pl.penaltyTotal,
    deduction: pl.deductionTotal,
    net: pl.net + eventInc,
  };
}

export async function renderHistory(el) {
  // 過去の月をさかのぼる閲覧は詳細レポートと同じ有料機能。
  if (!isPremium()) {
    el.innerHTML = lockScreen('収入履歴', [
      '過去の月の収入をまとめて振り返り',
      '月ごとの勤務日数・1日平均・内訳',
      '自分の収入の成長を見える化',
    ]);
    wireLockCta(el);
    return;
  }

  const months = [...new Set(state.shifts.map((s) => (s.date || '').slice(0, 7)).filter(Boolean))]
    .sort().reverse();

  if (months.length === 0) {
    el.innerHTML = '<h2>収入履歴</h2><div class="card"><p class="muted">まだ記録がありません。勤務を記録すると、ここに月ごとの収入が積み上がっていきます。</p></div>';
    return;
  }

  const summaries = months.map(monthSummary);
  const maxTotal = Math.max(1, ...summaries.map((s) => s.total));

  const detailRow = (label, val, neg = false) =>
    `<div class="hist-drow"><span>${label}</span><strong class="${neg && val < 0 ? 'neg' : ''}">${yen(val)}</strong></div>`;
  const detailRowRaw = (label, txt) =>
    `<div class="hist-drow"><span>${label}</span><strong>${esc(txt)}</strong></div>`;

  el.innerHTML = `
    <h2>収入履歴</h2>
    <p class="muted" style="margin:-4px 0 12px">これまでの頑張りの記録です。月をタップすると内訳が見られます。</p>
    <div class="hist-list">
      ${summaries.map((s) => {
        const [y, m] = s.month.split('-');
        const bar = Math.max(4, Math.round((s.total / maxTotal) * 100));
        return `
        <div class="card hist-item" data-month="${esc(s.month)}">
          <button class="hist-head" type="button">
            <div class="hist-when"><span class="hist-my">${Number(y)}年${Number(m)}月</span>
              <span class="hist-days">${s.workDays}日出勤</span></div>
            <div class="hist-right"><span class="hist-total">${yen(s.total)}</span>
              <span class="hist-chev">›</span></div>
          </button>
          <div class="hist-bar"><div class="hist-bar-fill" style="width:${bar}%"></div></div>
          <div class="hist-detail" hidden>
            ${detailRowRaw('出勤日数', s.workDays + '日')}
            ${detailRow('総収入', s.total)}
            ${detailRow('1日平均', s.avg)}
            <div class="hist-dsep"></div>
            ${detailRow('時給（深夜手当込み）', s.wage)}
            ${s.night ? detailRow('　うち深夜手当', s.night) : ''}
            ${detailRow('歩合', s.incentive)}
            ${s.penalty ? detailRow('ペナルティ', s.penalty, true) : ''}
            ${s.deduction ? detailRow('その他控除', s.deduction, true) : ''}
            <div class="hist-dsep"></div>
            ${detailRow('差引 合計', s.net)}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  // 月カードをタップ → 内訳をアコーディオン開閉
  el.querySelectorAll('.hist-item').forEach((item) => {
    const head = item.querySelector('.hist-head');
    const detail = item.querySelector('.hist-detail');
    const chev = item.querySelector('.hist-chev');
    head.onclick = () => {
      const open = detail.hidden;
      detail.hidden = !open;
      item.classList.toggle('open', open);
      chev.textContent = open ? '⌄' : '›';
    };
  });
}
