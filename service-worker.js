const CACHE = 'yashoku-v188';
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './assets/logo.png', './assets/icon-192.png', './assets/icon-512.png',
  './js/app.js', './js/state.js', './js/db.js', './js/calc.js', './js/format.js',
  './js/customers-logic.js', './js/events-logic.js', './js/reminders-logic.js',
  './js/tax-logic.js', './js/presets.js',
  './js/audit-logic.js', './js/version.js', './changelog.json', './js/entitlement.js',
  './js/subscription-logic.js', './js/ui/lapsed.js',
  './js/rc.js', './js/vendor/purchases-js.mjs',
  './js/ui/pdf.js', './js/vendor/jspdf.mjs', './js/vendor/html2canvas.mjs',
  './js/ui/icons.js', './js/ui/update.js', './js/ui/notifications.js', './js/ui/paywall.js',
  './js/ui/home.js', './js/ui/calendar.js', './js/ui/record.js',
  './js/ui/report.js', './js/ui/settings.js', './js/ui/donut.js',
  './js/ui/backfields.js', './js/ui/todos.js', './js/ui/customers.js',
  './js/ui/mypage.js', './js/ui/legal.js',
  './js/ui/toast.js', './js/ui/events.js', './js/ui/confirm.js',
  './js/ui/reminders.js', './js/ui/onboarding.js', './js/ui/help.js',
  './js/ui/backitems.js', './js/ui/itempicker.js', './js/ui/premium-gate.js',
  './js/ui/dailychart.js', './js/ui/goal.js', './js/ui/history.js',
];
self.addEventListener('install', (e) => {
  // skipWaiting はここでは呼ばない。新SWは「待機」状態で止め、アプリ内の
  // 「今すぐ更新」ボタン（SKIP_WAITING メッセージ）で初めて有効化する。
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
// アプリから更新の合図を受けたら待機を解除して有効化する。
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// stale-while-revalidate: キャッシュを即返しつつ裏で最新を取得してキャッシュ更新。
// → アセット編集後はリロード1回で反映される。オフライン時はキャッシュで動作。
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((cached) => {
        const network = fetch(e.request)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    )
  );
});
