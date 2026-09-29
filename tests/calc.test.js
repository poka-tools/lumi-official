import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeToMinutes, workedHours } from '../js/calc.js';

test('parseTimeToMinutes: "HH:MM" を分に変換', () => {
  assert.equal(parseTimeToMinutes('21:00'), 1260);
  assert.equal(parseTimeToMinutes('02:30'), 150);
});

test('workedHours: 同日内の実働（休憩控除）', () => {
  const shift = { start: '18:00', end: '23:00', breakMin: 30 };
  assert.equal(workedHours(shift), 4.5);
});

test('workedHours: 日跨ぎ（21:00→翌02:00, 休憩0）', () => {
  const shift = { start: '21:00', end: '02:00', breakMin: 0 };
  assert.equal(workedHours(shift), 5);
});

test('workedHours: end未入力は 0', () => {
  const shift = { start: '20:00', end: '', breakMin: 0 };
  assert.equal(workedHours(shift), 0);
});

test('workedHours: 欠勤は時刻があっても 0', () => {
  const shift = { start: '20:00', end: '01:00', breakMin: 0, absent: true };
  assert.equal(workedHours(shift), 0);
});

import { backAmount } from '../js/calc.js';

test('backAmount fixed: 単価×件数', () => {
  const item = { id: 'a', type: 'fixed', value: 3000 };
  assert.equal(backAmount(item, { count: 2 }), 6000);
});
test('backAmount rate: 売上×率%', () => {
  const item = { id: 'b', type: 'rate', value: 10 };
  assert.equal(backAmount(item, { sales: 50000 }), 5000);
});
test('backAmount: 未入力は 0', () => {
  const fixed = { id: 'a', type: 'fixed', value: 3000 };
  const rate = { id: 'b', type: 'rate', value: 10 };
  assert.equal(backAmount(fixed, {}), 0);
  assert.equal(backAmount(rate, {}), 0);
});

test('backAmount hybrid: 円/件＋％ の併用', () => {
  const item = { fixedValue: 1000, rateValue: 5 };
  assert.equal(backAmount(item, { count: 2, sales: 100000 }), 7000); // 2000 + 5000
});
test('backAmount 販売価格×数量×％（数量ベース）', () => {
  const item = { rateValue: 10, unitPrice: 1100 };
  assert.equal(backAmount(item, { count: 3 }), 330); // 1100×3×10%
});
test('backAmount 販売価格＋1件あたり固定の併用（ともに数量ベース）', () => {
  const item = { fixedValue: 50, rateValue: 10, unitPrice: 1100 };
  assert.equal(backAmount(item, { count: 2 }), 320); // 50×2 ＋ 1100×2×10%
});
test('backAmount 販売価格ありは対象売上を無視（数量ベース優先）', () => {
  const item = { rateValue: 10, unitPrice: 1100 };
  assert.equal(backAmount(item, { count: 2, sales: 999999 }), 220); // salesは使わない
});
test('backAmount penalty: マイナス（旧fixed型）', () => {
  const item = { type: 'fixed', value: 3000, kind: 'penalty' };
  assert.equal(backAmount(item, { count: 1 }), -3000);
});
test('backAmount penalty: マイナス（新型・件数）', () => {
  const item = { fixedValue: 2000, kind: 'penalty' };
  assert.equal(backAmount(item, { count: 2 }), -4000);
});

import { effectiveHourly, nightHours, nightPremium } from '../js/calc.js';

test('effectiveHourly: 同伴 > 指名 > 基本給', () => {
  const w = { hourlyWage: 2000, nominationWage: 2500, douhanWage: 3000 };
  assert.equal(effectiveHourly(w, {}), 2000);
  assert.equal(effectiveHourly(w, { nomination: true }), 2500);
  assert.equal(effectiveHourly(w, { douhan: true }), 3000);
  assert.equal(effectiveHourly(w, { nomination: true, douhan: true }), 3000); // 同伴優先
  assert.equal(effectiveHourly(2000, { nomination: true }), 2000); // 数値はそのまま
});

