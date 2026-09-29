import { state, shiftsOfMonth } from '../state.js';
import { icon } from './icons.js';
import { plStatement, annualSeries, monthlyWorkedHours, backRanking, dayPaySummary } from '../calc.js';
import { withholdingTax } from '../tax-logic.js';
import { yen, signedYen, esc } from '../format.js';
import { eventIncomeInMonth, eventIncentiveDetail, eventBackRanking } from '../events-logic.js';
import { isPremium } from '../entitlement.js';
import { lockScreen, wireLockCta } from './premium-gate.js';
import { toast } from './toast.js';
import { navigate } from '../app.js';

// レポートで表示中の月（YYYY-MM）。タブを開くたび今月にリセットし、‹ › で過去/未来へ切り替える。
let reportMonth = null;
function thisMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function shiftReportMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function renderReport(el) {
  if (!isPremium()) {
    el.innerHTML = lockScreen('詳細レポート', [
      '月ごとの収支明細（時給内訳・歩合明細）',
      '日払いの受取／未受取の集計',
      '過去の月をさかのぼって閲覧・PDF出力',
    ]);
    wireLockCta(el);
    return;
  }
  reportMonth = thisMonth(); // タブを開くたびデフォルト＝今月に設定
  drawReport(el);
}

function drawReport(el) {
  const month = reportMonth;
  const wage = state.profile, items = state.backItems;
  const cur = shiftsOfMonth(month);
  const pl = plStatement(wage, items, cur);
  // イベント予約（対応済み）の当月合計＝イベント歩合。通常歩合に加算する。
  // 表示はイベント名ごとの行に分けて判別できるようにする。
  const eventInc = eventIncomeInMonth(state.reservations, state.events, month);
  const eventDetail = eventIncentiveDetail(state.reservations, state.events, month);
  const incentiveTotalAll = pl.incentiveTotal + eventInc;
  const grossIncomeAll = pl.grossIncome + eventInc;
  const netAll = pl.net + eventInc;
  // 源泉徴収（設定ON時）：額面（収入合計）に率をかけて手取りから差し引く。
  const wh = state.profile.withholding || {};
  const whTax = wh.enabled ? withholdingTax(grossIncomeAll, wh.rate) : 0;
  const whRate = Number(wh.rate) || 10.21;
  const year = Number(month.slice(0, 4));
  const series = annualSeries(wage, items, state.shifts, year);
  // 歩合ランキングはシフト内の歩合項目＋イベント予約(対応済み)の商品を商品名で合算。
  // 割合はイベントを含む総収入(grossIncomeAll)ベースで再計算する。
  const rankMap = new Map();
  for (const r of [...backRanking(wage, items, cur), ...eventBackRanking(state.reservations, state.events, month)]) {
    const acc = rankMap.get(r.name) || { name: r.name, amount: 0, count: 0 };
    acc.amount += r.amount;
    acc.count += r.count;
    rankMap.set(r.name, acc);
  }
  const rankingBase = [...rankMap.values()]
    .filter((x) => x.amount !== 0 || x.count !== 0)
    .map((x) => ({ ...x, pct: grossIncomeAll ? Math.round((x.amount / grossIncomeAll) * 1000) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const medals = ['<span class="rank-badge rank-1">1</span>', '<span class="rank-badge rank-2">2</span>', '<span class="rank-badge rank-3">3</span>'];

  // 日払い集計（設定ONかつ日払い実績がある月だけ表示）
  const dp = dayPaySummary(wage, items, cur);
  const showDayPay = wage.showDayPayDiff && dp.received > 0;
  const dpRow = (label, val) => val
    ? `<div class="row" style="justify-content:space-between"><span>${label}</span><strong>${yen(val)}</strong></div>` : '';
  const dayPayCard = showDayPay ? `
    <div class="card" id="secDayPay">
      <h3 style="margin:0 0 8px">日払い（当日その場で受取）</h3>
      ${dpRow('全額 当日日払い', dp.full)}
      ${dpRow('基本時給のみ 日払い', dp.base)}
      ${dpRow('体験入店・全額 日払い', dp.trial)}
      <div class="pl-net"><span>受取済み 合計</span><strong>${yen(dp.received)}</strong></div>
      <div class="row" style="justify-content:space-between"><span>未受取（差額・後日支給）</span><strong>${yen(dp.remaining)}</strong></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.6">「基本時給のみ 日払い」は歩合（インセンティブ）を含みません。当日受け取っていない歩合や差額は「未受取（後日支給）」に含まれます。</p>
    </div>` : '';

  // 歩合 TOP3 を金額順／数量順で並べ替えて描画する（同じ card 内でトグル）
  const rankRows = (mode) => {
    const sorted = [...rankingBase].sort((a, b) =>
      mode === 'count' ? (b.count - a.count) || (b.amount - a.amount)
                       : (b.amount - a.amount) || (b.count - a.count));
    const top = sorted.slice(0, 3);
    if (top.length === 0) return '<p class="muted">まだ歩合実績がありません。</p>';
    return top.map((r, i) => `<div class="row" style="justify-content:space-between;margin-bottom:6px">
        <span>${medals[i]} ${esc(r.name)}</span>
        <span><strong>${yen(r.amount)}</strong> <span class="muted">${r.count}件 / ${r.pct}%</span></span>
      </div>`).join('');
  };

  // P/L の1行（金額はマイナスなら符号付き）。count 指定時は数量バッジを添える。
  const line = (label, amount, cls = '', count = null) => `
    <div class="pl-line ${cls}">
      <span>${esc(label)}${count ? `<span class="pl-count">×${count}</span>` : ''}</span>
      <span class="pl-amt">${amount < 0 ? signedYen(amount) : yen(amount)}</span>
    </div>`;
  const subtotal = (label, amount) => `
    <div class="pl-line pl-subtotal">
      <span>${esc(label)}</span>
      <span class="pl-amt">${amount < 0 ? signedYen(amount) : yen(amount)}</span>
    </div>`;

  const hasData = pl.wageRows.length || pl.incentiveRows.length || pl.penaltyRows.length || pl.deductionRows.length || eventInc;
  const incentiveCount = pl.incentiveRows.reduce((s, r) => s + (r.count || 0), 0);
  // イベント歩合の別枠：イベント名をタイトルに、配下へ 銘柄×本数・金額 を明細表示。
  const eventBlock = eventInc ? `
    <div class="pl-section-head" style="margin-top:14px">イベント歩合</div>
    ${eventDetail.map((ev) => `
      <div class="pl-event-title">${icon('party')} ${esc(ev.name)}</div>
      ${ev.items.map((it) => line(it.label, it.amount, '', it.count)).join('')}
    `).join('')}
    ${subtotal('イベント歩合 小計', eventInc)}
  ` : '';

  // P/L 本文（全体／歩合のみ を切替）
  const plFull = () => `
    <div class="pl-section-head">売上（収入）</div>
    ${pl.wageRows.map((r) => line(r.label, r.amount)).join('')}
    ${pl.wageRows.length ? subtotal('時給 小計', pl.wageTotal) : ''}
    ${pl.incentiveRows.length ? `
      <div class="pl-gap"></div>
      ${pl.incentiveRows.map((r) => line(r.label, r.amount, '', r.count)).join('')}
      ${subtotal('歩合 小計', pl.incentiveTotal)}
    ` : ''}
    ${eventBlock}
    ${subtotal('収入合計', grossIncomeAll)}
    ${pl.penaltyRows.length ? `
      <div class="pl-section-head" style="margin-top:14px">控除（ペナルティ）</div>
      ${pl.penaltyRows.map((r) => line(r.label, r.amount, 'pl-neg', r.count)).join('')}
      ${subtotal('ペナルティ 小計', pl.penaltyTotal)}
    ` : ''}
    ${pl.deductionRows.length ? `
      <div class="pl-section-head" style="margin-top:14px">控除（その他）</div>
      ${pl.deductionRows.map((r) => line(r.label, r.amount, 'pl-neg', r.count)).join('')}
      ${subtotal('その他控除 小計', pl.deductionTotal)}
    ` : ''}
    ${whTax > 0 ? `
      <div class="pl-section-head" style="margin-top:14px">源泉徴収</div>
      ${line(`源泉徴収 (${whRate}%)`, -whTax, 'pl-neg')}
    ` : ''}
    <div class="pl-net">
      <span>差引 最終合計${whTax > 0 ? '（源泉徴収後）' : ''}</span>
      <strong>${yen(netAll - whTax)}</strong>
    </div>
    ${whTax > 0 ? `<p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.6">源泉徴収 ¥${whTax.toLocaleString('ja-JP')} を差し引いた手取りです。確定申告で一部が還付される場合があります。</p>` : ''}`;

  // 歩合のみ：数量と額を項目別に並べ、末尾に合計（数量＋額）
  const plIncentiveOnly = () => (pl.incentiveRows.length === 0 && !eventInc)
    ? '<p class="muted">この月の歩合実績がまだありません。</p>'
    : `
      <div class="pl-section-head">歩合のみ</div>
      ${pl.incentiveRows.map((r) => line(r.label, r.amount, '', r.count)).join('')}
      ${eventBlock}
      <div class="pl-net">
        <span>合計<span class="pl-count">${incentiveCount}件</span></span>
        <strong>${yen(incentiveTotalAll)}</strong>
      </div>`;

  const plBody = (view) => view === 'incentive' ? plIncentiveOnly() : plFull();

  el.innerHTML = `
    <h2>収支レポート（${esc(month.replace('-', '年'))}月）</h2>
    <div class="print-only report-print-meta">${esc(wage.name || 'Lumi')}${wage.storeName ? '（' + esc(wage.storeName) + '）' : ''} ／ 作成日 ${esc(new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }))}</div>
    <div class="rep-monthnav no-print">
      <button id="repPrev" class="rep-navbtn" type="button" aria-label="前の月">‹</button>
      <span class="rep-navlabel">${esc(month.replace('-', '年'))}月</span>
      <button id="repNext" class="rep-navbtn" type="button" aria-label="次の月">›</button>
    </div>
    <button class="link-btn no-print" id="toHistory" type="button" style="margin:-4px 0 12px">${icon('chart')} 月ごとの収入履歴を見る ›</button>
    <div class="card" id="secSummary">
      <div class="row" style="justify-content:space-between"><span>出勤日数</span><strong>${cur.filter((s) => !s.absent && !s.recordOnly).length}日</strong></div>
      <div class="row" style="justify-content:space-between"><span>総勤務時間</span><strong>${monthlyWorkedHours(cur)}h</strong></div>
      <div class="row" style="justify-content:space-between"><span>基本時給</span><strong>${yen(wage.hourlyWage || 0)}<span class="muted" style="font-weight:400"> / 時</span></strong></div>
    </div>

    <div class="card no-print" id="secAnnual">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">年間（${year}年）</h3>
        <div class="seg">
          <button class="seg-btn active" data-mode="bar">合算・棒</button>
          <button class="seg-btn" data-mode="line">内訳・折れ線</button>
        </div>
      </div>
      <div id="annualChart" class="chart-box"></div>
    </div>

    <div class="card pl-card" id="secPl">
      ${hasData ? `
        <div class="row" style="justify-content:flex-end;margin-bottom:8px">
          <div class="seg" id="plSeg">
            <button class="seg-btn active" data-view="all">全体</button>
            <button class="seg-btn" data-view="incentive">歩合のみ</button>
          </div>
        </div>
        <div id="plBody">${plBody('all')}</div>
      ` : '<p class="muted">この月の実績がまだありません。</p>'}
    </div>

    ${dayPayCard}

    <div class="card no-print" id="secRank">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">歩合 TOP3</h3>
        <div class="seg" id="rankSeg">
          <button class="seg-btn active" data-rank="amount">金額順</button>
          <button class="seg-btn" data-rank="count">数量順</button>
        </div>
      </div>
      <p class="muted" style="font-size:12px;margin:0 0 8px">シフトの歩合とイベント予約（対応済み）の商品を、同じ商品名でまとめてランキングします。</p>
      <div id="rankList">${rankRows('amount')}</div>
    </div>

    <div class="card no-print" id="pdfOptions">
      <h3>PDFに含める項目</h3>
      <p class="muted" style="margin:0 0 8px">チェックした項目だけをPDFに出力します。</p>
      <label class="pdf-opt"><input type="checkbox" data-sec="secSummary" checked> 勤務サマリー</label>
      <label class="pdf-opt"><input type="checkbox" data-sec="secPl" checked> 収支明細（P/L）</label>
      ${showDayPay ? '<label class="pdf-opt"><input type="checkbox" data-sec="secDayPay" checked> 日払い</label>' : ''}
      <button id="pdfBtn" class="btn" style="margin-top:10px">PDFで保存</button>
    </div>`;

  // --- 年間推移グラフ（インラインSVG・左→右へ描画アニメーション） ---
  const W = 340, H = 190, padL = 36, padR = 12, padT = 14, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB, slot = plotW / 12;
  const baseY = padT + plotH;

  // 縦軸（円）を「きりの良い」目盛りに丸める
  const rawMax = Math.max(1, ...series.map((d) => d.total));
  const niceNum = (x, round) => {
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    const nf = round ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
                     : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
    return nf * Math.pow(10, exp);
  };
  const step = niceNum(niceNum(rawMax, false) / 4, true);
  const maxV = Math.ceil(rawMax / step) * step;
  const cx = (i) => padL + (i + 0.5) * slot;
  const cy = (v) => padT + plotH - (v / maxV) * plotH;

  // 縦軸ラベル（円）：1万以上は「◯万」表記でコンパクトに
  const yLabel = (v) => v >= 10000
    ? (v % 10000 === 0 ? v / 10000 + '万' : (v / 10000).toFixed(1) + '万')
    : String(v);
  const yticks = [];
  for (let v = 0; v <= maxV + 0.5; v += step) yticks.push(v);
  const ygrid = yticks.map((v) => {
    const yy = cy(v).toFixed(1);
    return `<line class="chart-grid" x1="${padL}" y1="${yy}" x2="${padL + plotW}" y2="${yy}"/>
      <text class="chart-ylabel" x="${padL - 5}" y="${(cy(v) + 3).toFixed(1)}" text-anchor="end">${yLabel(v)}</text>`;
  }).join('');

  const xlabels = series.map((d, i) =>
    `<text class="chart-xlabel" x="${cx(i).toFixed(1)}" y="${baseY + 14}" text-anchor="middle">${d.month}</text>`
  ).join('');

  const buildChart = (mode) => {
    let body, legend;
    if (mode === 'bar') {
      const bw = slot * 0.54;
      body = series.map((d, i) => {
        const h = Math.max(0, (d.total / maxV) * plotH);
        return `<rect class="chart-bar" x="${(cx(i) - bw / 2).toFixed(1)}" y="${(baseY - h).toFixed(1)}"
          width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="url(#barGrad)"
          style="animation-delay:${i * 45}ms"/>`;
      }).join('');
      legend = `<span class="lg lg-total">■ 合計（時給＋歩合）</span>`;
    } else {
      const poly = (key, cls, delay) => {
        const pts = series.map((d, i) => `${cx(i).toFixed(1)},${cy(d[key]).toFixed(1)}`).join(' ');
        const dots = series.map((d, i) =>
          `<circle class="chart-dot ${cls}-dot" cx="${cx(i).toFixed(1)}" cy="${cy(d[key]).toFixed(1)}"
            r="2.6" style="animation-delay:${900 + i * 45}ms"/>`).join('');
        return `<polyline class="chart-line ${cls}" points="${pts}" pathLength="100"
          style="animation-delay:${delay}ms"/>${dots}`;
      };
      body = poly('wage', 'line-wage', 0) + poly('incentive', 'line-inc', 220);
      legend = `<span class="lg lg-wage">— 時給</span><span class="lg lg-inc">— 歩合</span>`;
    }
    return `
      <svg class="annual-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="年間収入推移">
        <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--pink)"/><stop offset="1" stop-color="var(--purple)"/>
        </linearGradient></defs>
        ${ygrid}
        <line class="chart-axis" x1="${padL}" y1="${baseY}" x2="${padL + plotW}" y2="${baseY}"/>
        ${body}
        ${xlabels}
      </svg>
      <div class="chart-legend">${legend}</div>`;
  };

  const chartBox = el.querySelector('#annualChart');
  const grandTotal = series.reduce((s, d) => s + d.total, 0);
  const renderChart = (mode) => {
    chartBox.innerHTML = grandTotal
      ? buildChart(mode)
      : `<p class="muted">${year}年の実績がまだありません。</p>`;
  };
  const chartSeg = chartBox.parentElement.querySelector('.seg');
  chartSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => {
      chartSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderChart(b.dataset.mode);
    };
  });
  renderChart('bar');

  // 月の切り替え（‹ ›）。前月へは自由、次月は今月まで（未来の空レポートは出さない）。
  el.querySelector('#repPrev').onclick = () => { reportMonth = shiftReportMonth(reportMonth, -1); drawReport(el); };
  const repNext = el.querySelector('#repNext');
  if (reportMonth >= thisMonth()) repNext.disabled = true;
  repNext.onclick = () => { reportMonth = shiftReportMonth(reportMonth, 1); drawReport(el); };

  el.querySelector('#toHistory').onclick = () => navigate('history');

  // P/L の全体／歩合のみ トグル
  const plSeg = el.querySelector('#plSeg');
  if (plSeg) {
    const plBodyEl = el.querySelector('#plBody');
    plSeg.querySelectorAll('.seg-btn').forEach((b) => {
      b.onclick = () => {
        plSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        plBodyEl.innerHTML = plBody(b.dataset.view);
      };
    });
  }

  // 歩合 TOP3 の並べ替えトグル（金額順／数量順）
  const rankSeg = el.querySelector('#rankSeg');
  const rankList = el.querySelector('#rankList');
  rankSeg.querySelectorAll('.seg-btn').forEach((b) => {
    b.onclick = () => {
      rankSeg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      rankList.innerHTML = rankRows(b.dataset.rank);
    };
  });

  // アプリ内でPDFを直接生成（ブラウザ印刷を使わない＝URL/日付フッターが出ない）。
  el.querySelector('#pdfBtn').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { exportReportPdf } = await import('./pdf.js'); // 重いライブラリはここで初めて読み込む
      await exportReportPdf(el, month.replace('-', '年') + '月');
    } catch (err) {
      // 生成に失敗したらブラウザ印刷にフォールバック
      toast('PDF生成に失敗したため印刷画面を開きます');
      window.print();
    } finally {
      btn.disabled = false;
    }
  };
}
