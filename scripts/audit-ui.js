const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.AUDIT_URL || 'https://localhost:3000/';
const OUT_DIR = path.join(process.cwd(), 'tmp-audit');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function inspectPage(page, label) {
  return page.evaluate((label) => {
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const activeViews = [...document.querySelectorAll('.app-view.active')];
    const overflow = [...document.querySelectorAll('body *')]
      .filter((el) => visible(el) && el.scrollWidth > el.clientWidth + 4)
      .slice(0, 12)
      .map((el) => ({
        tag: el.tagName,
        id: el.id,
        className: String(el.className).slice(0, 80),
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth
      }));

    return {
      label,
      title: document.title,
      activeViews: activeViews.map((el) => el.id),
      headings: [...document.querySelectorAll('.app-view.active h1,.app-view.active h2,.app-view.active h3')]
        .filter(visible)
        .map((el) => (el.innerText || '').trim())
        .slice(0, 20),
      anchors: [...document.querySelectorAll('a')]
        .filter(visible)
        .map((a) => ({ text: (a.innerText || '').trim(), href: a.href })),
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: document.body.scrollWidth - window.innerWidth,
      overflow
    };
  }, label);
}

async function main() {
  ensureDir(OUT_DIR);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  const report = {
    url: BASE_URL,
    generatedAt: new Date().toISOString(),
    failures: [],
    pages: []
  };

  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900, isMobile: false },
    { name: 'mobile', width: 390, height: 844, isMobile: true }
  ]) {
    const page = await browser.newPage();
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      isMobile: viewport.isMobile,
      deviceScaleFactor: 1
    });

    const consoleErrors = [];
    const failedRequests = [];
    page.on('console', (msg) => {
      if (['error', 'warning'].includes(msg.type())) consoleErrors.push(msg.text());
    });
    page.on('requestfailed', (req) => {
      failedRequests.push({ url: req.url(), errorText: req.failure()?.errorText || '' });
    });

    const response = await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#view-dashboard.active', { timeout: 10000 });

    const dashboard = await inspectPage(page, `${viewport.name}:dashboard`);
    await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-dashboard.png`), fullPage: true });
    report.pages.push({ viewport, status: response.status(), consoleErrors, failedRequests, ...dashboard });

    for (const view of ['login', 'admin', 'finance', 'certificates']) {
      await page.evaluate((view) => {
        if (typeof showView === 'function') showView(view);
        if (window.lucide) lucide.createIcons();
      }, view);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const data = await inspectPage(page, `${viewport.name}:${view}`);
      await page.screenshot({ path: path.join(OUT_DIR, `${viewport.name}-${view}.png`), fullPage: true });
      report.pages.push({ viewport, consoleErrors, failedRequests, ...data });

      const hasExpectedView = data.activeViews.includes(`view-${view}`);
      const hasVisibleHeading = data.headings.length > 0;
      if (!hasExpectedView || !hasVisibleHeading) {
        report.failures.push(`${viewport.name}:${view} did not render a visible active screen`);
      }
    }

    const resources = await page.evaluate(async () => {
      const urls = ['/css/styles.css', '/js/app.js', '/favicon.svg'];
      const checks = [];
      for (const url of urls) {
        const res = await fetch(url, { cache: 'no-store' });
        checks.push({ url, status: res.status, contentType: res.headers.get('content-type') });
      }
      return checks;
    });
    for (const resource of resources) {
      if (resource.status !== 200) report.failures.push(`${resource.url} returned ${resource.status}`);
      if (resource.url.endsWith('.svg') && !String(resource.contentType || '').includes('svg')) {
        report.failures.push(`${resource.url} did not return SVG content`);
      }
    }

    await page.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, 'ui-audit-report.json'), JSON.stringify(report, null, 2));

  if (report.failures.length) {
    console.error(report.failures.join('\n'));
    process.exit(1);
  }

  console.log(`UI audit passed. Report: ${path.join(OUT_DIR, 'ui-audit-report.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