test('nightHours: 20:00→01:00 の 22:00〜05:00 重なりは3h', () => {
  assert.equal(nightHours({ start: '20:00', end: '01:00', breakMin: 0 }), 3);
});
test('nightHours: 18:00→23:00 は 22:00〜23:00 の1h', () => {
  assert.equal(nightHours({ start: '18:00', end: '23:00', breakMin: 0 }), 1);
});
test('nightHours: 実働（休憩控除後）を上限にする', () => {
  // 22:00→02:00=4h, 休憩120分で実働2h → 深夜帯も2hが上限
  assert.equal(nightHours({ start: '22:00', end: '02:00', breakMin: 120 }), 2);
});

test('nightPremium: 深夜3h × 300円 = 900円', () => {
  const w = { hourlyWage: 2000, nightPremium: { enabled: true, start: '22:00', end: '05:00', addPerHour: 300 } };
  assert.equal(nightPremium(w, { start: '20:00', end: '01:00', breakMin: 0 }), 900);
});
test('nightPremium: 無効・数値時給は0', () => {
  assert.equal(nightPremium(2000, { start: '20:00', end: '01:00', breakMin: 0 }), 0);
});

import { shiftWage, shiftBackTotal, shiftTotal } from '../js/calc.js';

test('shiftWage: 深夜手当＋指名時給を反映', () => {
  // 20:00→01:00=5h, 指名時給2500, 深夜3h×300
  const w = { hourlyWage: 2000, nominationWage: 2500, nightPremium: { enabled: true, start: '22:00', end: '05:00', addPerHour: 300 } };
  const shift = { start: '20:00', end: '01:00', breakMin: 0, nomination: true };
  assert.equal(shiftWage(w, shift), 2500 * 5 + 900); // 13400
});

const _items3 = [
  { id: 'douhan', type: 'fixed', value: 3000 },
  { id: 'drink', type: 'rate', value: 10 },
];
const _shift3 = {
  start: '20:00', end: '01:00', breakMin: 0,
  entries: [
    { backItemId: 'douhan', count: 2 },
    { backItemId: 'drink', sales: 50000 },
  ],
};
test('shiftWage: 時給×実働', () => { assert.equal(shiftWage(2500, _shift3), 12500); });
test('shiftBackTotal: 全バック合計', () => { assert.equal(shiftBackTotal(_items3, _shift3), 11000); });
test('shiftTotal: 時給分＋バック', () => { assert.equal(shiftTotal(2500, _items3, _shift3), 23500); });

test('欠勤: 時給0・深夜手当0だがペナルティは計上される', () => {
  const w = { hourlyWage: 2500, nightPremium: { enabled: true, start: '22:00', end: '05:00', addPerHour: 300 } };
  const items = [{ id: 'fine', kind: 'penalty', fixedValue: 5000 }];
  const shift = { start: '20:00', end: '01:00', breakMin: 0, absent: true,
    entries: [{ backItemId: 'fine', count: 1 }] };
  assert.equal(shiftWage(w, shift), 0);            // 時給・深夜手当は付かない
  assert.equal(shiftBackTotal(items, shift), -5000); // 罰金は加算（マイナス）
  assert.equal(shiftTotal(w, items, shift), -5000);
});

import { dayPayReceived, dayPayRemaining, dayPaySummary } from '../js/calc.js';

// 時給2500×5h=12500、深夜3h×300=900 →時給部分13400。歩合 douhan 3000×2=6000。純額19400。
const _dpWage = { hourlyWage: 2500, nightPremium: { enabled: true, start: '22:00', end: '05:00', addPerHour: 300 } };
const _dpItems = [{ id: 'douhan', type: 'fixed', value: 3000 }, { id: 'fine', kind: 'penalty', fixedValue: 5000 }];
const _dpShiftBase = { start: '20:00', end: '01:00', breakMin: 0, entries: [{ backItemId: 'douhan', count: 2 }] };

