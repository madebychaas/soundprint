/**
 * Automated interaction checks against the PRODUCTION build.
 *
 *   npm run build && npm run preview        (one terminal)
 *   npm run test:smoke                      (another; needs `playwright` resolvable)
 *
 * Drives the real UI with real pointer / keyboard events and reads state from the
 * `window.__lf` handle. It proves wiring, state machines and the mechanical
 * relationships of the model — it cannot judge how anything looks, feels or sounds,
 * and it says nothing about real hardware.
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173';
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const until = (page, fn, timeout = 30000, arg) => page.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const settle = (page, ms = 1500) => page.waitForTimeout(ms);
const idleIn = (view, p) => `(() => { const L = window.__lf, s = L.store.getState(); return s.view === '${view}' && !s.transitioning${p === undefined ? '' : ` && L.runtime.journey === ${p}`}; })()`;
const screenOf = (page, p) => ev(page, ([a, b, c]) => window.__lf.directorDebug.screenOf(a, b, c), p);
/** click a button by accessible name without letting a missing control abort the whole run */
const click = (page, name, opts = {}) => page.getByRole('button', { name, ...opts }).click({ timeout: 20000 }).then(() => true, (e) => { console.log(`  (could not click ${name}: ${String(e).split('\n')[0]})`); return false; });
const quiet = (page) => until(page, () => !window.__lf.sim.gate && window.__lf.synth.activeVoices === 0 && window.__lf.sim.x < 0.02, 20000);

async function open(browser, opts, query) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/?q=low&nolag=1${query || ''}`, { waitUntil: 'load' });
  const ready = await until(page, () => window.__lf && window.__lf.store.getState().ready, 120000);
  return { ctx, page, errors, ready };
}

/** Journey in, play the cap from inside, journey out. Used for both node models. */
async function journeyAndPlay(page, tag) {
  await click(page, /Enter node/);
  let ok = await until(page, idleIn('interior', 1), 90000);
  check(`${tag}: journey in completes inside the node`, ok, JSON.stringify(await ev(page, () => ({ p: window.__lf.runtime.journey, view: window.__lf.store.getState().view }))));
  ok = await until(page, () => window.__lf.runtime.entryCut > 45.2, 45000);
  check(`${tag}: section plane re-parks (enclosure closed)`, ok, `entryCut ${await ev(page, () => window.__lf.runtime.entryCut.toFixed(1))}`);
  check(`${tag}: cap lift is never used`, await ev(page, () => window.__lf.runtime.capLift === 0));
  await settle(page);
  const probe = await ev(page, () => window.__lf.profile().probe);
  const pt = await screenOf(page, probe.capInside);
  const n0 = await ev(page, () => window.__lf.sim.noteCount);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  ok = await until(page, (n) => window.__lf.sim.noteCount > n, 15000, n0);
  check(`${tag}: tap on the cap's underside → note-on`, ok);
  check(`${tag}: tap ends → note-off, no voice left`, await quiet(page));
  check(`${tag}: tapping the cap does not select it`, await ev(page, () => window.__lf.store.getState().selectedPart === null));
  return { probe, pt };
}

const ONLY = (process.env.SMOKE_ONLY || '').split(',').filter(Boolean);
const run = (name) => ONLY.length === 0 || ONLY.includes(name);

