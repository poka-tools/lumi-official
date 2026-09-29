// 純粋関数群。DOM / IndexedDB に依存しない（Flutter 移植時の中核）。

export function parseTimeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function workedHours(shift) {
  if (shift && shift.absent) return 0; // 欠勤：実働0h＝時給・深夜手当は付かない（ペナルティ等の歩合は別途計上）
  const start = parseTimeToMinutes(shift.start);
  const end = parseTimeToMinutes(shift.end);
  if (start === null || end === null) return 0;
  let mins = end - start;
  if (mins <= 0) mins += 24 * 60; // 日跨ぎ
  mins -= shift.breakMin || 0;
  if (mins < 0) mins = 0;
  return mins / 60;
}

// 歩合額。後方互換: 旧 type:'fixed'/'rate'+value はそのまま。
// 新モデル: fixedValue(円/件) と rateValue(％) の併用に対応。
// unitPrice(販売価格) を設定した％は「販売価格 × 数量 × ％」（数量ベース）で計算し、
// 未設定の％は従来どおり「対象売上 × ％」（売上ベース）で計算する。
// kind:'penalty'（罰金）/ 'deduction'（その他控除）の項目はマイナスとして扱う。
export function backAmount(item, entry) {
  if (!item || !entry) return 0;
  let amt;
  if (item.type === 'fixed') amt = (item.value || 0) * (entry.count || 0);
  else if (item.type === 'rate') amt = (entry.sales || 0) * (item.value || 0) / 100;
  else {
    const count = entry.count || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const ratePart = unitPrice > 0
      ? unitPrice * count * (item.rateValue || 0) / 100          // 販売価格×数量×％
      : (entry.sales || 0) * (item.rateValue || 0) / 100;        // 対象売上×％（旧式）
    amt = (item.fixedValue || 0) * count + ratePart;
  }
  return isDeductionKind(item.kind) ? -Math.abs(amt) : amt;
}
// 収入以外（罰金・その他控除）＝マイナス計上・歩合ランキング対象外。
export const isDeductionKind = (kind) => kind === 'penalty' || kind === 'deduction';

// 歩合項目ごとの利用実績（件数・金額）を shifts から集計して Map<itemId,{count,amount}> で返す。
// count は entry.count の合計（本数・件数など）、amount は backAmount の合計（控除・罰金はマイナス）。
// 歩合項目の設定ページで「今月 N件 ¥X」を出すために使う純粋関数。
export function backItemStats(items, shifts) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  const out = new Map((items || []).map((it) => [it.id, { count: 0, amount: 0 }]));
  for (const sh of (shifts || [])) {
    for (const e of (sh.entries || [])) {
      const it = byId.get(e.backItemId);
      if (!it) continue;
      const o = out.get(it.id);
      o.count += Number(e.count) || 0;
      o.amount += backAmount(it, e);
    }
  }
  return out;
}

// wage は数値（旧）でも時給設定オブジェクト（新）でも受ける。
// 新オブジェクト: { hourlyWage, nominationWage, douhanWage,
//   nightPremium: { enabled, start, end, addPerHour } }
function normalizeWage(wage) {
  if (typeof wage === 'number') return { hourlyWage: wage };
  return wage || { hourlyWage: 0 };
}

// 指名・同伴のフラグに応じて適用する時給を返す（同伴 > 指名 > 基本給）。
export function effectiveHourly(wage, shift) {
  const w = normalizeWage(wage);
  if (shift && shift.douhan && w.douhanWage) return w.douhanWage;
  if (shift && shift.nomination && w.nominationWage) return w.nominationWage;
  return w.hourlyWage || 0;
}

// 深夜帯（既定 22:00〜05:00, 日跨ぎ可）に重なる実働時間。休憩控除後の実働を上限にする。
export function nightHours(shift, startHHMM = '22:00', endHHMM = '05:00') {
  const ws = parseTimeToMinutes(shift.start);
  let we = parseTimeToMinutes(shift.end);
  if (ws === null || we === null) return 0;
  if (we <= ws) we += 24 * 60; // 日跨ぎ
  const ns = parseTimeToMinutes(startHHMM);
  let ne = parseTimeToMinutes(endHHMM);
  if (ns === null || ne === null) return 0;
  if (ne <= ns) ne += 24 * 60; // 夜間帯の日跨ぎ
  let nightMin = 0;
  for (const off of [0, 24 * 60]) {
    nightMin += Math.max(0, Math.min(we, ne + off) - Math.max(ws, ns + off));
  }
  const workedMin = workedHours(shift) * 60;
  return Math.min(nightMin, workedMin) / 60;
}