test('日払い full: 純額を全額受取・差額0', () => {
  const s = { ..._dpShiftBase, dayPay: { type: 'full', cap: 0 } };
  assert.equal(dayPayReceived(_dpWage, _dpItems, s), 19400);
  assert.equal(dayPayRemaining(_dpWage, _dpItems, s), 0);
});
test('日払い base: 時給＋深夜手当のみ受取・歩合は差額', () => {
  const s = { ..._dpShiftBase, dayPay: { type: 'base', cap: 0 } };
  assert.equal(dayPayReceived(_dpWage, _dpItems, s), 13400);
  assert.equal(dayPayRemaining(_dpWage, _dpItems, s), 6000); // 歩合ぶんが後日
});
test('日払い cap: 上限1万で頭打ち・残りは差額', () => {
  const s = { ..._dpShiftBase, dayPay: { type: 'full', cap: 10000 } };
  assert.equal(dayPayReceived(_dpWage, _dpItems, s), 10000);
  assert.equal(dayPayRemaining(_dpWage, _dpItems, s), 9400);
});
test('日払い full＋ペナルティ: 純額（差引後）を受取', () => {
  const s = { ..._dpShiftBase, dayPay: { type: 'full', cap: 0 }, entries: [{ backItemId: 'douhan', count: 2 }, { backItemId: 'fine', count: 1 }] };
  assert.equal(dayPayReceived(_dpWage, _dpItems, s), 14400); // 19400 − 5000
  assert.equal(dayPayRemaining(_dpWage, _dpItems, s), 0);
});
test('日払い none/未設定: 受取0・全額が差額', () => {
  assert.equal(dayPayReceived(_dpWage, _dpItems, _dpShiftBase), 0);
  assert.equal(dayPayRemaining(_dpWage, _dpItems, _dpShiftBase), 19400);
});
test('dayPaySummary: 種別ごと集計・未受取', () => {
  const shifts = [
    { ..._dpShiftBase, dayPay: { type: 'full', cap: 0 } },   // 受取19400
    { ..._dpShiftBase, dayPay: { type: 'base', cap: 0 } },   // 受取13400（差額6000）
    { ..._dpShiftBase, dayPay: { type: 'trial', cap: 0 } },  // 受取19400
  ];
  const sm = dayPaySummary(_dpWage, _dpItems, shifts);
  assert.equal(sm.full, 19400);
  assert.equal(sm.base, 13400);
  assert.equal(sm.trial, 19400);
  assert.equal(sm.received, 52200);
  assert.equal(sm.total, 19400 * 3); // 58200
  assert.equal(sm.remaining, 58200 - 52200); // 6000
});

import {
  monthlyEstimate, monthlyWorkedHours, hourlyEquivalent,
  incomeBreakdown, backRanking, monthOverMonth,
} from '../js/calc.js';