(async () => {
  const browser = await chromium.launch({ args: GL });
  if (run('main')) {
  // 1000 px keeps the desktop layout (the tablet / phone sheet starts at 860 px)
  const { ctx, page, errors, ready } = await open(browser, { viewport: { width: 1000, height: 640 } });
  check('app boots and reports ready', ready);

  // ── the real model is what is on screen ─────────────────────────────
  const boot = await ev(page, () => ({ model: window.__lf.store.getState().nodeModel, gap: window.__lf.sim.gap, m: window.__lf.mechanics() }));
  check('primary experience uses ORBITAL BLOOM 02', boot.model === 'ob02');
  check('all 18 named GLB meshes are mounted', boot.m && new Set(boot.m.meshNames).size === 18, `${boot.m ? new Set(boot.m.meshNames).size : 0} names`);
  check('simulation rest gap follows the CAD (tip touching the FSR)', boot.gap === 0);

  // ── entry from the hero, then play from inside ──────────────────────
  await click(page, 'Enter the instrument');
  let ok = await until(page, idleIn('interior', 1), 120000);
  check('hero → exterior → interior chained journey completes', ok);
  await click(page, /Exit node/);
  ok = await until(page, idleIn('sculptural', 0), 90000);
  check('journey out completes outside the node', ok);
  const { probe, pt } = await journeyAndPlay(page, 'real model');

  // ── mechanical relationships while the cap is held from inside ──────
  const rest = await ev(page, () => window.__lf.mechanics());
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  ok = await until(page, () => window.__lf.sim.gate && window.__lf.sim.fsr > 0.05 && window.__lf.synth.activeVoices === 1 && window.__lf.sim.v < 0.5 && window.__lf.sim.x > 0.3, 20000);
  check('press-and-hold on the cap → gate on, FSR loaded, one voice', ok);
  await settle(page, 700);
  const held = await ev(page, () => window.__lf.mechanics());
  const d = (k) => +(held[k] - rest[k]).toFixed(3);
  const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol;
  const moving = ['cap', 'puck', 'piezoDisc', 'piezoCeramic'].map((k) => [k, d(k)]);
  const still = ['shell', 'tray', 'fsrHead', 'fsrTail'].map((k) => [k, d(k)]);
  check('cap, puck and piezo move down together by the cap travel', moving.every(([, v]) => near(v, -held.x, 0.05)), `x=${held.x} ${JSON.stringify(moving)}`);
  check('shell, tray and FSR stay still', still.every(([, v]) => near(v, 0, 0.001)), JSON.stringify(still));
  check('bumpers compress rather than travel', held.bumperScaleY < 0.99 && near(held.bumperScaleY, (3 - held.x) / 3, 0.02), `scaleY ${held.bumperScaleY}`);
  check('soft tip compresses between puck and FSR', held.tipScaleY < 0.99 && near(held.tipScaleY, (2 - held.x) / 2, 0.02), `scaleY ${held.tipScaleY}`);
  check('travel never exceeds the 0.95 mm stop', held.x <= 0.9501);
  await page.mouse.up();
  check('release → gate off, voice released, cap back at rest', await quiet(page));

  // ── component selection with a real click ───────────────────────────
  const fp = await screenOf(page, probe.pick.at);
  const under = await ev(page, ([x, y]) => document.elementFromPoint(x, y)?.tagName, [fp.x, fp.y]);
  await page.mouse.click(fp.x, fp.y);
  await settle(page, 800);
  let sel = await ev(page, () => window.__lf.store.getState().selectedPart);
  check(`clicking the ${probe.pick.part} in the 3D view selects it`, sel === probe.pick.part, `selected: ${sel} (element under pointer: ${under})`);
  if (sel) {
    await click(page, /Isolate/);
    ok = await until(page, () => window.__lf.runtime.partFade.shelf < 0.2 && !window.__lf.store.getState().transitioning, 30000);
    check('isolate fades every other part', ok);
  } else check('isolate fades every other part', false, 'nothing was selected');
  await page.keyboard.press('Escape');
  await until(page, () => !window.__lf.store.getState().transitioning && window.__lf.store.getState().selectedPart === null, 30000);

  // ── exit, then an interrupted journey ───────────────────────────────
  await click(page, /Exit node/);
  ok = await until(page, idleIn('sculptural', 0), 90000);
  check('journey out (after exploring) completes', ok);
  await click(page, /Enter node/);
  ok = await until(page, () => window.__lf.runtime.journey > 0.12 && window.__lf.runtime.journey < 0.9, 60000);
  const pMid = await ev(page, () => +window.__lf.runtime.journey.toFixed(2));
  // mid-flight the renderer is busy, so Playwright's own "is it stable" wait can starve: the button is
  // visible and hit-testable (checked separately), so click it directly
  await page.getByRole('button', { name: /exit node/i }).click({ force: true, timeout: 20000 }).catch((e) => console.log('  (interrupt click failed: ' + String(e).split('\n')[0] + ')'));
  const ok2 = await until(page, idleIn('sculptural', 0), 90000);
  check('interrupted journey reverses mid-flight and lands outside', ok && ok2, `turned at p=${pMid}`);

  // ── exterior: the pad itself ────────────────────────────────────────
  await settle(page);
  const top = await screenOf(page, [0, await ev(page, () => window.__lf.profile().padTopY), 0]);
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  ok = await until(page, () => window.__lf.sim.gate && window.__lf.synth.activeVoices === 1, 15000);
  check('exterior: pressing the pad surface → note-on, one voice', ok, `velocity ${await ev(page, () => window.__lf.sim.velocity)}`);
  const p1 = await ev(page, () => window.__lf.store.getState().pressure);
  await page.mouse.move(top.x, top.y + 70, { steps: 4 });
  await settle(page, 400);
  const p2 = await ev(page, () => window.__lf.store.getState().pressure);
  check('exterior: dragging down raises pressure', p2 > p1, `${p1.toFixed(2)} → ${p2.toFixed(2)}`);
  await page.mouse.up();
  check('exterior: release → note-off, no stuck voice', await quiet(page));

  // ── accessible alternatives ─────────────────────────────────────────
  await page.keyboard.down('Space');
  ok = await until(page, () => window.__lf.sim.gate, 15000);
  await page.keyboard.up('Space');
  check('keyboard: Space holds and releases a note', ok && (await quiet(page)));
  await click(page, 'Hold');
  ok = await until(page, () => window.__lf.sim.gate, 15000);
  await click(page, 'Release');
  check('panel: Hold latches and Release ends the note', ok && (await quiet(page)));
  await page.keyboard.press('x');
  await settle(page, 800);
  check('shortcut works with a button focused; FSR-only removes the piezo', await ev(page, () => window.__lf.sim.arch === 'fsr' && window.__lf.mechanics().piezoVisible === false));
  await page.keyboard.press('x');

  // ── exploded assembly ───────────────────────────────────────────────
  await click(page, 'Exploded', { exact: true });
  ok = await until(page, () => { const L = window.__lf, s = L.store.getState(); if (s.view !== 'exploded' || s.transitioning) return false; return L.profile().parts.every((p) => Math.abs(L.runtime.partOffset[p.id] - p.explode) < 0.6); }, 90000);
  check('exploded: every part reaches its offset on the assembly axis', ok, JSON.stringify(await ev(page, () => Object.fromEntries(window.__lf.profile().parts.map((p) => [p.id, Math.round(window.__lf.runtime.partOffset[p.id])])))));
  const first = await ev(page, () => window.__lf.profile().steps[0].part);
  await click(page, 'Next assembly step');
  ok = await until(page, (id) => Math.abs(window.__lf.runtime.partOffset[id]) < 0.5, 40000, first);
  check('exploded: the first step seats only its own part', ok && (await ev(page, (id) => window.__lf.profile().parts.filter((p) => p.id !== id && p.explode !== 0).every((p) => Math.abs(window.__lf.runtime.partOffset[p.id]) > 1), first)), `step 1 = ${first}`);
  await click(page, 'Explode all');
  await click(page, 'Assemble all');
  ok = await until(page, () => Object.values(window.__lf.runtime.partOffset).every((v) => Math.abs(v) < 0.5), 60000);
  check('exploded: the device reassembles completely', ok);
  await ev(page, () => window.__lf.play.strike(0.9));
  check('exploded: play is disabled while the view is open', !(await until(page, () => window.__lf.sim.gate, 1500)));

  // ── cutaway ─────────────────────────────────────────────────────────
  await click(page, 'Cutaway', { exact: true });
  ok = await until(page, () => { const L = window.__lf, s = L.store.getState(); return s.view === 'cutaway' && !s.transitioning && L.runtime.cutReveal > 0.9; }, 90000);
  check('cutaway: section plane sweeps to the user position', ok);
  await page.getByLabel('Section plane position').fill('10');
  await page.getByLabel('Section plane rotation').fill('30');
  const cut = await ev(page, () => { const s = window.__lf.store.getState(); return { o: s.cutOffset, a: s.cutAngle }; });
  check('cutaway: position and rotation controls move the plane', cut.o === 10 && cut.a === 30, JSON.stringify(cut));
  await page.locator('canvas').first().click({ position: { x: 5, y: 300 } }); // move focus off the sliders
  await page.keyboard.down('Space');
  ok = await until(page, () => window.__lf.sim.x > 0.3 && window.__lf.sim.gate, 15000);
  await page.keyboard.up('Space');
  check('cutaway: the mechanism responds while sectioned', ok);
  await quiet(page);

  // ── mute, back navigation ───────────────────────────────────────────
  await click(page, 'Mute sound');
  await page.locator('canvas').first().click({ position: { x: 5, y: 300 } });
  await page.keyboard.down('Space'); await settle(page, 1500);
  const mutedVoices = await ev(page, () => window.__lf.synth.activeVoices);
  await page.keyboard.up('Space');
  check('mute: no voice is created while muted', mutedVoices === 0);
  await click(page, 'Unmute sound');
  await quiet(page);
  await page.keyboard.press('Escape');
  ok = await until(page, idleIn('sculptural'), 60000);
  await page.keyboard.press('Escape');
  check('back navigation: Escape steps cutaway → exterior → instrument', ok && (await until(page, idleIn('artifact'), 60000)));

  check('no console or page errors (desktop run)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
  }

  if (run('compare')) {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 1000, height: 640 } });
    let ok;
  // ── parametric comparison is still there and still works ────────────
  await click(page, /Technical specification|Specs/);
  await page.getByRole('radio', { name: 'Parametric comparison' }).click();
  ok = await until(page, () => window.__lf.store.getState().nodeModel === 'parametric' && window.__lf.sim.gap > 0.19 && !window.__lf.store.getState().transitioning, 30000);
  check('comparison: switching to the parametric stand-in works', ok);
  await page.keyboard.press('Escape'); // close the panel
  await click(page, 'Exterior', { exact: true });
  await until(page, idleIn('sculptural', 0), 60000);
  await journeyAndPlay(page, 'parametric');
  await click(page, /Exit node/);
  check('parametric: journey out completes', await until(page, idleIn('sculptural', 0), 90000));
  await ev(page, () => window.__lf.store.getState().setModel('ob02'));
  check('comparison: switching back restores the real model and its gap', await until(page, () => window.__lf.store.getState().nodeModel === 'ob02' && window.__lf.sim.gap === 0 && window.__lf.mechanics() && window.__lf.mechanics().cap !== null, 30000));
    check('no console or page errors (comparison run)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── phone ───────────────────────────────────────────────────────────
  if (run('phone')) {
    const m = await open(browser, { viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }, '&instant=1');
    check('phone: boots', m.ready);
    check('phone: page does not scroll sideways', await ev(m.page, () => document.scrollingElement.scrollWidth <= window.innerWidth + 1));
    await m.page.getByRole('button', { name: 'Exterior', exact: true }).tap();
    check('phone: view tabs navigate', await until(m.page, idleIn('sculptural'), 40000));
    check('phone: bottom sheet with Play controls is present', await m.page.locator('.sheet .btn.strike').isVisible());
    await settle(m.page);
    const n = await ev(m.page, () => window.__lf.sim.noteCount);
    const pt2 = await screenOf(m.page, [0, await ev(m.page, () => window.__lf.profile().padTopY), 0]);
    await m.page.touchscreen.tap(pt2.x, pt2.y);
    check('phone: tapping the pad surface → note-on', await until(m.page, (k) => window.__lf.sim.noteCount > k, 15000, n));
    check('phone: tap ends → note-off', await quiet(m.page));
    check('no console or page errors (phone run)', m.errors.length === 0, m.errors.slice(0, 3).join(' | '));
    await m.ctx.close();
  }

  // ── reduced motion ──────────────────────────────────────────────────
  if (run('motion')) {
    const r = await open(browser, { viewport: { width: 860, height: 560 }, reducedMotion: 'reduce' });
    await r.page.getByRole('button', { name: 'Interior', exact: true }).click();
    check('reduced motion: interior is reached by a cut, not a flight', await until(r.page, idleIn('interior', 1), 10000));
    await r.ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} / ${results.length} checks passed`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' · '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('SUITE ERROR', e); process.exit(2); });