// 深夜手当の加算額（割増は円/時の加算）。
export function nightPremium(wage, shift) {
  const np = normalizeWage(wage).nightPremium;
  if (!np || !np.enabled || !np.addPerHour) return 0;
  return nightHours(shift, np.start, np.end) * (np.addPerHour || 0);
}

export function shiftWage(wage, shift) {
  return effectiveHourly(wage, shift) * workedHours(shift) + nightPremium(wage, shift);
}
export function shiftBackTotal(items, shift) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  const entriesBack = (shift.entries || []).reduce((sum, e) => {
    const item = byId.get(e.backItemId);
    return sum + backAmount(item, e);
  }, 0);
  // eventBack: 削除したイベントから引き継いだ「計上済みイベント歩合」を記録として保持する額。
  return entriesBack + (Number(shift.eventBack) || 0);
}
export function shiftTotal(hourlyWage, items, shift) {
  return shiftWage(hourlyWage, shift) + shiftBackTotal(items, shift);
}

// 日払い（当日その場で受け取った額）。
// type: 'full'(全額当日) / 'base'(基本時給のみ＝時給＋深夜手当) / 'trial'(体験入店・全額) / 'none'/未設定。
// cap>0 のときは受取額をその上限で頭打ち（1日1万円まで 等）。full/trial は純額（歩合−ペナルティ込み）。
// 実際に適用される日払い設定を解決する。
// シフト個別に none 以外の指定があればそれを優先（過去データの後方互換）、
// 無ければ設定のグローバル値（wage.dayPayType / wage.dayPayCap）を使う。
export function effectiveDayPay(wage, shift) {
  const dp = shift && shift.dayPay;
  if (dp && dp.type && dp.type !== 'none') return { type: dp.type, cap: Number(dp.cap) || 0 };
  return { type: (wage && wage.dayPayType) || 'none', cap: Number(wage && wage.dayPayCap) || 0 };
}
export function dayPayReceived(wage, items, shift) {
  const dp = effectiveDayPay(wage, shift);
  if (!dp.type || dp.type === 'none') return 0;
  const wagePart = shiftWage(wage, shift);              // 時給＋深夜手当
  const net = wagePart + shiftBackTotal(items, shift);  // 純額（歩合−ペナルティ込み）
  const gross = dp.type === 'base' ? wagePart : net;    // base は時給部分のみ
  const cap = dp.cap;
  const received = cap > 0 ? Math.min(gross, cap) : gross;
  return Math.max(0, received);                          // 負の受取はしない
}
// 未受取（後日支給される差額）＝ 純額 − 受取済み。
export function dayPayRemaining(wage, items, shift) {
  return shiftTotal(wage, items, shift) - dayPayReceived(wage, items, shift);
}

const round1 = (n) => Math.round(n * 10) / 10;

