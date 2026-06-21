const { v4: uuidv4 } = require('uuid');
const dbService = require('../services/db.service');
const cryptoService = require('../services/crypto.service');
const config = require('../config/env');
const XLSX = require('xlsx');

function normalizeSpanishPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0034')) digits = digits.slice(4);
  else if (digits.startsWith('34')) digits = digits.slice(2);
  if (digits.length === 0) return '';
  if (!/^\d{9}$/.test(digits)) return null;
  return `+34${digits}`;
}

function getPublicBaseUrl(req) {
  if (config.APP_BASE_URL) return config.APP_BASE_URL;
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = forwardedHost || req.get('host');
  return `${protocol}://${host}`;
}

function buildInviteUrl(req, token) {
  return `${getPublicBaseUrl(req)}/#register?token=${encodeURIComponent(token)}`;
}

function normalizeAnyPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits.length >= 8 ? `+${digits}` : '';
}

function normalizeTextForMatch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseAmountEs(value) {
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  let normalized = raw.replace(/\s/g, '');
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Si la coma va antes del punto: 3,269.72 (US)
    // Si el punto va antes de la coma: 3.269,72 (ES)
    if (comma < dot) {
      normalized = normalized.replace(/,/g, '');
    } else {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    }
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function monthFromDateCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}`;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(value || '').trim();
  if (!s) return '';
  const parts = s.split(/[\/\-]/).map(p => p.trim());
  if (parts.length !== 3) return '';
  let m = Number(parts[0]);
  let d = Number(parts[1]);
  let y = Number(parts[2]);
  if (parts[0].length === 4) {
    y = Number(parts[0]);
    m = Number(parts[1]);
    d = Number(parts[2]);
  }
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return '';
  if (y < 100) y += 2000;
  if (m < 1 || m > 12) return '';
  return `${y}-${String(m).padStart(2, '0')}`;
}

function dateCellToEpoch(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return new Date(parsed.y, parsed.m - 1, parsed.d).getTime();
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  const s = String(value || '').trim();
  if (!s) return NaN;
  const parts = s.split(/[\/\-]/).map(p => p.trim());
  if (parts.length !== 3) return NaN;
  let m = Number(parts[0]);
  let d = Number(parts[1]);
  let y = Number(parts[2]);
  if (parts[0].length === 4) {
    y = Number(parts[0]);
    m = Number(parts[1]);
    d = Number(parts[2]);
  }
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return NaN;
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d).getTime();
}

function extractPayerKeyFromDescription(description) {
  const raw = String(description || '').trim();
  if (!raw) return '';
  const normalized = normalizeTextForMatch(raw);
  // Clave estable para traspasos internos periódicos (ignora numeraciones variables)
  if (normalized.includes('traspaso interno periodico recibido spo from')) {
    return 'TRASPASO INTERNO PERIODICO RECIBIDO SPO FROM';
  }
  const marker = 'transferencia recibida de ';
  const idx = normalized.indexOf(marker);
  if (idx >= 0) {
    return normalized
      .slice(idx + marker.length)
      .replace(/\b\d+\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }
  return normalized
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function resolveAssignedUnitIdByPayerKey(payerKey, assignments) {
  if (!payerKey || !assignments || typeof assignments !== 'object') return '';
  const key = String(payerKey || '').toUpperCase();
  if (assignments[key]) return assignments[key];
  const entries = Object.entries(assignments);
  for (const [k, v] of entries) {
    const left = String(k || '').toUpperCase();
    if (key.includes(left) || left.includes(key)) return v;
  }
  return '';
}

function extractTokensFromUnit(unit, neighbor) {
  const candidates = [
    unit?.name,
    unit?.legalName,
    unit?.floorLabel,
    neighbor?.username,
    neighbor?.floor
  ].filter(Boolean);
  const tokens = new Set();
  candidates.forEach((c) => {
    const normalized = normalizeTextForMatch(c);
    if (!normalized) return;
    const words = normalized.split(' ').filter(w => w.length >= 3);
    words.forEach((w) => tokens.add(w));
    if (words.length >= 2) {
      tokens.add(words.slice(0, 2).join(' '));
      tokens.add(words.slice(-2).join(' '));
    }
  });
  return Array.from(tokens);
}

const adminController = {
  getAdminIdentityConfig: (req, res) => {
    try {
      const settings = dbService.getSettings();
      return res.json({
        adminUsername: settings.adminUsername || '',
        adminOwnerFloorId: settings.adminOwnerFloorId || ''
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo cargar la configuración del administrador.' });
    }
  },
  updateAdminIdentityConfig: (req, res) => {
    try {
      const { adminOwnerFloorId } = req.body || {};
      const neighbors = dbService.getNeighbors();
      if (adminOwnerFloorId && !neighbors.some(n => n.id === adminOwnerFloorId)) {
        return res.status(400).json({ error: 'El piso seleccionado para propietario-admin no existe.' });
      }
      const settings = dbService.updateSettings({
        adminOwnerFloorId: adminOwnerFloorId || ''
      });
      return res.json({
        message: 'Configuración de propietario-admin actualizada.',
        adminUsername: settings.adminUsername || '',
        adminOwnerFloorId: settings.adminOwnerFloorId || ''
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo guardar la configuración del administrador.' });
    }
  },
  importFinanceExcel: (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Debes subir un archivo Excel (.xlsx).' });
      }
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return res.status(400).json({ error: 'El Excel no contiene hojas.' });
      }
      const sheet = workbook.Sheets[firstSheetName];
      const objectRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const matrixRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if ((!Array.isArray(objectRows) || objectRows.length === 0) && (!Array.isArray(matrixRows) || matrixRows.length === 0)) {
        return res.status(400).json({ error: 'El Excel está vacío.' });
      }

      const imported = [];
      const errors = [];
      const hasSimpleHeader = objectRows.some((r) => Object.prototype.hasOwnProperty.call(r, 'month') || Object.prototype.hasOwnProperty.call(r, 'mes'));

      if (hasSimpleHeader) {
        objectRows.forEach((row, idx) => {
          const line = idx + 2;
          const month = String(row.month || row.mes || '').trim();
          if (!/^\d{4}-\d{2}$/.test(month)) {
            errors.push(`Fila ${line}: campo month/mes inválido (usa YYYY-MM).`);
            return;
          }

          const incomeFees = Number(row.incomeFees ?? row.ingresosCuotas ?? row.ingresos ?? 0);
          const expenseElectricity = Number(row.expenseElectricity ?? row.gastoLuz ?? row.luz ?? 0);
          const expenseInsurance = Number(row.expenseInsurance ?? row.gastoSeguro ?? row.seguro ?? 0);
          const notes = String(row.notes ?? row.notas ?? '').trim();

          if (![incomeFees, expenseElectricity, expenseInsurance].every((n) => Number.isFinite(n) && n >= 0)) {
            errors.push(`Fila ${line}: importes inválidos (deben ser numéricos >= 0).`);
            return;
          }

          const record = dbService.upsertFinanceRecord({
            month,
            incomeFees,
            expenseInsurance,
            expenseElectricity,
            notes,
            uploadedBy: req.user?.username || 'admin'
          });
          imported.push(record.month);
        });
      } else {
        const headerIdx = matrixRows.findIndex((r) => normalizeTextForMatch(r?.[0]) === 'f valor' && normalizeTextForMatch(r?.[5]).includes('importe'));
        if (headerIdx < 0) {
          return res.status(400).json({ error: 'Formato no reconocido. Usa plantilla simple o extracto bancario con cabecera "F. VALOR".' });
        }

        const settings = dbService.getSettings();
        const existingAssignments = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
          ? settings.movementNameAssignments
          : {};
        const learnedAssignments = { ...existingAssignments };
        let learnedCount = 0;
        let latestBalance = null;
        let latestBalanceDate = Number.NEGATIVE_INFINITY;
        let latestBalanceRowOrder = Number.POSITIVE_INFINITY;
        const neighbors = dbService.getNeighbors();
        const structure = dbService.getCommunityStructure();
        const byIdUnit = new Map((structure || []).map((u) => [u.id, u]));
        const matchers = neighbors.map((n) => {
          const unit = byIdUnit.get(n.id) || {};
          return {
            id: n.id,
            floor: n.floor,
            tokens: extractTokensFromUnit(unit, n)
          };
        });
        const matchedPayments = [];
        const unmatchedPayments = [];
        let insertedMovements = 0;

        for (let i = headerIdx + 1; i < matrixRows.length; i += 1) {
          const row = matrixRows[i] || [];
          const month = monthFromDateCell(row[0]);
          if (!month) continue;
          const category = String(row[1] || '').trim();
          const subcategory = String(row[2] || '').trim();
          const description = String(row[3] || '').trim();
          const amount = parseAmountEs(row[5]);
          const rowBalance = parseAmountEs(row[6]);
          const rowEpoch = dateCellToEpoch(row[0]);
          if (Number.isFinite(rowBalance) && rowBalance !== 0) {
            if (Number.isFinite(rowEpoch)) {
              if (rowEpoch > latestBalanceDate || (rowEpoch === latestBalanceDate && i < latestBalanceRowOrder)) {
                latestBalance = rowBalance;
                latestBalanceDate = rowEpoch;
                latestBalanceRowOrder = i;
              }
            } else if (latestBalance === null) {
              // Fallback: si no se puede parsear fecha, usamos la primera fila de movimientos del extracto.
              latestBalance = rowBalance;
              latestBalanceRowOrder = i;
            }
          }
          if (!Number.isFinite(amount) || amount === 0) continue;

          const haystack = normalizeTextForMatch(`${category} ${subcategory} ${description}`);

          if (amount > 0) {
            const isFeeIncome =
              haystack.includes('transferencia recibida') ||
              haystack.includes('ingresos') ||
              haystack.includes('traspaso interno') ||
              haystack.includes('movimientos excluidos');
            if (isFeeIncome) {
              const up = dbService.upsertFinanceMovement({
                month,
                dateValue: String(row[0] || ''),
                amount,
                description,
                movementType: 'income_fee',
                source: 'bank_import'
              });
              if (up.inserted) insertedMovements += 1;
              const payerKey = extractPayerKeyFromDescription(description);
              const assignedUnitId = payerKey ? resolveAssignedUnitIdByPayerKey(payerKey, learnedAssignments) : '';
              const assignedUnit = assignedUnitId ? neighbors.find((n) => n.id === assignedUnitId) : null;

              let best = null;
              if (!assignedUnit) {
                for (const candidate of matchers) {
                  if (!candidate.tokens.length) continue;
                  const score = candidate.tokens.reduce((acc, t) => acc + (haystack.includes(t) ? 1 : 0), 0);
                  if (score > 0 && (!best || score > best.score)) best = { ...candidate, score };
                }
              }

              if (assignedUnit || best) {
                const unitId = assignedUnit ? assignedUnit.id : best.id;
                const unitFloor = assignedUnit ? assignedUnit.floor : best.floor;
                matchedPayments.push({
                  month,
                  dateValue: String(row[0] || ''),
                  unitId,
                  unit: unitFloor,
                  amount,
                  description
                });
                dbService.upsertFinanceContribution({
                  month,
                  dateValue: String(row[0] || ''),
                  amount,
                  description,
                  unitId,
                  unitName: unitFloor,
                  matched: true,
                  source: 'bank_import'
                });
                if (payerKey && !assignedUnit && !existingAssignments[payerKey]) {
                  learnedAssignments[payerKey] = unitId;
                  learnedCount += 1;
                }
              } else {
                unmatchedPayments.push({ month, dateValue: String(row[0] || ''), amount, description });
                dbService.upsertFinanceContribution({
                  month,
                  dateValue: String(row[0] || ''),
                  amount,
                  description,
                  unitId: '',
                  unitName: '',
                  matched: false,
                  source: 'bank_import'
                });
              }
            }
            continue;
          }

          const absAmount = Math.abs(amount);
          if (haystack.includes('seguro')) {
            const up = dbService.upsertFinanceMovement({
              month,
              dateValue: String(row[0] || ''),
              amount: -absAmount,
              description,
              movementType: 'expense_insurance',
              source: 'bank_import'
            });
            if (up.inserted) insertedMovements += 1;
          } else if (haystack.includes('luz') || haystack.includes('gas') || haystack.includes('regsiti') || haystack.includes('electric')) {
            const up = dbService.upsertFinanceMovement({
              month,
              dateValue: String(row[0] || ''),
              amount: -absAmount,
              description,
              movementType: 'expense_electricity',
              source: 'bank_import'
            });
            if (up.inserted) insertedMovements += 1;
          } else {
            const up = dbService.upsertFinanceMovement({
              month,
              dateValue: String(row[0] || ''),
              amount: -absAmount,
              description,
              movementType: 'other',
              source: 'bank_import'
            });
            if (up.inserted) insertedMovements += 1;
          }
        }
        const rebuilt = dbService.rebuildFinanceRecordsFromMovements({ uploadedBy: req.user?.username || 'admin' });
        rebuilt.forEach((r) => imported.push(r.month));

        if (learnedCount > 0) {
          dbService.updateSettings({ movementNameAssignments: learnedAssignments });
        }

        let effectiveBankBalance = null;
        if (latestBalance !== null) {
          const prevSettings = dbService.getSettings();
          const prevBalanceDate = Number(prevSettings.currentBankBalanceDate || 0);
          const canUpdateByDate = Number.isFinite(latestBalanceDate) && latestBalanceDate > Number.NEGATIVE_INFINITY;
          const shouldUpdate =
            !Number.isFinite(prevBalanceDate) ||
            prevBalanceDate <= 0 ||
            !canUpdateByDate ||
            latestBalanceDate >= prevBalanceDate;

          if (shouldUpdate) {
            const updated = dbService.updateSettings({
              currentBankBalance: Number(latestBalance.toFixed(2)),
              currentBankBalanceDate: canUpdateByDate ? latestBalanceDate : prevBalanceDate || Date.now()
            });
            effectiveBankBalance = Number(updated.currentBankBalance);
          } else {
            effectiveBankBalance = Number(prevSettings.currentBankBalance);
          }
        }

        if (imported.length > 0) {
          return res.json({
            message: `Importación bancaria completada. Meses importados/actualizados: ${imported.join(', ')}`,
            importedCount: imported.length,
            insertedMovements,
            learnedAssignments: learnedCount,
            currentBankBalance: effectiveBankBalance,
            matches: {
              identified: matchedPayments.length,
              unidentified: unmatchedPayments.length,
              identifiedPayments: matchedPayments.slice(0, 50),
              unidentifiedPayments: unmatchedPayments.slice(0, 50)
            },
            errors
          });
        }
      }

      if (imported.length === 0) {
        const firstError = errors[0] ? ` ${errors[0]}` : '';
        return res.status(400).json({ error: `No se importó ninguna fila válida.${firstError}` });
      }

      return res.json({
        message: `Importación completada. Meses importados/actualizados: ${imported.join(', ')}`,
        importedCount: imported.length,
        errors
      });
    } catch (err) {
      return res.status(500).json({ error: 'Error al procesar el Excel de finanzas.' });
    }
  },
  getFinanceRecords: (req, res) => {
    try {
      const records = dbService.getFinanceRecords();
      const settings = dbService.getSettings();
      return res.json({
        records,
        currentBankBalance: settings.currentBankBalance === null || settings.currentBankBalance === undefined
          ? null
          : Number(settings.currentBankBalance)
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron cargar los registros de finanzas.' });
    }
  },
  getFinanceContributions: (req, res) => {
    try {
      const limit = Number(req.query.limit || 500);
      const rows = dbService.getFinanceContributions(Number.isFinite(limit) ? limit : 500);
      return res.json({ contributions: rows });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron cargar las aportaciones individuales.' });
    }
  },
  resetFinanceData: (req, res) => {
    try {
      const { clearAssignments } = req.body || {};
      const keepAssignments = !clearAssignments;
      const result = dbService.resetFinanceData({ keepAssignments });
      return res.json({
        message: keepAssignments
          ? 'Finanzas reiniciadas. Se conservaron las asignaciones de remitentes.'
          : 'Finanzas y asignaciones reiniciadas por completo.',
        ...result
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo reiniciar la información financiera.' });
    }
  },
  getFeeConfig: (req, res) => {
    try {
      const settings = dbService.getSettings();
      const neighbors = dbService.getNeighbors().map((n) => ({
        id: n.id,
        floor: n.floor,
        kind: n.kind || 'vivienda',
        monthlyFeeOverride: Number.isFinite(Number(n.monthlyFeeOverride)) ? Number(n.monthlyFeeOverride) : null,
        effectiveMonthlyFee: dbService.getMonthlyFeeForNeighbor(n.id)
      }));
      return res.json({
        defaultFeeHousing: Number(settings.defaultFeeHousing || 25),
        defaultFeeCommercial: Number(settings.defaultFeeCommercial || 20),
        units: neighbors
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo obtener la configuración de cuotas.' });
    }
  },
  updateFeeConfig: (req, res) => {
    try {
      const { defaultFeeHousing, defaultFeeCommercial } = req.body || {};
      if (!Number.isFinite(Number(defaultFeeHousing)) || Number(defaultFeeHousing) < 0) {
        return res.status(400).json({ error: 'La cuota base de viviendas no es válida.' });
      }
      if (!Number.isFinite(Number(defaultFeeCommercial)) || Number(defaultFeeCommercial) < 0) {
        return res.status(400).json({ error: 'La cuota base de locales no es válida.' });
      }
      const settings = dbService.updateSettings({
        defaultFeeHousing: Number(defaultFeeHousing),
        defaultFeeCommercial: Number(defaultFeeCommercial)
      });
      return res.json({
        message: 'Cuotas base actualizadas correctamente.',
        defaultFeeHousing: Number(settings.defaultFeeHousing || 25),
        defaultFeeCommercial: Number(settings.defaultFeeCommercial || 20)
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo actualizar la configuración de cuotas.' });
    }
  },
  updateUnitFeeOverride: (req, res) => {
    try {
      const { unitId, monthlyFeeOverride } = req.body || {};
      if (!unitId) return res.status(400).json({ error: 'Debes indicar la unidad.' });
      if (monthlyFeeOverride !== null && monthlyFeeOverride !== '' && (!Number.isFinite(Number(monthlyFeeOverride)) || Number(monthlyFeeOverride) < 0)) {
        return res.status(400).json({ error: 'El override de cuota no es válido.' });
      }
      const normalized = monthlyFeeOverride === null || monthlyFeeOverride === '' ? null : Number(monthlyFeeOverride);
      const updated = dbService.setNeighborMonthlyFeeOverride(unitId, normalized);
      if (!updated) return res.status(404).json({ error: 'Unidad no encontrada.' });
      return res.json({
        message: 'Override de cuota actualizado.',
        unitId,
        monthlyFeeOverride: updated.monthlyFeeOverride,
        effectiveMonthlyFee: dbService.getMonthlyFeeForNeighbor(unitId)
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo actualizar la cuota de la unidad.' });
    }
  },
  getMovementAssignments: (req, res) => {
    try {
      const settings = dbService.getSettings();
      const assignments = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
        ? settings.movementNameAssignments
        : {};
      const neighbors = dbService.getNeighbors();
      const items = Object.entries(assignments).map(([payerKey, unitId]) => {
        const neighbor = neighbors.find((n) => n.id === unitId);
        return {
          payerKey,
          unitId,
          unitName: neighbor ? neighbor.floor : '(unidad eliminada)'
        };
      });
      return res.json({ assignments: items });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron cargar las asignaciones de movimientos.' });
    }
  },
  upsertMovementAssignment: (req, res) => {
    try {
      const { payerKey, unitId } = req.body || {};
      const key = extractPayerKeyFromDescription(payerKey || '').toUpperCase();
      if (!key) return res.status(400).json({ error: 'Debes indicar un nombre de movimiento/remitente.' });
      const neighbor = dbService.getNeighborById(unitId);
      if (!neighbor) return res.status(400).json({ error: 'Unidad no válida para asignación.' });
      const settings = dbService.getSettings();
      const current = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
        ? settings.movementNameAssignments
        : {};
      current[key] = unitId;
      dbService.updateSettings({ movementNameAssignments: current });
      const relinked = dbService.relinkFinanceContributionsByPayerKey({
        payerKey: key,
        unitId: neighbor.id,
        unitName: neighbor.floor
      });
      return res.json({
        message: 'Asignación guardada correctamente.',
        relinked
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo guardar la asignación.' });
    }
  },
  deleteMovementAssignment: (req, res) => {
    try {
      const key = extractPayerKeyFromDescription(req.params.payerKey || '').toUpperCase();
      if (!key) return res.status(400).json({ error: 'Clave de remitente inválida.' });
      const settings = dbService.getSettings();
      const current = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
        ? settings.movementNameAssignments
        : {};
      delete current[key];
      dbService.updateSettings({ movementNameAssignments: current });
      return res.json({ message: 'Asignación eliminada correctamente.' });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo eliminar la asignación.' });
    }
  },
  renameMovementAssignment: (req, res) => {
    try {
      const { oldPayerKey, newPayerKey } = req.body || {};
      const oldKey = extractPayerKeyFromDescription(oldPayerKey || '').toUpperCase();
      const newKey = extractPayerKeyFromDescription(newPayerKey || '').toUpperCase();
      if (!oldKey || !newKey) return res.status(400).json({ error: 'Claves de asignación inválidas.' });
      const settings = dbService.getSettings();
      const current = (settings && settings.movementNameAssignments && typeof settings.movementNameAssignments === 'object')
        ? settings.movementNameAssignments
        : {};
      if (!current[oldKey]) return res.status(404).json({ error: 'No existe la asignación original.' });
      const unitId = current[oldKey];
      delete current[oldKey];
      current[newKey] = unitId;
      dbService.updateSettings({ movementNameAssignments: current });
      const neighbor = dbService.getNeighborById(unitId);
      const relinked = dbService.relinkFinanceContributionsByPayerKey({
        payerKey: newKey,
        unitId,
        unitName: neighbor ? neighbor.floor : ''
      });
      return res.json({ message: 'Nombre de asignación actualizado.', relinked });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo renombrar la asignación.' });
    }
  },
  getNotificationLogs: (req, res) => {
    try {
      const limit = Number(req.query.limit || 200);
      const logs = dbService.getNotificationLogs(Number.isFinite(limit) ? limit : 200);
      res.json({ logs });
    } catch (err) {
      res.status(500).json({ error: 'No se pudo obtener el historial de notificaciones.' });
    }
  },
  getIncidents: (req, res) => {
    try {
      const limit = Number(req.query.limit || 100);
      return res.json({ incidents: dbService.getIncidents(limit) });
    } catch (_) {
      return res.status(500).json({ error: 'No se pudo cargar incidencias.' });
    }
  },

  // ---- Tablón de anuncios ----
  createAnnouncement: (req, res) => {
    try {
      const { title, body, pinned } = req.body || {};
      if (!String(title || '').trim() && !String(body || '').trim()) {
        return res.status(400).json({ error: 'El anuncio necesita un título o un texto.' });
      }
      const createdBy = (req.user && (req.user.username || req.user.floor)) || 'Administración';
      const announcement = dbService.addAnnouncement({ title, body, pinned, createdBy });
      return res.status(201).json({ announcement });
    } catch (_) {
      return res.status(500).json({ error: 'No se pudo publicar el anuncio.' });
    }
  },
  deleteAnnouncement: (req, res) => {
    try {
      const ok = dbService.deleteAnnouncement(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Anuncio no encontrado.' });
      return res.json({ success: true });
    } catch (_) {
      return res.status(500).json({ error: 'No se pudo eliminar el anuncio.' });
    }
  },

  getWhatsAppGroups: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      const groups = await whatsappService.listGroups();
      return res.json({ groups });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron obtener los grupos de WhatsApp.' });
    }
  },

  getWhatsAppConfig: (req, res) => {
    try {
      const settings = dbService.getSettings();
      return res.json({
        whatsappGroupId: settings.whatsappGroupId || '',
        ownersGroupId: settings.ownersGroupId || '',
        debtorsGroupId: settings.debtorsGroupId || '',
        remindersEnabled: settings.remindersEnabled !== false,
        reminderOffsetsDays: Array.isArray(settings.reminderOffsetsDays) ? settings.reminderOffsetsDays : [3, 1, 0]
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo leer la configuración de WhatsApp.' });
    }
  },

  setWhatsAppGroupConfig: (req, res) => {
    try {
      const { whatsappGroupId, ownersGroupId, debtorsGroupId, remindersEnabled, reminderOffsetsDays } = req.body;
      if (whatsappGroupId && !String(whatsappGroupId).endsWith('@g.us')) {
        return res.status(400).json({ error: 'El grupo seleccionado no es válido.' });
      }
      const payload = {
        whatsappGroupId: whatsappGroupId || ''
      };
      if (typeof ownersGroupId === 'string') payload.ownersGroupId = ownersGroupId;
      if (typeof debtorsGroupId === 'string') payload.debtorsGroupId = debtorsGroupId;
      if (typeof remindersEnabled === 'boolean') payload.remindersEnabled = remindersEnabled;
      if (Array.isArray(reminderOffsetsDays)) {
        payload.reminderOffsetsDays = reminderOffsetsDays.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 15);
      }
      const settings = dbService.updateSettings(payload);
      return res.json({
        message: 'Grupo de notificaciones guardado correctamente.',
        settings
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo guardar la configuración del grupo.' });
    }
  },

  getCommunityStructure: (req, res) => {
    try {
      res.json({
        structure: dbService.getCommunityStructure(),
        neighbors: dbService.getNeighbors().map(n => ({
          id: n.id,
          floor: n.floor,
          portal: n.portal,
          floorNumber: n.floorNumber,
          door: n.door,
          isAdmin: n.isAdmin
        }))
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener la estructura de la comunidad.' });
    }
  },

  updateCommunityStructure: (req, res) => {
    try {
      const { units, adminUnitId } = req.body;

      if (!Array.isArray(units) || units.length === 0) {
        return res.status(400).json({ error: 'Debes enviar una lista de viviendas para la estructura.' });
      }

      const updated = dbService.updateCommunityStructure({ units, adminUnitId });
      res.json({
        message: 'Estructura de comunidad actualizada correctamente.',
        ...updated
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'No se pudo actualizar la estructura de comunidad.' });
    }
  },

  // Registrar un vecino directamente por el administrador (opción sin link)
  createNeighbor: async (req, res) => {
    try {
      const { floorId, username, password, passwordConfirm, phone } = req.body;

      if (!floorId || !username || !password) {
        return res.status(400).json({ error: 'Faltan campos obligatorios (número de piso, usuario, contraseña).' });
      }
      
      if (password !== passwordConfirm) {
        return res.status(400).json({ error: 'La contraseña inicial y su confirmación no coinciden.' });
      }

      const neighbor = dbService.getNeighborById(floorId);
      if (!neighbor) {
        return res.status(404).json({ error: 'El número de piso especificado no existe.' });
      }

      const existingNeighbor = dbService.getNeighborByUsername(username);
      if (existingNeighbor && existingNeighbor.id !== floorId) {
        return res.status(400).json({ error: 'Este nombre de usuario ya está registrado por otro vecino.' });
      }

      const passHash = await cryptoService.hashPassword(password);
      
      const normalizedPhone = normalizeSpanishPhone(phone);
      if (phone && !normalizedPhone) {
        return res.status(400).json({ error: 'Teléfono inválido. Usa un número español (9 dígitos), con o sin +34.' });
      }

      dbService.updateNeighbor(floorId, {
        username,
        passwordHash: passHash,
        phone: normalizedPhone || "",
        twoFactorSecret: null,
        twoFactorRegistered: false
      });

      res.json({
        message: `Vecino de la ${neighbor.floor} registrado correctamente con usuario @${username}.`
      });
    } catch (err) {
      res.status(500).json({ error: 'Error interno en la creación directa del vecino.' });
    }
  },

  // Generar un link de invitación y enviarlo por WhatsApp opcionalmente
  generateInvite: async (req, res) => {
    try {
      const { floorId, phone, sendWhatsApp } = req.body;

      if (!floorId) {
        return res.status(400).json({ error: 'Debes especificar el número de piso.' });
      }

      const neighbor = dbService.getNeighborById(floorId);
      if (!neighbor) {
        return res.status(404).json({ error: 'El número de piso especificado no existe.' });
      }
      if (neighbor.registered) {
        return res.status(409).json({
          error: 'Esta vivienda ya tiene una cuenta registrada. Para generar una invitación nueva, primero da de baja/restablece esa cuenta desde Usuarios y Seguridad.'
        });
      }

      let targetPhone = neighbor.phone;

      // Actualizar el teléfono del vecino si se proporciona en la petición
      if (phone !== undefined) {
        const normalized = normalizeSpanishPhone(phone);
        if (phone && !normalized) {
          return res.status(400).json({ error: 'Teléfono inválido. Usa un número español (9 dígitos), con o sin +34.' });
        }
        dbService.updateNeighbor(floorId, { phone: normalized || '' });
        targetPhone = normalized || '';
      }

      const token = uuidv4();
      const inviteUrl = buildInviteUrl(req, token);
      let whatsappSent = false;
      let whatsappError = '';

      if (sendWhatsApp) {
        if (!targetPhone) {
          return res.status(400).json({ error: 'No se puede enviar por WhatsApp porque la vivienda no tiene teléfono registrado.' });
        }

        const whatsappService = require('../services/whatsapp.service');
        const status = whatsappService.getStatus();

        const msg = whatsappService.resolveTemplate('invite_neighbor', {
          enlace: inviteUrl
        });

        if (status.status !== 'connected') {
          whatsappError = 'La pasarela de WhatsApp no está vinculada. Generado enlace sin enviar WhatsApp.';
        } else {
          const ok = await whatsappService.sendMessage(targetPhone, msg);
          if (ok) {
            whatsappSent = true;
            dbService.addNotificationLog({
              notificationType: 'registration_invite',
              mode: 'manual',
              channel: 'individual',
              target: targetPhone,
              status: 'sent',
              error: '',
              message: msg
            });
          } else {
            whatsappError = whatsappService.getStatus().lastError || 'Error al enviar por WhatsApp.';
            dbService.addNotificationLog({
              notificationType: 'registration_invite',
              mode: 'manual',
              channel: 'individual',
              target: targetPhone,
              status: 'failed',
              error: whatsappError,
              message: msg
            });
          }
        }
      }

      dbService.createInviteToken(floorId, token);

      res.json({
        message: whatsappSent
          ? `Invitación enviada por WhatsApp a la ${neighbor.floor}.`
          : `Enlace de registro generado para la ${neighbor.floor}.${whatsappError ? ` Nota: ${whatsappError}` : ''}`,
        inviteUrl,
        token,
        floor: neighbor.floor,
        whatsappSent,
        whatsappError
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al generar enlace de invitación.' });
    }
  },

  // Dar de baja / reinicializar un vecino (borrar credenciales)
  resetNeighbor: (req, res) => {
    try {
      const { id } = req.params;
      const neighbor = dbService.getNeighborById(id);
      if (!neighbor) {
        return res.status(404).json({ error: 'El vecino especificado no existe.' });
      }

      const oldUsername = neighbor.username;

      dbService.updateNeighbor(id, {
        username: null,
        passwordHash: null,
        twoFactorSecret: null,
        twoFactorRegistered: false,
        passkeys: []
      });

      // Si el vecino borrado era el administrador activo del sistema, lo limpiamos de settings
      const settings = dbService.getSettings();
      if (settings.adminUsername && oldUsername && settings.adminUsername.toLowerCase() === oldUsername.toLowerCase()) {
        dbService.updateSettings({ adminUsername: '' });
      }

      res.json({
        message: `Vecino de la ${neighbor.floor} dado de baja / reinicializado correctamente.`,
        neighbor: dbService.getNeighborById(id)
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al dar de baja / reinicializar al vecino.' });
    }
  },

  // Activar/desactivar exención de limpieza de una vivienda
  toggleExemptNeighbor: (req, res) => {
    try {
      const { id } = req.params;
      const neighbor = dbService.getNeighborById(id);
      if (!neighbor) {
        return res.status(404).json({ error: 'El vecino especificado no existe.' });
      }

      const nextExempt = !neighbor.exemptFromCleaning;
      dbService.updateNeighbor(id, { exemptFromCleaning: nextExempt });

      res.json({
        message: nextExempt
          ? `La ${neighbor.floor} ha sido eximida del turno de limpieza.`
          : `La ${neighbor.floor} ha sido incluida en el turno de limpieza.`,
        neighbor: dbService.getNeighborById(id)
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al cambiar estado de exención del vecino.' });
    }
  },

  // Activar/desactivar el acceso de un vecino
  toggleNeighborActive: (req, res) => {
    try {
      const { id } = req.params;
      const neighbor = dbService.getNeighborById(id);
      if (!neighbor) {
        return res.status(404).json({ error: 'El vecino especificado no existe.' });
      }

      if (!neighbor.username) {
        return res.status(400).json({ error: 'No se puede desactivar un vecino que no se ha registrado.' });
      }

      const nextDeactivated = !neighbor.deactivated;
      dbService.updateNeighbor(id, { deactivated: nextDeactivated });

      res.json({
        message: nextDeactivated
          ? `La cuenta de la ${neighbor.floor} ha sido desactivada temporalmente.`
          : `La cuenta de la ${neighbor.floor} ha sido activada correctamente.`,
        neighbor: dbService.getNeighborById(id)
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al cambiar estado de activación del vecino.' });
    }
  },

  // Modificar detalles del vecino/vivienda (nombre, teléfono, tipo, cuota especial)
  updateNeighborDetails: (req, res) => {
    try {
      const { id } = req.params;
      const { name, phone, kind, monthlyFeeOverride } = req.body;

      const neighbor = dbService.getNeighborById(id);
      if (!neighbor) {
        return res.status(404).json({ error: 'El vecino especificado no existe.' });
      }

      const updates = {};

      if (phone !== undefined) {
        const normalized = normalizeSpanishPhone(phone);
        if (phone && !normalized) {
          return res.status(400).json({ error: 'Teléfono inválido. Usa un número español (9 dígitos), con o sin +34.' });
        }
        updates.phone = normalized || '';
      }

      if (name !== undefined) {
        updates.name = String(name || '').trim();
      }

      if (kind !== undefined) {
        if (kind !== 'vivienda' && kind !== 'comercial') {
          return res.status(400).json({ error: 'El tipo de unidad debe ser "vivienda" o "comercial".' });
        }
        updates.kind = kind;
      }

      if (monthlyFeeOverride !== undefined) {
        const val = monthlyFeeOverride === null || monthlyFeeOverride === '' ? null : Number(monthlyFeeOverride);
        if (val !== null && (!Number.isFinite(val) || val < 0)) {
          return res.status(400).json({ error: 'La cuota especial debe ser un número positivo.' });
        }
        updates.monthlyFeeOverride = val;
      }

      const updated = dbService.updateNeighbor(id, updates);

      res.json({
        message: `Detalles de la ${updated.floor} actualizados correctamente.`,
        neighbor: updated
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar los detalles del vecino.' });
    }
  },

  // Cambiar manualmente el turno activo de limpieza
  setActiveTurnFloor: (req, res) => {
    try {
      const { floorId } = req.body;
      if (!floorId) {
        return res.status(400).json({ error: 'Debes especificar la vivienda para el turno activo.' });
      }

      const neighbor = dbService.getNeighborById(floorId);
      if (!neighbor) {
        return res.status(404).json({ error: 'La vivienda especificada no existe.' });
      }

      if (neighbor.exemptFromCleaning) {
        return res.status(400).json({ error: 'No se puede asignar el turno a una vivienda exenta de limpieza.' });
      }

      const state = dbService.setCurrentTurnFloorId(floorId);
      
      res.json({
        message: `Turno de limpieza activo asignado manualmente a la ${neighbor.floor}.`,
        state
      });
    } catch (err) {
      res.status(500).json({ error: 'Error al asignar el turno de limpieza.' });
    }
  },

  // Cambiar manualmente el mes activo de la limpieza
  setActiveTurnMonth: (req, res) => {
    try {
      const { month } = req.body; // expected format 'YYYY-MM'
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'Debes especificar un mes válido en formato YYYY-MM.' });
      }

      const data = dbService.readDB();
      if (data.state) {
        data.state.currentMonth = `${month}-01`;
        dbService.writeDB(data);
        
        return res.json({
          message: `Mes de limpieza activo cambiado manualmente a ${month}.`,
          state: data.state
        });
      }
      return res.status(500).json({ error: 'No se pudo actualizar el mes activo.' });
    } catch (err) {
      return res.status(500).json({ error: 'Error al cambiar el mes de limpieza.' });
    }
  },

  // Obtener lista de invitaciones
  getInvites: (req, res) => {
    try {
      const invites = dbService.getInviteTokens().map(t => {
        const neighbor = dbService.getNeighborById(t.floorId);
        const floor = neighbor ? neighbor.floor : `Unidad eliminada (${t.floorId})`;
        return {
          token: t.token,
          floor,
          floorId: t.floorId,
          unitExists: !!neighbor,
          registered: !!(neighbor && neighbor.registered),
          used: t.used,
          createdAt: t.createdAt,
          inviteUrl: buildInviteUrl(req, t.token)
        };
      });
      
      res.json({ invites });
    } catch (err) {
      res.status(500).json({ error: 'Error al listar las invitaciones de la comunidad.' });
    }
  },

  // Enviar una notificación de prueba de WhatsApp
  sendTestWhatsApp: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      const status = whatsappService.getStatus();
      
      if (status.status !== 'connected') {
        return res.status(400).json({ error: 'La pasarela propia de WhatsApp no está vinculada. Por favor, escanea el código QR primero.' });
      }

      const message = `🔔 *VeciTurno (Notificación de Prueba)*:\n\n¡Enhorabuena! Tu pasarela de WhatsApp propia en VeciTurno se ha configurado y vinculado correctamente.\n\nEnviado a las: ${new Date().toLocaleTimeString('es-ES')}`;
      
      const dbService = require('../services/db.service');
      
      // Buscar teléfono del administrador logueado o usar el configurado en .env
      const adminNeighbor = dbService.getNeighborById(req.user.id);
      const linkedPhone = normalizeAnyPhone(status.phoneConnected);
      const profilePhone = normalizeSpanishPhone(adminNeighbor ? adminNeighbor.phone : '');

      // Prioridad: teléfono vinculado en WhatsApp Web -> perfil admin
      const targetPhone = linkedPhone || profilePhone;
      
      if (!targetPhone) {
        return res.status(400).json({ error: 'No hay teléfono destino válido. Vincula WhatsApp Web o configura tu teléfono en Perfil.' });
      }

      const success = await whatsappService.sendMessage(targetPhone, message);
      
      if (success) {
        dbService.addNotificationLog({
          notificationType: 'manual_test',
          mode: 'manual',
          channel: 'individual',
          target: targetPhone,
          status: 'sent',
          error: '',
          message
        });
        return res.json({ message: `Notificación de prueba enviada con éxito a ${targetPhone}. Por favor, comprueba tu WhatsApp.` });
      } else {
        const waStatus = whatsappService.getStatus();
        dbService.addNotificationLog({
          notificationType: 'manual_test',
          mode: 'manual',
          channel: 'individual',
          target: targetPhone,
          status: 'failed',
          error: waStatus.lastError || 'causa no disponible',
          message
        });
        return res.status(500).json({ error: `Error al enviar WhatsApp de prueba: ${waStatus.lastError || 'causa no disponible'}` });
      }
    } catch (err) {
      res.status(500).json({ error: 'Error interno al enviar el WhatsApp de prueba.' });
    }
  },

  forceTurnStartNotification: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      const status = whatsappService.getStatus();
      if (status.status !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp no está vinculado. Conéctalo primero.' });
      }

      const state = dbService.getState();
      const neighbors = dbService.getNeighbors();
      const settings = dbService.getSettings();
      const currentNeighbor = neighbors.find(n => n.id === state.currentTurnFloorId);
      if (!currentNeighbor) {
        return res.status(400).json({ error: 'No se pudo identificar el piso actual en turno.' });
      }

      const monthDate = new Date(state.currentMonth);
      const monthOptions = { month: 'long', year: 'numeric' };
      let formattedMonth = monthDate.toLocaleDateString('es-ES', monthOptions);
      formattedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

      const message = whatsappService.resolveTemplate('turn_start_general', {
        mes: formattedMonth,
        vecino: currentNeighbor.floor
      });
      const individualMessage = whatsappService.resolveTemplate('turn_start_individual', {
        mes: formattedMonth,
        vecino: currentNeighbor.floor
      });

      const result = await whatsappService.sendTurnStartNotifications({
        nextFloorName: currentNeighbor.floor,
        formattedMonth,
        message,
        individualMessage,
        groupId: settings.whatsappGroupId || '',
        individualPhone: currentNeighbor.phone || '',
        mode: 'manual'
      });

      if (Array.isArray(result.logs)) {
        result.logs.forEach((log) => dbService.addNotificationLog(log));
      }

      if (!result.ok) {
        return res.status(500).json({ error: 'No se pudo enviar el aviso forzado. Revisa el registro.' });
      }

      return res.json({ message: 'Aviso de turno enviado (grupo e individual, según configuración).' });
    } catch (err) {
      return res.status(500).json({ error: 'Error al forzar el aviso del turno.' });
    }
  },
  runWhatsAppReminders: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      await whatsappService.runDailyReminders();
      return res.json({ message: 'Recordatorios ejecutados.' });
    } catch (err) {
      return res.status(500).json({ error: 'Error ejecutando recordatorios.' });
    }
  },
  sendMonthlySummary: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      const dbService = require('../services/db.service');
      const result = await whatsappService.sendMonthlySummaryToGroup();
      if (result.log) dbService.addNotificationLog(result.log);
      if (!result.ok) return res.status(400).json({ error: result.log?.error || 'No se pudo enviar resumen.' });
      return res.json({ message: 'Resumen mensual enviado al grupo.' });
    } catch (err) {
      return res.status(500).json({ error: 'Error al enviar resumen mensual.' });
    }
  },
  sendFinanceSummary: async (req, res) => {
    try {
      const { month, targetType, floorId } = req.body || {};
      const whatsappService = require('../services/whatsapp.service');
      const result = await whatsappService.sendFinanceSummary({ month, targetType, floorId });
      if (result.log) dbService.addNotificationLog(result.log);
      if (!result.ok) return res.status(400).json({ error: result.error || result.log?.error || 'No se pudo enviar estado de cuotas.' });
      return res.json({ message: 'Estado de cuotas enviado correctamente.' });
    } catch (err) {
      return res.status(500).json({ error: 'Error al enviar estado de cuotas.' });
    }
  },
  createWhatsAppPoll: async (req, res) => {
    try {
      const { question, options } = req.body || {};
      if (!question || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ error: 'Debes enviar pregunta y al menos 2 opciones.' });
      }
      const settings = dbService.getSettings();
      const groupId = settings.whatsappGroupId || '';
      if (!groupId) return res.status(400).json({ error: 'Configura primero el grupo de notificaciones.' });
      const poll = dbService.createPoll({ question, options, channel: 'group', groupId });
      const whatsappService = require('../services/whatsapp.service');
      const lines = options.map((o, idx) => `${idx + 1}. ${o}`).join('\n');
      const msg = `🗳️ *Encuesta ${poll.id}*\n${question}\n\n${lines}\n\nResponde en este grupo con: *VOTO <número>*`;
      const ok = await whatsappService.sendMessageToGroup(groupId, msg);
      dbService.addNotificationLog({
        notificationType: 'poll_create',
        mode: 'manual',
        channel: 'group',
        target: groupId,
        status: ok ? 'sent' : 'failed',
        error: ok ? '' : whatsappService.getStatus().lastError,
        message: msg
      });
      if (!ok) return res.status(500).json({ error: 'La encuesta se creó, pero no se pudo publicar en WhatsApp.' });
      return res.json({ message: 'Encuesta publicada.', poll });
    } catch (err) {
      return res.status(500).json({ error: 'Error al crear encuesta.' });
    }
  },
  sendSegmentedNotification: async (req, res) => {
    try {
      const { text, filter } = req.body || {};
      if (!text || text.trim().length < 3) return res.status(400).json({ error: 'Mensaje demasiado corto.' });
      const whatsappService = require('../services/whatsapp.service');
      const result = await whatsappService.sendSegmentedMessage({ text: text.trim(), filter: filter || {} });
      if (Array.isArray(result.logs)) result.logs.forEach((l) => dbService.addNotificationLog(l));
      if (!result.ok) return res.status(400).json({ error: 'No se pudo enviar a ningún destinatario válido.' });
      return res.json({ message: `Difusión enviada a ${result.total} destinatario(s).` });
    } catch (err) {
      return res.status(500).json({ error: 'Error enviando difusión segmentada.' });
    }
  },

  // Obtener estado de WhatsApp
  getWhatsAppStatus: (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      res.json(whatsappService.getStatus());
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener estado de WhatsApp.' });
    }
  },

  // Cerrar sesión y desvincular WhatsApp
  logoutWhatsApp: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      await whatsappService.logout();
      res.json({ message: 'Dispositivo desvinculado con éxito del servidor.' });
    } catch (err) {
      res.status(500).json({ error: 'Error al desvincular el dispositivo de WhatsApp.' });
    }
  },

  getWhatsAppTemplates: (req, res) => {
    try {
      const settings = dbService.getSettings();
      return res.json({
        templates: settings.whatsappTemplates || {}
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron cargar las plantillas de WhatsApp.' });
    }
  },

  updateWhatsAppTemplates: (req, res) => {
    try {
      const { templates } = req.body || {};
      if (!templates || typeof templates !== 'object') {
        return res.status(400).json({ error: 'Debes enviar un objeto de plantillas válido.' });
      }

      const allowedKeys = [
        'turn_start_general',
        'turn_start_individual',
        'turn_reminder_general',
        'turn_reminder_individual',
        'monthly_summary',
        'finance_summary',
        'invite_neighbor'
      ];

      const current = dbService.getSettings().whatsappTemplates || {};
      const updatedTemplates = { ...current };

      for (const key of allowedKeys) {
        if (typeof templates[key] === 'string') {
          updatedTemplates[key] = templates[key];
        }
      }

      dbService.updateSettings({ whatsappTemplates: updatedTemplates });

      return res.json({
        message: 'Plantillas de WhatsApp actualizadas correctamente.',
        templates: updatedTemplates
      });
    } catch (err) {
      return res.status(500).json({ error: 'No se pudieron guardar las plantillas de WhatsApp.' });
    }
  },

  restartWhatsApp: async (req, res) => {
    try {
      const whatsappService = require('../services/whatsapp.service');
      const ok = await whatsappService.restart();
      if (!ok) {
        return res.status(500).json({ error: 'No se pudo reiniciar el cliente de WhatsApp.' });
      }
      return res.json({ message: 'Cliente de WhatsApp reiniciado. Espera unos segundos para ver el nuevo estado/QR.' });
    } catch (err) {
      res.status(500).json({ error: 'Error al reiniciar el cliente de WhatsApp.' });
    }
  }
};

module.exports = adminController;
