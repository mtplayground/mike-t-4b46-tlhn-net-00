const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const deployUrl = fs.readFileSync('/workspace/.deploy_url', 'utf8').trim();
  if (!deployUrl) {
    console.log('UI_VERIFY: FAIL | /workspace/.deploy_url empty');
    return;
  }

  const failures = [];
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    failedRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText || ''}`);
  });
  page.on('response', resp => {
    const url = resp.url();
    const status = resp.status();
    if (status >= 400 && !url.includes('/api/files') && !url.includes('/favicon')) {
      badResponses.push(`${status} ${url}`);
    }
  });

  try {
    const resp = await page.goto(deployUrl, { waitUntil: 'networkidle', timeout: 30000 });
    if (!resp || resp.status() !== 200) failures.push(`root returned ${resp ? resp.status() : 'no response'}`);

    const titleText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    if (!titleText || titleText.trim().length < 50) failures.push('page body is blank or too short');
    if (/deployment ready|myClawTeam user app is online|The Sprite service is serving/i.test(titleText)) failures.push('placeholder deployment page shown');
    if (/MONOREPO INITIALIZED|ready for feature work|React client and Express API are ready/i.test(titleText)) failures.push('scaffold placeholder copy shown');
    if (!/TLHN|THE LAST HUMAN NETWORK|The Last Human Network/i.test(titleText)) failures.push('expected TLHN content not found');

    const logo = page.locator('#landing-title, .tlhn-neon-logo').first();
    await logo.waitFor({ state: 'visible', timeout: 10000 }).catch(() => failures.push('landing logo not visible'));

    const bodyStyles = await page.evaluate(() => {
      const body = document.body;
      const s = getComputedStyle(body);
      const main = document.querySelector('.tlhn-screen') || body;
      const ms = getComputedStyle(main);
      return { bg: s.backgroundColor, color: s.color, font: s.fontFamily, minHeight: ms.minHeight, display: ms.display };
    });
    if (!bodyStyles.bg || bodyStyles.bg === 'rgba(0, 0, 0, 0)' || bodyStyles.bg === 'transparent') failures.push('body background style not applied');
    if (!bodyStyles.color || bodyStyles.color === 'rgb(0, 0, 0)') failures.push('expected dark theme text color not applied');
    if (!/100vh|100dvh/.test(bodyStyles.minHeight) && bodyStyles.display !== 'flex') failures.push('app shell layout styles not applied');

    const logoutVisible = await page.locator('text=/logout|sign out/i').count();
    if (logoutVisible > 0) failures.push('logout/sign-out shown to anonymous user');

    const networkLink = page.locator('a[href="/network"]').first();
    if (await networkLink.count()) {
      await networkLink.click({ timeout: 10000 });
    } else {
      await page.getByText(/ENTER THE NETWORK/i).first().click({ timeout: 10000 });
    }
    await page.waitForURL(/\/network$/, { timeout: 10000 }).catch(() => failures.push('navigation to /network did not update URL'));
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const networkText = await page.locator('body').innerText().catch(() => '');
    if (!/Choose a side|Faction feeds|TIME LEFT UNTIL AI DOMINATES/i.test(networkText)) failures.push('network page meaningful content missing');

    const modalVisible = await page.locator('[role="dialog"], .tlhn-faction-modal').first().isVisible().catch(() => false);
    if (!modalVisible) failures.push('faction selection modal not visible on first network entry');

    const haterButton = page.locator('button:has-text("AI Haters")').first();
    if (await haterButton.isVisible().catch(() => false)) {
      await haterButton.click();
      await page.waitForTimeout(1500);
      const afterJoin = await page.locator('body').innerText().catch(() => '');
      if (!/connected|Live channel|Broadcast to the network/i.test(afterJoin)) failures.push('joining faction did not unlock network identity/composer');
    } else {
      failures.push('AI Haters join button missing');
    }

    const networkStyles = await page.evaluate(() => {
      const el = document.querySelector('.tlhn-network-layout') || document.body;
      const s = getComputedStyle(el);
      const tally = document.querySelector('.tlhn-faction-tally');
      const ts = tally ? getComputedStyle(tally) : null;
      return { display: s.display, gap: s.gap, tallyBorder: ts?.borderTopColor || '', tallyBg: ts?.backgroundColor || '' };
    });
    if (networkStyles.display !== 'grid' && networkStyles.display !== 'flex') failures.push('network layout CSS not applied');
    if (!networkStyles.tallyBorder || networkStyles.tallyBorder === 'rgba(0, 0, 0, 0)') failures.push('tally panel styling not applied');

    await page.screenshot({ path: '/workspace/verify-screenshot.png', fullPage: true });

    // Allow initial polling errors to surface.
    await page.waitForTimeout(1000);

    const relevantConsoleErrors = consoleErrors.filter(e => !/favicon/i.test(e));
    if (relevantConsoleErrors.length) failures.push(`console errors: ${relevantConsoleErrors.slice(0, 3).join(' ; ')}`);
    const relevantFailed = failedRequests.filter(e => !/favicon/i.test(e));
    if (relevantFailed.length) failures.push(`failed network requests: ${relevantFailed.slice(0, 3).join(' ; ')}`);
    const relevantBad = badResponses.filter(e => !/\/api\/files\b/.test(e));
    if (relevantBad.length) failures.push(`HTTP error responses: ${relevantBad.slice(0, 5).join(' ; ')}`);
  } catch (err) {
    failures.push(`playwright exception: ${err && err.message ? err.message : String(err)}`);
    try { await page.screenshot({ path: '/workspace/verify-screenshot.png', fullPage: true }); } catch {}
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.log(`UI_VERIFY: FAIL | ${failures.join(' | ')}`);
  } else {
    console.log('UI_VERIFY: PASS');
  }
})();