export function monthlyEstimate(hourlyWage, items, shifts) {
  return (shifts || []).reduce((s, sh) => s + shiftTotal(hourlyWage, items, sh), 0);
}
// 日払いの集計。種別ごとの受取（full/base/trial）＋受取合計・未受取（差額）・純額総額。
export function dayPaySummary(wage, items, shifts) {
  let full = 0, base = 0, trial = 0;
  for (const sh of (shifts || [])) {
    const r = dayPayReceived(wage, items, sh);
    if (!r) continue;
    const t = effectiveDayPay(wage, sh).type;
    if (t === 'base') base += r;
    else if (t === 'trial') trial += r;
    else full += r; // 'full'
  }
  const received = full + base + trial;
  const total = monthlyEstimate(wage, items, shifts);
  return { full, base, trial, received, remaining: total - received, total };
}
export function monthlyWorkedHours(shifts) {
  return (shifts || []).reduce((s, sh) => s + workedHours(sh), 0);
}
export function hourlyEquivalent(hourlyWage, items, shifts) {
  const hours = monthlyWorkedHours(shifts);
  if (hours === 0) return 0;
  return Math.round(monthlyEstimate(hourlyWage, items, shifts) / hours);
}
export function incomeBreakdown(hourlyWage, items, shifts) {
  const wage = (shifts || []).reduce((s, sh) => s + shiftWage(hourlyWage, sh), 0);
  const back = (shifts || []).reduce((s, sh) => s + shiftBackTotal(items, sh), 0);
  const total = wage + back;
  return {
    wage, back, total,
    wagePct: total ? round1((wage / total) * 100) : 0,
    backPct: total ? round1((back / total) * 100) : 0,
  };
}
export function backRanking(hourlyWage, items, shifts) {
  const monthTotal = monthlyEstimate(hourlyWage, items, shifts);
  // ペナルティ・控除項目はランキング対象外（収入の歩合のみを対象にする）
  const sums = (items || []).filter((it) => !isDeductionKind(it.kind)).map((it) => {
    let amount = 0, count = 0;
    for (const sh of (shifts || [])) {
      const e = (sh.entries || []).find((x) => x.backItemId === it.id);
      if (!e) continue;
      amount += backAmount(it, e);
      count += e.count || 0;
    }
    return { itemId: it.id, name: it.name, amount, count,
      pct: monthTotal ? round1((amount / monthTotal) * 100) : 0 };
  });
  return sums.filter((x) => x.amount !== 0 || x.count !== 0).sort((a, b) => b.amount - a.amount);
}
// 損益計算書（P/L）スタイルの収支内訳。設定項目に沿って行を構成する。
// 時給は適用レート（基本/指名/同伴）と深夜手当に分解、歩合は項目別に収入/ペナルティへ振り分ける。
export function plStatement(wage, items, shifts) {
  const w = normalizeWage(wage);
  const sh = shifts || [];

  // --- 時給内訳 ---
  let base = 0, nom = 0, dou = 0, night = 0;
  for (const s of sh) {
    const amt = effectiveHourly(w, s) * workedHours(s);
    if (s.douhan && w.douhanWage) dou += amt;
    else if (s.nomination && w.nominationWage) nom += amt;
    else base += amt;
    night += nightPremium(w, s);
  }
  const wageRows = [];
  if (base) wageRows.push({ label: '基本時給', amount: base });
  if (nom) wageRows.push({ label: '指名時給', amount: nom });
  if (dou) wageRows.push({ label: '同伴時給', amount: dou });
  if (night) wageRows.push({ label: '深夜手当', amount: night });
  const wageTotal = base + nom + dou + night;

  // --- 歩合項目（収入=歩合 / ペナルティ=罰金 / deduction=その他控除） ---
  const incentiveRows = [], penaltyRows = [], deductionRows = [];
  for (const it of (items || [])) {
    let amount = 0, count = 0;
    for (const shift of sh) {
      const e = (shift.entries || []).find((x) => x.backItemId === it.id);
      if (!e) continue;
      amount += backAmount(it, e);
      count += e.count || 0;
    }
    if (amount === 0) continue;
    const row = { label: it.name, amount, count };
    if (it.kind === 'deduction') deductionRows.push(row);
    else if (it.kind === 'penalty' || amount < 0) penaltyRows.push(row);
    else incentiveRows.push(row);
  }
  const incentiveTotal = incentiveRows.reduce((s, r) => s + r.amount, 0);
  const penaltyTotal = penaltyRows.reduce((s, r) => s + r.amount, 0);
  const deductionTotal = deductionRows.reduce((s, r) => s + r.amount, 0);
  const grossIncome = wageTotal + incentiveTotal;
  const net = grossIncome + penaltyTotal + deductionTotal; // penalty/deduction は負値

  return {
    wageRows, wageTotal,
    incentiveRows, incentiveTotal,
    penaltyRows, penaltyTotal,
    deductionRows, deductionTotal,
    grossIncome, net,
  };
}

// 指定年(西暦)の月次収入推移。各月の 時給合計 / 歩合合計 / 合算 を返す（1〜12月・欠損月は0）。
export function annualSeries(wage, items, shifts, year) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const prefix = `${year}-${String(m).padStart(2, '0')}`;
    const monthShifts = (shifts || []).filter((s) => (s.date || '').startsWith(prefix));
    const pl = plStatement(wage, items, monthShifts);
    out.push({ month: m, wage: pl.wageTotal, incentive: pl.incentiveTotal, total: pl.grossIncome });
  }
  return out;
}

// 指定月(YYYY-MM)の「日別収入」を日付順の配列で返す（時給＋歩合。同じ日は合算）。
// 収入が「日ごとに育っていく」推移グラフのための純関数。欠勤日は shiftTotal が
// 歩合のみになる（実働0のため時給は付かない）。収入が無い日は含めない。
export function dailySeries(wage, items, shifts, month) {
  const byDate = new Map();
  for (const sh of (shifts || [])) {
    if (!(sh.date || '').startsWith(month)) continue;
    byDate.set(sh.date, (byDate.get(sh.date) || 0) + shiftTotal(wage, items, sh));
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({ date, day: Number(date.slice(8, 10)), amount }));
}

export function monthOverMonth(current, previous) {
  if (previous === null || previous === undefined) return null;
  const diff = current - previous;
  const pct = previous === 0 ? 0 : round1((diff / previous) * 100);
  return { diff, pct };
}
