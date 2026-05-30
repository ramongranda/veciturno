const dbService = require('../services/db.service');
const cryptoService = require('../services/crypto.service');
const puppeteer = require('puppeteer');
const config = require('../config/env');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');

const passkeyRegisterChallenges = new Map();

function toBase64Url(bufferLike) {
  return Buffer.from(bufferLike).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url');
}

function normalizeSpanishPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.startsWith('34')) digits = digits.slice(2);
  if (digits.length === 0) return '';
  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

function normalizeCredentialID(idValue) {
  if (!idValue) return '';
  if (typeof idValue === 'string') {
    return idValue.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  return toBase64Url(idValue);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPayerKeyFromDescription(description) {
  const raw = String(description || '').trim();
  if (!raw) return '';
  const normalized = normalizeText(raw).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.includes('traspaso interno periodico recibido spo from')) {
    return 'traspaso interno periodico recibido spo from';
  }
  const marker = 'transferencia recibida de ';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) {
    return normalized.slice(idx + marker.length).replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return normalized;
}

function resolveAssignedUnitIdByPayerKey(payerKey, assignments) {
  if (!payerKey || !assignments || typeof assignments !== 'object') return '';
  if (assignments[payerKey]) return assignments[payerKey];
  const entries = Object.entries(assignments);
  for (const [k, v] of entries) {
    if (payerKey.includes(k) || k.includes(payerKey)) return v;
  }
  return '';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEur(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

const neighborController = {
  downloadFinanceCertificate: async (req, res) => {
    let browser;
    try {
      const year = Number(req.query.year || new Date().getFullYear());
      const quarter = String(req.query.quarter || 'all');
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'Año inválido para certificado.' });
      }
      if (!['all', 'Q1', 'Q2', 'Q3', 'Q4'].includes(quarter)) {
        return res.status(400).json({ error: 'Trimestre inválido. Usa all, Q1, Q2, Q3 o Q4.' });
      }

      const user = dbService.getNeighborById(req.user.id);
      if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

      const fromMonth = quarter === 'Q1' ? 1 : quarter === 'Q2' ? 4 : quarter === 'Q3' ? 7 : quarter === 'Q4' ? 10 : 1;
      const toMonth = quarter === 'Q1' ? 3 : quarter === 'Q2' ? 6 : quarter === 'Q3' ? 9 : quarter === 'Q4' ? 12 : 12;

      const contributions = dbService.getFinanceContributions(8000) || [];
      const rows = contributions
        .filter((c) => Number(c.amount || 0) > 0)
        .filter((c) => (c.unitId && c.unitId === user.id) || normalizeText(c.unitName) === normalizeText(user.floor))
        .filter((c) => {
          const month = String(c.month || '');
          if (!/^\d{4}-\d{2}$/.test(month)) return false;
          const y = Number(month.slice(0, 4));
          const m = Number(month.slice(5, 7));
          return y === year && m >= fromMonth && m <= toMonth;
        })
        .sort((a, b) => String(a.month).localeCompare(String(b.month)) || String(a.dateValue || '').localeCompare(String(b.dateValue || '')));

      const total = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
      const quarterLabel = quarter === 'all' ? 'Año completo' : quarter.replace('Q', 'T');
      const now = new Date();
      const emittedAt = now.toLocaleString('es-ES');

      const crypto = require('crypto');
      const csvHash = crypto.createHash('sha256').update(`${user.id}-${year}-${quarter}-${total}-${emittedAt}`).digest('hex').toUpperCase();
      const csvCode = `CSV-${csvHash.slice(0, 4)}-${csvHash.slice(4, 8)}-${csvHash.slice(8, 12)}-${csvHash.slice(12, 16)}`;

      dbService.saveGeneratedCertificate({
        csv: csvCode,
        floorId: user.id,
        floorName: user.floor,
        username: user.username || user.floor,
        year,
        quarter: quarterLabel,
        totalAmount: total,
        emittedAt
      });

      const htmlRows = rows.length
        ? rows.map((r, idx) => `<tr><td>${idx + 1}</td><td>${escapeHtml(r.month)}</td><td>${escapeHtml(r.dateValue || '-')}</td><td>${escapeHtml(r.description || '-')}</td><td style="text-align:right;">${formatEur(r.amount)}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;">Sin aportaciones en el período seleccionado</td></tr>';

      const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#0f172a;padding:28px;font-size:12px}
h1{font-size:20px;margin:0 0 6px 0}h2{font-size:14px;margin:16px 0 8px 0}
.muted{color:#475569}.box{border:1px solid #cbd5e1;border-radius:8px;padding:10px;margin:10px 0}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:11px}
th{background:#f1f5f9;text-align:left}.right{text-align:right}.total{font-size:15px;font-weight:700}
</style></head><body>
<h1>Certificado de Abono de Cuotas</h1>
<div class="muted">${escapeHtml(config.COMMUNITY_NAME)}</div>
<div class="box">
  <div><strong>Propietario/Usuario:</strong> ${escapeHtml(user.username || user.floor)}</div>
  <div><strong>Unidad:</strong> ${escapeHtml(user.floor)}</div>
  <div><strong>Período:</strong> ${year} · ${quarterLabel}</div>
  <div><strong>Fecha de emisión:</strong> ${escapeHtml(emittedAt)}</div>
</div>
<h2>Detalle de aportaciones</h2>
<table>
  <thead><tr><th>#</th><th>Mes</th><th>Fecha</th><th>Concepto</th><th class="right">Importe</th></tr></thead>
  <tbody>${htmlRows}</tbody>
</table>
<div class="box">
  <div class="total">Total abonado en el período: ${formatEur(total)}</div>
</div>
<div class="box" style="margin-top: 24px; font-size: 10px; background: #f8fafc; border-style: dashed; padding: 12px; display: flex; justify-content: space-between; align-items: center; border-color: #0284c7;">
  <div>
    <strong>Código Seguro de Verificación (CSV):</strong> <code style="font-family: monospace; font-size: 11px; color: #0284c7; font-weight: bold;">${csvCode}</code>
    <div class="muted" style="font-size: 9px; margin-top: 2px;">Valide la autenticidad de este documento oficial ingresando este código en la sección pública de VeciTurno.</div>
  </div>
  <div style="font-size: 8px; text-align: right; color: #64748b; font-family: monospace; line-height: 1.2;">
    FIRMADO ELECTRÓNICAMENTE<br>SISTEMA VECITURNO DIGITAL
  </div>
</div>
<div class="muted" style="margin-top: 14px;">Documento informativo generado por VeciTurno en base a movimientos registrados.</div>
</body></html>`;

      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBytes = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' } });
      const pdfBuffer = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);

      const fileName = `certificado-abonos-${year}-${quarter.toLowerCase()}-${(user.username || user.id || 'vecino')}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(pdfBuffer);
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo generar el certificado de abonos.' });
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },
  getFinanceOverview: (req, res) => {
    try {
      const records = (dbService.getFinanceRecords() || []).slice().sort((a, b) => (a.month < b.month ? 1 : -1));
      const contributions = (dbService.getFinanceContributions(2000) || []).slice();
      const settings = dbService.getSettings();
      const neighbors = dbService.getNeighbors();
      const allMovements = dbService.getFinanceMovements(10000);
      const movementAssignments = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
        ? settings.movementNameAssignments
        : {};

      const ownerMap = new Map();
      contributions
        .filter((c) => Number(c.amount) > 0)
        .forEach((c) => {
          const key = c.unitId || c.unitName || 'unassigned';
          if (!ownerMap.has(key)) {
            ownerMap.set(key, {
              unitId: c.unitId || '',
              unitName: c.unitName || 'Sin asignar',
              totalAmount: 0,
              count: 0
            });
          }
          const row = ownerMap.get(key);
          row.totalAmount += Number(c.amount) || 0;
          row.count += 1;
        });

      const ownerTotals = Array.from(ownerMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);
      const monthsCount = records.length;
      const defaultHousing = Number(settings.defaultFeeHousing || 25);
      const defaultCommercial = Number(settings.defaultFeeCommercial || 20);
      const ownerPaymentStatus = neighbors.map((n) => {
        const ownerNameNorm = normalizeText(n.floor);
        const ownerContribRows = contributions
          .filter((c) => {
            if (Number(c.amount) <= 0) return false;
            if (c.unitId && c.unitId === n.id) return true;
            return normalizeText(c.unitName) === ownerNameNorm;
          });
        const paidFromContrib = ownerContribRows.reduce((acc, c) => acc + Number(c.amount || 0), 0);
        const contributionCount = ownerContribRows.length;
        const paidFromMovements = (allMovements || [])
          .filter((m) => Number(m.amount || 0) > 0 && String(m.movementType || '') === 'income_fee')
          .filter((m) => {
            const key = extractPayerKeyFromDescription(m.description || '');
            const assignedUnitId = key ? resolveAssignedUnitIdByPayerKey(key, movementAssignments) : '';
            return assignedUnitId === n.id;
          })
          .reduce((acc, m) => acc + Number(m.amount || 0), 0);
        const paid = Math.max(paidFromContrib, paidFromMovements);
        let monthlyFee = Number(dbService.getMonthlyFeeForNeighbor(n.id) || 0);
        if (monthlyFee <= 0) {
          monthlyFee = n.kind === 'comercial' ? defaultCommercial : defaultHousing;
        }
        const expected = Number((monthlyFee * monthsCount).toFixed(2));
        const debt = Number(Math.max(0, expected - paid).toFixed(2));
        const current = debt <= 0.01;
        return {
          unitId: n.id,
          unitName: n.floor,
          monthlyFee,
          paid: Number(paid.toFixed(2)),
          contributionCount,
          expected,
          debt,
          current
        };
      }).sort((a, b) => Number(b.debt) - Number(a.debt));
      const currentCount = ownerPaymentStatus.filter((o) => o.current).length;
      const pendingCount = ownerPaymentStatus.length - currentCount;
      const totals = records.reduce((acc, r) => {
        acc.income += Number(r.incomeFees || 0);
        acc.expenses += Number(r.expenseInsurance || 0) + Number(r.expenseElectricity || 0);
        return acc;
      }, { income: 0, expenses: 0 });
      const expenseMovements = (allMovements || [])
        .filter((m) => Number(m.amount || 0) < 0)
        .map((m) => ({
          month: m.month,
          dateValue: m.dateValue,
          amount: Math.abs(Number(m.amount || 0)),
          movementType: m.movementType || 'other',
          description: m.description || ''
        }))
        .slice(0, 1000);

      return res.json({
        currentBankBalance: settings.currentBankBalance === null || settings.currentBankBalance === undefined
          ? null
          : Number(settings.currentBankBalance),
        totals: {
          income: Number(totals.income.toFixed(2)),
          expenses: Number(totals.expenses.toFixed(2)),
          balance: Number((totals.income - totals.expenses).toFixed(2))
        },
        monthly: records.map((r) => ({
          month: r.month,
          incomeFees: Number(r.incomeFees || 0),
          expenseInsurance: Number(r.expenseInsurance || 0),
          expenseElectricity: Number(r.expenseElectricity || 0),
          balance: Number((Number(r.incomeFees || 0) - Number(r.expenseInsurance || 0) - Number(r.expenseElectricity || 0)).toFixed(2))
        })),
        ownerTotals,
        paymentCheck: {
          monthsCount,
          currentCount,
          pendingCount,
          totalOwners: ownerPaymentStatus.length,
          owners: ownerPaymentStatus
        },
        expenseMovements
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo cargar el estado financiero.' });
    }
  },
  // Actualizar perfil (teléfono o contraseña)
  updateProfile: async (req, res) => {
    try {
      const { phone, password, passwordConfirm } = req.body;
      const updates = {};

      if (phone !== undefined) {
        const normalizedPhone = normalizeSpanishPhone(phone);
        if (phone && !normalizedPhone) {
          return res.status(400).json({ error: 'Teléfono inválido. Usa un número español (9 dígitos), con o sin +34.' });
        }
        updates.phone = normalizedPhone || '';
      }

      if (password) {
        if (password !== passwordConfirm) {
          return res.status(400).json({ error: 'La nueva contraseña y su confirmación no coinciden.' });
        }
        updates.passwordHash = await cryptoService.hashPassword(password);
      }

      const updatedNeighbor = dbService.updateNeighbor(req.user.id, updates);
      
      res.json({
        message: 'Datos de perfil actualizados correctamente.',
        phone: updatedNeighbor.phone
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar el perfil del vecino.' });
    }
  },

  // Iniciar configuración de 2FA bajo demanda (generar QR)
  setup2FA: async (req, res) => {
    try {
      const neighbor = dbService.getNeighborById(req.user.id);
      
      const { base32, otpauthUrl } = cryptoService.generate2FASecret(neighbor.floor);
      const qrCodeUrl = await cryptoService.generateQRCode(otpauthUrl);

      dbService.updateNeighbor(neighbor.id, {
        twoFactorSecret: base32
      });

      res.json({
        message: 'Secreto generado. Confirma con el código OTP de tu app móvil.',
        qrCodeUrl,
        secret: base32
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al generar secreto 2FA en caliente.' });
    }
  },

  // Confirmar y activar 2FA
  activate2FA: (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ error: 'Por favor, proporciona el código de verificación.' });
      }

      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor.twoFactorSecret) {
        return res.status(400).json({ error: 'Primero debes solicitar el secreto 2FA.' });
      }

      const isVerified = cryptoService.verify2FACode(neighbor.twoFactorSecret, code);
      if (!isVerified) {
        return res.status(400).json({ error: 'Código 2FA incorrecto o expirado.' });
      }

      dbService.updateNeighbor(neighbor.id, {
        twoFactorRegistered: true
      });

      res.json({
        message: 'Doble Factor de Autenticación (2FA) activado con éxito en tu cuenta.'
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al confirmar la activación del 2FA.' });
    }
  },

  // Desactivar 2FA
  deactivate2FA: (req, res) => {
    try {
      dbService.updateNeighbor(req.user.id, {
        twoFactorSecret: null,
        twoFactorRegistered: false
      });

      res.json({
        message: 'Doble Factor de Autenticación (2FA) desactivado de tu cuenta.'
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al desactivar el 2FA.' });
    }
  },

  startPasskeyRegistration: async (req, res) => {
    try {
      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });

      const rpID = req.hostname || 'localhost';
      const options = await generateRegistrationOptions({
        rpName: 'VeciTurno',
        rpID,
        userName: neighbor.username || `vecino-${neighbor.id}`,
        userDisplayName: neighbor.username || neighbor.floor,
        userID: Uint8Array.from(Buffer.from(String(neighbor.id), 'utf8')),
        attestationType: 'none',
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'preferred'
        },
        excludeCredentials: (neighbor.passkeys || []).map((p) => ({
          id: p.credentialID,
          transports: Array.isArray(p.transports) ? p.transports : ['internal']
        }))
      });

      passkeyRegisterChallenges.set(neighbor.id, options.challenge);
      return res.json({ options });
    } catch (err) {
      return res.status(500).json({ error: `No se pudo iniciar el registro de huella/passkey: ${err.message}` });
    }
  },

  finishPasskeyRegistration: async (req, res) => {
    try {
      const { credential } = req.body || {};
      if (!credential) return res.status(400).json({ error: 'Falta la credencial passkey.' });

      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });

      const expectedChallenge = passkeyRegisterChallenges.get(neighbor.id);
      if (!expectedChallenge) return res.status(400).json({ error: 'Challenge no encontrado o expirado.' });

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge,
        expectedOrigin: `${req.protocol}://${req.get('host')}`,
        expectedRPID: req.hostname || 'localhost'
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'No se pudo verificar la passkey.' });
      }

      const info = verification.registrationInfo;
      const credentialID = normalizeCredentialID(info.credential.id);
      const existing = Array.isArray(neighbor.passkeys) ? neighbor.passkeys : [];
      const already = existing.some((p) => p.credentialID === credentialID);
      const nextPasskeys = already ? existing : [
        ...existing,
        {
          credentialID,
          publicKey: toBase64Url(info.credential.publicKey),
          counter: info.credential.counter || 0,
          transports: Array.isArray(credential.response?.transports) ? credential.response.transports : ['internal'],
          createdAt: new Date().toISOString()
        }
      ];

      dbService.updateNeighbor(neighbor.id, { passkeys: nextPasskeys });
      passkeyRegisterChallenges.delete(neighbor.id);
      return res.json({ message: 'Acceso por huella/passkey activado correctamente.' });
    } catch (err) {
      return res.status(500).json({ error: `Error al finalizar el registro de huella/passkey: ${err.message}` });
    }
  },

  listPasskeys: (req, res) => {
    try {
      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });
      const passkeys = (neighbor.passkeys || []).map((p, idx) => ({
        id: p.credentialID,
        label: p.label || `Dispositivo ${idx + 1}`,
        createdAt: p.createdAt || null,
        transports: Array.isArray(p.transports) ? p.transports : []
      }));
      return res.json({ passkeys });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo obtener el listado de huellas/passkeys.' });
    }
  },

  revokePasskey: (req, res) => {
    try {
      const { credentialID } = req.body || {};
      if (!credentialID) return res.status(400).json({ error: 'Debes indicar la credencial a revocar.' });
      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });
      const current = Array.isArray(neighbor.passkeys) ? neighbor.passkeys : [];
      const next = current.filter((p) => p.credentialID !== credentialID);
      if (next.length === current.length) {
        return res.status(404).json({ error: 'No se encontró esa huella/passkey.' });
      }
      dbService.updateNeighbor(neighbor.id, { passkeys: next });
      return res.json({ message: 'Huella/passkey revocada correctamente.', passkeyCount: next.length });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo revocar la huella/passkey.' });
    }
  },

  renamePasskey: (req, res) => {
    try {
      const { credentialID, label } = req.body || {};
      const trimmed = String(label || '').trim();
      if (!credentialID) return res.status(400).json({ error: 'Debes indicar la credencial a renombrar.' });
      if (!trimmed) return res.status(400).json({ error: 'El nombre del dispositivo no puede estar vacío.' });
      if (trimmed.length > 40) return res.status(400).json({ error: 'El nombre no puede superar 40 caracteres.' });

      const neighbor = dbService.getNeighborById(req.user.id);
      if (!neighbor) return res.status(404).json({ error: 'Usuario no encontrado.' });
      const current = Array.isArray(neighbor.passkeys) ? neighbor.passkeys : [];
      let found = false;
      const next = current.map((p) => {
        if (p.credentialID !== credentialID) return p;
        found = true;
        return { ...p, label: trimmed };
      });
      if (!found) return res.status(404).json({ error: 'No se encontró esa huella/passkey.' });

      dbService.updateNeighbor(neighbor.id, { passkeys: next });
      return res.json({ message: 'Dispositivo renombrado correctamente.' });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo renombrar el dispositivo.' });
    }
  }
};

module.exports = neighborController;
