import { state, shiftsOfMonth, loadAll } from '../state.js';
import { saveProfile } from '../db.js';
import { monthlyEstimate } from '../calc.js';
import { eventIncomeInMonth } from '../events-logic.js';
import { yen, esc } from '../format.js';
import { icon } from './icons.js';
import { navigate } from '../app.js';

export async function renderGoal(el) {
  const wage = state.profile, items = state.backItems;
  const cur = shiftsOfMonth();
  const estimate = monthlyEstimate(wage, items, cur)
    + eventIncomeInMonth(state.reservations, state.events, state.month);
  const goal = Number(state.profile.monthlyGoal) || 0;
  const monthLabel = state.month.replace('-', '年') + '月';

  const workDays = cur.filter((s) => !s.absent && !s.recordOnly).length;
  const dayAvg = workDays ? Math.round(estimate / workDays) : 0;
  const pct = goal ? Math.round((estimate / goal) * 100) : 0;
  const remain = Math.max(0, goal - estimate);
  const achieved = goal > 0 && estimate >= goal;

  // 目標未設定：設定を促す
  if (goal <= 0) {
    el.innerHTML = `
      <div class="card goal-hero">
        <div class="gl-ico">${icon('target')}</div>
        <div class="gl-empty-title">今月の目標を決めよう</div>
        <p class="gl-empty-sub">目標を決めると、あといくらで届くかが見えて<br>毎日の記録がもっと楽しくなります。</p>
        <button class="btn" id="glEdit" type="button">目標を設定する</button>
      </div>`;
    el.querySelector('#glEdit').onclick = () => editGoal(el, 0);
    return;
  }

  // 達成の参考情報（煽らない・あくまで目安）
  const hints = [];
  if (achieved) {
    hints.push({ ok: true, text: '目標を達成しました。今月もよく頑張りました♡' });
  } else {
    if (dayAvg > 0) {
      const moreShifts = Math.ceil(remain / dayAvg);
      hints.push({ ok: true, text: `今のペース（1日平均 ${yen(dayAvg)}）なら、あと ${moreShifts}回 の出勤で届きそうです。` });
    }
    if (dayAvg > 0) hints.push({ ok: true, text: `今月の1日平均は ${yen(dayAvg)} です。` });
    hints.push({ ok: false, text: 'あくまで目安です。自分のペースで大丈夫。' });
  }

  el.innerHTML = `
    <div class="card goal-hero${achieved ? ' achieved' : ''}">
      ${achieved ? '<div class="gl-badge">✦ 目標達成 ✦</div>' : ''}
      <div class="gl-cap">${esc(monthLabel)}の目標</div>
      <div class="gl-target">${yen(goal)}</div>
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${Math.min(100, pct)}%"></div></div>
      <div class="gl-progress"><span>${yen(estimate)} / ${yen(goal)}</span><strong>${pct}%</strong></div>
      <div class="gl-remain">${achieved ? `${icon('party')} 目標を ${yen(estimate - goal)} 上回りました！` : `あと <strong>${yen(remain)}</strong>`}</div>
      <button class="btn btn-ghost" id="glEdit" type="button">目標を変更する</button>
    </div>

    <div class="card">
      <div class="card-head"><h3>目標の達成状況</h3></div>
      <ul class="gl-hints">
        ${hints.map((h) => `<li class="${h.ok ? 'ok' : 'dim'}"><span class="gl-check">${h.ok ? '✓' : '·'}</span><span>${esc(h.text)}</span></li>`).join('')}
      </ul>
    </div>`;

  el.querySelector('#glEdit').onclick = () => editGoal(el, goal);
}

async function editGoal(el, current) {
  const next = await goalModal(current);
  if (next === null) return;
  await saveProfile({ ...state.profile, monthlyGoal: next });
  await loadAll();
  renderGoal(el);
}

// 目標金額の入力モーダル（PWA で prompt が使えないため自前実装）。
function goalModal(current) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal-card">
        <div class="modal-msg">今月の目標金額（円）</div>
        <input id="goalInput" class="goal-input" type="number" inputmode="numeric"
          placeholder="例: 300000" value="${current > 0 ? current : ''}">
        <div class="modal-actions">
          <button class="btn btn-ghost" id="goalCancel" type="button">キャンセル</button>
          <button class="btn" id="goalSave" type="button">保存する</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const input = back.querySelector('#goalInput');
    setTimeout(() => input.focus(), 60);
    const close = (val) => {
      back.classList.remove('show');
      setTimeout(() => back.remove(), 180);
      resolve(val);
    };
    back.querySelector('#goalCancel').onclick = () => close(null);
    back.querySelector('#goalSave').onclick = () => close(Math.max(0, Math.round(Number(input.value) || 0)));
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
  });
}
