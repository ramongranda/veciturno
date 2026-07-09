const puppeteer = require('puppeteer');

const VIEWS = [
  { name: 'dashboard', kind: 'view', id: 'dashboard' },
  { name: 'login', kind: 'view', id: 'login' },
  { name: 'register', kind: 'view', id: 'register' },
  { name: 'profile', kind: 'view', id: 'profile' },
  { name: 'passkey-manage', kind: 'view', id: 'passkey-manage' },
  { name: 'edit-neighbor', kind: 'view', id: 'edit-neighbor' },
  { name: 'setup-2fa', kind: 'view', id: 'setup-2fa' },
  { name: 'finance', kind: 'view', id: 'finance' },
  { name: 'certificates', kind: 'view', id: 'certificates' },
  { name: 'admin-users', kind: 'panel', id: 'users' },
  { name: 'admin-invites', kind: 'panel', id: 'invites' },
  { name: 'admin-visualization', kind: 'panel', id: 'visualization' },
  { name: 'admin-areas', kind: 'panel', id: 'areas' },
  { name: 'admin-fees', kind: 'panel', id: 'fees' },
  { name: 'admin-finance', kind: 'panel', id: 'finance' },
  { name: 'admin-whatsapp', kind: 'panel', id: 'whatsapp' },
  { name: 'admin-templates', kind: 'panel', id: 'templates' },
  { name: 'admin-announcements', kind: 'panel', id: 'announcements' },
  { name: 'admin-incidents', kind: 'panel', id: 'incidents' },
  { name: 'admin-documents', kind: 'panel', id: 'documents' },
  { name: 'admin-config', kind: 'panel', id: 'config' },
  { name: 'dialog-confirm', kind: 'confirm', id: '' },
  { name: 'dialog-form', kind: 'form', id: '' },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote'], userDataDir: '/tmp/style-audit' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1000, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:8080/?v=style-audit', { waitUntil: 'networkidle2', timeout: 60000 });
  const report = {};
  for (const v of VIEWS) {
    await page.evaluate((v) => {
      document.querySelectorAll('.confirm-overlay').forEach(o => o.remove());
      document.querySelectorAll('.app-view').forEach((el) => el.classList.remove('active'));
      document.body.classList.remove('modal-open');
      if (v.kind === 'view') {
        const el = document.getElementById('view-' + v.id);
        if (el) { el.classList.add('active'); if (el.classList.contains('modal-like')) document.body.classList.add('modal-open'); }
      } else if (v.kind === 'panel') {
        document.getElementById('view-admin').classList.add('active');
        try { adminShowPanel(v.id); } catch (e) {}
      } else if (v.kind === 'confirm') {
        showConfirm('¿Seguro que quieres continuar con esta acción?');
      } else if (v.kind === 'form') {
        showFormModal({ title: 'Prueba', icon: 'send', confirmText: 'Enviar', fields: [{ key: 'x', label: 'Campo' }] });
      }
      window.scrollTo(0, 0);
    }, v);
    await new Promise(r => setTimeout(r, 500));
    const bad = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      const BLUE = /(59,\s*130,\s*246|37,\s*99,\s*235|96,\s*165,\s*250|29,\s*78,\s*216)/;
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
      };
      const sig = (el) => {
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
        const anc = el.closest('[id]');
        return (anc && anc !== el ? '#' + anc.id + ' ' : '') + s;
      };
      const blueAllowed = (el) => !!el.closest('.badge-admin');
      document.querySelectorAll('body *').forEach((el) => {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
        if (!isVisible(el)) return;
        const cs = getComputedStyle(el);
        const probe = [cs.backgroundColor, cs.color, cs.borderTopColor, cs.borderBottomColor, cs.backgroundImage, cs.boxShadow].join('|');
        const m = probe.match(BLUE);
        if (m && !blueAllowed(el)) {
          const key = sig(el) + '|azul';
          if (!seen.has(key)) { seen.add(key); out.push({ q: 'azul', el: sig(el) }); }
        }
      });
      // Gramática compartida: controles a 12px, superficies a 16px
      document.querySelectorAll('.btn, .confirm-actions button, .btn-descargar').forEach((el) => {
        if (!isVisible(el)) return;
        if (el.closest('.ledger-tabs,.mobile-bottom-nav,.admin-menu-nav,.template-placeholders')) return;
        const r = getComputedStyle(el).borderTopLeftRadius;
        if (r !== '12px' && r !== '10px') {
          const key = sig(el) + '|radio-control';
          if (!seen.has(key)) { seen.add(key); out.push({ q: 'radio-control', el: sig(el), r }); }
        }
      });
      document.querySelectorAll('.glass-card, .ledger-book, .expenses-book, .cert-oficio').forEach((el) => {
        if (!isVisible(el)) return;
        if (el.closest('.admin-content .section-card .section-card, #admin-section-users, #admin-section-invites')) return;
        const cs = getComputedStyle(el);
        const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
        if (!radii.some((r) => r === '16px' || r === '0px')) {
          const key = sig(el) + '|radio-superficie';
          if (!seen.has(key)) { seen.add(key); out.push({ q: 'radio-superficie', el: sig(el), r: radii.join(' ') }); }
        }
      });
      document.querySelectorAll('h1,h2,h3').forEach((el) => {
        if (!isVisible(el)) return;
        const ff = getComputedStyle(el).fontFamily;
        if (!/fraunces/i.test(ff)) {
          const key = sig(el) + '|sans';
          if (!seen.has(key)) { seen.add(key); out.push({ q: 'titulo-sans', el: sig(el), f: ff.split(',')[0].slice(0, 24) }); }
        }
      });
      return out.slice(0, 40);
    });
    if (bad.length) report[v.name] = bad;
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})();