const _items4 = [
  { id: 'douhan', name: '同伴', type: 'fixed', value: 3000 },
  { id: 'drink', name: 'ドリンクバック', type: 'rate', value: 10 },
];
const _shifts4 = [
  { start: '20:00', end: '01:00', breakMin: 0, entries: [{ backItemId: 'douhan', count: 1 }] }, // 5h
  { start: '20:00', end: '00:00', breakMin: 0, entries: [{ backItemId: 'drink', sales: 20000 }] }, // 4h
];
test('monthlyEstimate', () => { assert.equal(monthlyEstimate(2000, _items4, _shifts4), 23000); });
test('monthlyWorkedHours', () => { assert.equal(monthlyWorkedHours(_shifts4), 9); });
test('hourlyEquivalent', () => { assert.equal(hourlyEquivalent(2000, _items4, _shifts4), 2556); });
test('incomeBreakdown', () => {
  const b = incomeBreakdown(2000, _items4, _shifts4);
  assert.equal(b.wage, 18000);
  assert.equal(b.back, 5000);
  assert.equal(b.total, 23000);
  assert.equal(b.wagePct, 78.3);
  assert.equal(b.backPct, 21.7);
});
test('backRanking: 降順＋対月収比', () => {
  const r = backRanking(2000, _items4, _shifts4);
  assert.equal(r[0].name, '同伴');
  assert.equal(r[0].amount, 3000);
  assert.equal(r[1].name, 'ドリンクバック');
  assert.equal(r[1].amount, 2000);
  assert.equal(r[0].pct, 13.0);
  assert.equal(r[0].count, 1); // 同伴×1
  assert.equal(r[1].count, 0); // 売上ベースは件数0
});
test('backRanking: ペナルティ項目はランキングから除外', () => {
  const items = [
    { id: 'd', name: 'ドリンクバック', kind: 'income', fixedValue: 1000, rateValue: 0 },
    { id: 'p', name: '遅刻罰金', kind: 'penalty', fixedValue: 2000, rateValue: 0 },
  ];
  const shifts = [{ start: '20:00', end: '00:00', breakMin: 0,
    entries: [{ backItemId: 'd', count: 3 }, { backItemId: 'p', count: 1 }] }];
  const r = backRanking(2000, items, shifts);
  assert.equal(r.length, 1); // 罰金は含まない
  assert.equal(r[0].name, 'ドリンクバック');
  assert.equal(r.some((x) => x.name === '遅刻罰金'), false);
});
test('monthOverMonth', () => {
  const m = monthOverMonth(23000, 20000);
  assert.equal(m.diff, 3000);
  assert.equal(m.pct, 15.0);
});
test('monthOverMonth: 前月なしは null', () => { assert.equal(monthOverMonth(23000, null), null); });

import { plStatement } from '../js/calc.js';

const _wage5 = {
  hourlyWage: 2000, nominationWage: 2500, douhanWage: 3000,
  nightPremium: { enabled: true, start: '22:00', end: '05:00', addPerHour: 500 },
};
const _items5 = [
  { id: 'd', name: '同伴バック', kind: 'income', fixedValue: 3000, rateValue: 0 },
  { id: 'p', name: '遅刻罰金', kind: 'penalty', fixedValue: 1000, rateValue: 0 },
];
const _shifts5 = [
  // 20:00→翌02:00, 休憩0 → 実働6h, 深夜(22-05)4h。基本給。
  { date: '2026-07-01', start: '20:00', end: '02:00', breakMin: 0, entries: [] },
  // 20:00→24:00, 実働4h, 深夜2h。指名。同伴バック1件・遅刻罰金1件。
  { date: '2026-07-02', start: '20:00', end: '00:00', breakMin: 0, nomination: true,
    entries: [{ backItemId: 'd', count: 1 }, { backItemId: 'p', count: 1 }] },
];

test('plStatement: 時給を基本/指名/深夜手当に分解', () => {
  const pl = plStatement(_wage5, _items5, _shifts5);
  // 基本時給: 2000*6 = 12000（同伴なし・指名なしのシフト）
  assert.equal(pl.wageRows.find((r) => r.label === '基本時給').amount, 12000);
  // 指名時給: 2500*4 = 10000
  assert.equal(pl.wageRows.find((r) => r.label === '指名時給').amount, 10000);
  // 同伴時給行は無い（該当シフトなし）
  assert.equal(pl.wageRows.find((r) => r.label === '同伴時給'), undefined);
  // 深夜手当: (4h + 2h)*500 = 3000
  assert.equal(pl.wageRows.find((r) => r.label === '深夜手当').amount, 3000);
  assert.equal(pl.wageTotal, 25000);
});

