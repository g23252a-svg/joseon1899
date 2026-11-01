// 브라우저 시험: 실제 화면으로 새 게임 → 명령 → 여러 철 넘기기. 콘솔 오류를 모으고 스크린숏을 남긴다.
//   node tools/browser.mjs [--turns=6] [--scenario=0|1] [--faction=0] [--mobile] [--out=/tmp/paldo]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = args.out || '/tmp/paldo-shots';
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext(args.mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForSelector('.logo');
const seen = new Set();
let n = 0;
const shot = async (name) => { await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` }); };
await shot('title');
const click = async (sel, opts = {}) => { const el = page.locator(sel).first(); await el.click({ timeout: 4000, ...opts }); };
await page.getByRole('button', { name: '새로 시작' }).click();
await page.locator('.card').nth(Number(args.scenario || 0)).click();
await shot('factions');
await page.locator('.card').nth(Number(args.faction || 0)).click();
await page.getByRole('button', { name: /보통/ }).click();
await page.waitForTimeout(400);
await shot('intro');
await page.getByRole('button', { name: '시작한다' }).click();
await page.waitForTimeout(300);
await shot('tech');
// 연구 고르기
const av = page.locator('.tech.av').first();
if (await av.count()) await av.click();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await shot('map');
// 장수에게 명령
const card = page.locator('#panel .ocard:not(.done)').first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(200);
  await shot('actions');
  const act = page.locator('.act:not([disabled])').first();
  await act.click();
  await page.waitForTimeout(300);
  // 매개변수 창이 열리면 닫는다
  if (await page.locator('.scrim').count()) await page.keyboard.press('Escape');
}
// 화면들 열어 보기
for (const [key, name] of [['p', 'politics'], ['o', 'officers'], ['f', 'factions'], ['d', 'diplomacy'], ['l', 'chronicle']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  await shot(name);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
}
// 출진 시험: 이웃 중립 고을
const atk = page.locator('#panel button.btn.red', { hasText: '출진' });
if (await atk.count() && await atk.isEnabled()) {
  await atk.click();
  await page.waitForTimeout(300);
  // 대상이 여럿이면 첫 버튼
  const pick = page.locator('.scrim .db .row button.btn').first();
  if (await page.locator('.scrim h2', { hasText: '어디를 칠까' }).count()) await pick.click();
  await page.waitForTimeout(800);
  await shot('attack-dialog');
  const go = page.locator('.scrim button.btn.red', { hasText: '출진' });
  if (await go.count() && await go.isEnabled()) {
    await go.click();
    await page.waitForTimeout(1200);
    await shot('battle');
    // 몇 라운드 직접
    for (let i = 0; i < 3; i++) {
      const t = page.locator('.tac:not([disabled])').first();
      if (!(await t.count())) break;
      await t.click().catch(() => {});
      await page.waitForTimeout(900);
      // 일기토 확인 창
      if (await page.locator('.scrim h2', { hasText: '일기토 신청' }).count()) await page.getByRole('button', { name: '받는다' }).click();
      if (await page.locator('.duel').count()) { await shot('duel'); await page.getByRole('button', { name: '맡기기', exact: true }).click().catch(() => {}); await page.waitForTimeout(300); await page.locator('.scrim .df button.btn.primary').last().click({ timeout: 3000 }).catch(() => {}); }
    }
    await shot('battle-mid');
    const skip = page.getByRole('button', { name: '끝까지 맡기기' });
    if (await skip.count()) await skip.click();
    await page.waitForTimeout(500);
    await shot('battle-end');
    await page.locator('.bres button', { hasText: '확인' }).click().catch(() => {});
    await settle();
  }
}

async function settle(maxMs = 60000) {
  const t0 = Date.now();
  let idle = 0;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(150);
    const scrims = await page.locator('.scrim').count();
    const busy = await page.locator('.busy').count();
    const turning = await page.locator('.endturn:disabled').count();
    if (!scrims && !busy && !turning) { if (++idle > 4) return; continue; }
    idle = 0;
    for (const [sel, name] of [['.evt', 'event'], ['.duel', 'duel'], ['.scrim h2:text-is("포로")', 'captive'], ['.scrim h2:text-is("적의 침공!")', 'invasion'], ['.bres', 'battle-result']]) {
      if (!seen.has(name) && await page.locator(sel).count()) { seen.add(name); await page.waitForTimeout(250); await shot('seen-' + name); }
    }
    const tryBtn = async (loc) => { if (await loc.count()) { await loc.first().click({ timeout: 1500 }).catch(() => {}); return true; } return false; };
    if (await tryBtn(page.locator('.scrim .choice:not([disabled])'))) continue;
    if (await tryBtn(page.locator('.bres button'))) continue;
    if (await tryBtn(page.getByRole('button', { name: '끝까지 맡기기' }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '수비대장에게 맡긴다' }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '맡기기', exact: true }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '석방', exact: true }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '물리친다', exact: true }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '피한다', exact: true }))) continue;
    if (await tryBtn(page.getByRole('button', { name: '넘긴다', exact: true }))) continue;
    if (await tryBtn(page.locator('.scrim .df button.btn.primary'))) continue;
    if (await tryBtn(page.locator('.scrim .dh .x'))) continue;
  }
  errors.push('settle timeout'); await shot('settle-timeout');
}
const turns = Number(args.turns || 6);
for (let t = 0; t < turns; t++) {
  try { await page.locator('.endturn').click({ timeout: 10000 }); }
  catch (e) {
    await shot('stuck');
    const info = await page.evaluate(() => ({ scrims: [...document.querySelectorAll('.scrim h2')].map((x) => x.textContent), busy: !!document.querySelector('.busy'), dis: document.querySelector('.endturn')?.disabled, top: document.elementFromPoint(document.querySelector('.endturn').getBoundingClientRect().x + 5, document.querySelector('.endturn').getBoundingClientRect().y + 5)?.className }));
    errors.push('endturn 막힘: ' + JSON.stringify(info));
    break;
  }
  await page.waitForTimeout(200);
  await settle();
  if (t === 0 || t === turns - 1) await shot('turn' + (t + 1));
}
// 모바일: 고을 판 펼친 모습
if (args.mobile) { await page.locator('#panel .ph').click().catch(() => {}); await page.waitForTimeout(300); await shot('mobile-panel'); }
const state = await page.evaluate(() => document.querySelector('.fdate')?.textContent);
console.log('도착:', state, '스크린숏:', out);
console.log(errors.length ? '오류:\n' + errors.join('\n') : '콘솔 오류 없음');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
