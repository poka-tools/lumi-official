import { yen } from '../format.js';

// 当月の日別収入を「育っていく」棒グラフで見せる（SVG・canvas非依存）。
// series = [{ day, amount }]（calc.dailySeries の出力）。month = 'YYYY-MM'。
export function dailyChartSvg(series, month) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const data = (series || []).filter((d) => d.amount > 0);
  if (data.length === 0) {
    return '<p class="muted" style="margin:8px 0 0">この月の収入がまだありません。記録すると、ここに育っていきます。</p>';
  }

  const W = 340, H = 150, padL = 6, padR = 6, padT = 12, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const baseY = padT + plotH;
  const slot = plotW / daysInMonth;
  const maxV = Math.max(1, ...data.map((d) => d.amount));
  const bw = Math.max(3, Math.min(slot * 0.62, 12));
  const cx = (day) => padL + (day - 0.5) * slot;

  const bars = data.map((d) => {
    const h = Math.max(1.5, (d.amount / maxV) * plotH);
    return `<rect class="chart-bar" x="${(cx(d.day) - bw / 2).toFixed(1)}" y="${(baseY - h).toFixed(1)}"
      width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="url(#dchartGrad)"
      style="animation-delay:${Math.min(d.day * 22, 600)}ms"><title>${d.day}日 ${yen(d.amount)}</title></rect>`;
  }).join('');

  // X軸ラベル：1・5・10…と月末
  const marks = new Set([1, daysInMonth]);
  for (let v = 5; v < daysInMonth; v += 5) marks.add(v);
  const xlabels = [...marks].sort((a, b) => a - b).map((day) =>
    `<text class="chart-xlabel" x="${cx(day).toFixed(1)}" y="${baseY + 14}" text-anchor="middle">${day}</text>`
  ).join('');

  return `
    <svg class="annual-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="今月の日別収入">
      <defs><linearGradient id="dchartGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--pink)"/><stop offset="1" stop-color="var(--purple)"/>
      </linearGradient></defs>
      <line class="chart-axis" x1="${padL}" y1="${baseY}" x2="${padL + plotW}" y2="${baseY}"/>
      ${bars}
      ${xlabels}
    </svg>`;
}

// コンテナに日別推移グラフを描画する。
export function renderDailyChart(container, series, month) {
  if (!container) return;
  container.innerHTML = dailyChartSvg(series, month);
}