test('plStatement: インセンティブと控除を項目別に振り分け', () => {
  const pl = plStatement(_wage5, _items5, _shifts5);
  assert.equal(pl.incentiveRows.length, 1);
  assert.equal(pl.incentiveRows[0].amount, 3000);
  assert.equal(pl.incentiveRows[0].count, 1);
  assert.equal(pl.incentiveTotal, 3000);
  assert.equal(pl.penaltyRows.length, 1);
  assert.equal(pl.penaltyRows[0].amount, -1000);
  assert.equal(pl.penaltyRows[0].count, 1);
  assert.equal(pl.penaltyTotal, -1000);
});

test('plStatement: 収入合計と差引最終合計', () => {
  const pl = plStatement(_wage5, _items5, _shifts5);
  assert.equal(pl.grossIncome, 28000); // 25000 + 3000
  assert.equal(pl.net, 27000);         // 28000 - 1000
});

test('backAmount deduction: マイナス控除（罰金以外）', () => {
  const item = { fixedValue: 1500, kind: 'deduction' };
  assert.equal(backAmount(item, { count: 2 }), -3000);
});

test('plStatement: 控除(deduction)をペナルティと別枠に振り分け', () => {
  const items = [
    ..._items5,
    { id: 'x', name: '送り代', kind: 'deduction', fixedValue: 800, rateValue: 0 },
  ];
  const shifts = [
    { date: '2026-07-01', start: '20:00', end: '02:00', breakMin: 0, entries: [] },
    { date: '2026-07-02', start: '20:00', end: '00:00', breakMin: 0, nomination: true,
      entries: [{ backItemId: 'd', count: 1 }, { backItemId: 'p', count: 1 }, { backItemId: 'x', count: 1 }] },
  ];
  const pl = plStatement(_wage5, items, shifts);
  // 罰金はペナルティ枠、送り代は控除枠に分かれる
  assert.equal(pl.penaltyRows.length, 1);
  assert.equal(pl.penaltyTotal, -1000);
  assert.equal(pl.deductionRows.length, 1);
  assert.equal(pl.deductionRows[0].label, '送り代');
  assert.equal(pl.deductionTotal, -800);
  // 差引最終 = 28000 - 1000 - 800
  assert.equal(pl.net, 26200);
});

test('backRanking: 控除項目はランキング対象外', () => {
  const items = [
    { id: 'd', name: '同伴バック', kind: 'income', fixedValue: 3000, rateValue: 0 },
    { id: 'x', name: '送り代', kind: 'deduction', fixedValue: 800, rateValue: 0 },
  ];
  const shifts = [{ date: '2026-07-02', start: '20:00', end: '00:00', breakMin: 0,
    entries: [{ backItemId: 'd', count: 1 }, { backItemId: 'x', count: 1 }] }];
  const rows = backRanking(_wage5, items, shifts);
  assert.ok(!rows.some((r) => r.itemId === 'x'));
});

test('plStatement: シフト無しは全て0・行なし', () => {
  const pl = plStatement(_wage5, _items5, []);
  assert.equal(pl.wageRows.length, 0);
  assert.equal(pl.net, 0);
});

import { annualSeries } from '../js/calc.js';

test('annualSeries: 年の12ヶ月分・該当月に集計', () => {
  const wage = { hourlyWage: 2000 };
  const items = [{ id: 'd', name: '同伴', kind: 'income', fixedValue: 3000, rateValue: 0 }];
  const shifts = [
    // 2026-03: 4h → 時給8000, 同伴1件3000
    { date: '2026-03-05', start: '20:00', end: '00:00', breakMin: 0,
      entries: [{ backItemId: 'd', count: 1 }] },
    // 2026-03: もう1日 5h → 時給10000
    { date: '2026-03-12', start: '19:00', end: '00:00', breakMin: 0, entries: [] },
    // 別年は無視
    { date: '2025-03-01', start: '20:00', end: '00:00', breakMin: 0, entries: [] },
  ];
  const s = annualSeries(wage, items, shifts, 2026);
  assert.equal(s.length, 12);
  assert.equal(s[2].month, 3);
  assert.equal(s[2].wage, 18000);      // 8000 + 10000
  assert.equal(s[2].incentive, 3000);
  assert.equal(s[2].total, 21000);
  assert.equal(s[0].total, 0);         // 1月は実績なし
  assert.equal(s[11].total, 0);        // 12月も0
});

test('shiftBackTotal: eventBack（削除イベントから残した歩合）を加算する', () => {
  const items = [{ id: 'x', kind: 'income', fixedValue: 1000 }];
  const shift = { date: '2026-08-20', entries: [{ backItemId: 'x', count: 2, sales: 0 }], eventBack: 5000 };
  // 通常歩合 1000*2=2000 ＋ eventBack 5000 = 7000
  assert.equal(shiftBackTotal(items, shift), 7000);
  // eventBack が無ければ従来どおり
  assert.equal(shiftBackTotal(items, { entries: [{ backItemId: 'x', count: 1, sales: 0 }] }), 1000);
});

import { backItemStats } from '../js/calc.js';

test('backItemStats: 項目ごとに今月の件数・金額を集計', () => {
  const items = [
    { id: 'a', kind: 'income', fixedValue: 1000 },
    { id: 'b', kind: 'penalty', fixedValue: 500 },
    { id: 'c', kind: 'income', rateValue: 10 },
  ];
  const shifts = [
    { entries: [{ backItemId: 'a', count: 2 }, { backItemId: 'b', count: 1 }] },
    { entries: [{ backItemId: 'a', count: 3 }, { backItemId: 'c', sales: 20000 }] },
  ];
  const st = backItemStats(items, shifts);
  assert.deepEqual(st.get('a'), { count: 5, amount: 5000 });   // 1000*(2+3)
  assert.deepEqual(st.get('b'), { count: 1, amount: -500 });   // ペナルティはマイナス
  assert.deepEqual(st.get('c'), { count: 0, amount: 2000 });   // 20000*10%
});

test('backItemStats: 未登録項目・空入力に耐性', () => {
  const st = backItemStats([{ id: 'a', kind: 'income', fixedValue: 100 }], [
    { entries: [{ backItemId: 'ghost', count: 9 }] }, // 存在しないID
    {}, // entries なし
  ]);
  assert.deepEqual(st.get('a'), { count: 0, amount: 0 });
  assert.equal(st.has('ghost'), false);
});

import { dailySeries } from '../js/calc.js';

test('dailySeries: 月内の日別収入を日付順に合算する', () => {
  const wage = { hourlyWage: 1000 };
  const shifts = [
    { date: '2026-09-03', start: '20:00', end: '24:00', breakMin: 0, entries: [] }, // 4h=4000
    { date: '2026-09-01', start: '18:00', end: '20:00', breakMin: 0, entries: [] }, // 2h=2000
    { date: '2026-08-31', start: '18:00', end: '22:00', breakMin: 0, entries: [] }, // 別月=除外
  ];
  const s = dailySeries(wage, [], shifts, '2026-09');
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], { date: '2026-09-01', day: 1, amount: 2000 });
  assert.deepEqual(s[1], { date: '2026-09-03', day: 3, amount: 4000 });
});

test('dailySeries: 同じ日の複数シフトは合算', () => {
  const wage = { hourlyWage: 1000 };
  const shifts = [
    { date: '2026-09-05', start: '18:00', end: '20:00', breakMin: 0, entries: [] }, // 2000
    { date: '2026-09-05', start: '22:00', end: '24:00', breakMin: 0, entries: [] }, // 2000
  ];
  const s = dailySeries(wage, [], shifts, '2026-09');
  assert.equal(s.length, 1);
  assert.equal(s[0].amount, 4000);
});
