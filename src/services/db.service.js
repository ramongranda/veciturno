const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../config/env');
const whatsappService = require('./whatsapp.service');

const DB_PATH = path.join(__dirname, '../../db/database.json');

let dbInMemoryData = null;
let pgPool = null;

function loadFromLocalJSONFile() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const dbDir = path.dirname(DB_PATH);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      const data = buildInitialData();
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
      dbInMemoryData = ensureDataShape(data);
    } else {
      const rawData = fs.readFileSync(DB_PATH, 'utf-8');
      dbInMemoryData = ensureDataShape(JSON.parse(rawData));
    }
  } catch (err) {
    console.error('Error al cargar archivo JSON local:', err);
    dbInMemoryData = ensureDataShape(buildInitialData());
  }
}


function normalizeMovementText(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.includes('traspaso interno periodico recibido spo from')) {
    return 'traspaso interno periodico recibido spo from';
  }
  return normalized;
}

function normalizeStructure(structure) {
  const raw = Array.isArray(structure) ? structure : [];
  const normalized = [];

  raw.forEach((item, idx) => {
    const portal = (item.portal || item.portalName || item.bloque || '').toString().trim();
    const floor = (item.floor || item.planta || '').toString().trim() || '0';
    const door = (item.door || item.puerta || item.unit || item.letra || '').toString().trim();
    const customName = (item.name || item.customName || item.unitName || '').toString().trim();
    const legalName = (item.legalName || item.documentName || '').toString().trim();
    const kind = (item.kind || item.type || item.tipo || '').toString().trim().toLowerCase() || 'vivienda';
    const exemptFromCleaning = item.exemptFromCleaning === true || item.exemptFromCleaning === 'true' || item.exempt === true;
    const unitKind = kind === 'comercial' ? 'comercial' : 'vivienda';
    const floorText = unitKind === 'comercial' ? `Bajo ${floor}` : `Planta ${floor}`;
    const doorText = door ? (unitKind === 'comercial' ? `Local ${door}` : `Puerta ${door}`) : '';
    const portalText = portal ? `Portal ${portal}` : '';
    const generatedLabel = [portalText, floorText, doorText].filter(Boolean).join(' · ');
    const floorLabel = customName || generatedLabel;

    normalized.push({
      id: (idx + 1).toString(),
      portal,
      floor,
      door,
      name: customName,
      legalName,
      kind: unitKind,
      exemptFromCleaning,
      floorLabel
    });
  });

  return normalized;
}

function defaultStructure() {
  return [
    { id: '1', portal: 'A', floor: '1', door: 'A', name: '', legalName: '', kind: 'vivienda', exemptFromCleaning: false, floorLabel: 'Portal A · Planta 1 · Puerta A' },
    { id: '2', portal: 'A', floor: '1', door: 'B', name: '', legalName: '', kind: 'vivienda', exemptFromCleaning: false, floorLabel: 'Portal A · Planta 1 · Puerta B' },
    { id: '3', portal: 'A', floor: '2', door: 'A', name: '', legalName: '', kind: 'vivienda', exemptFromCleaning: false, floorLabel: 'Portal A · Planta 2 · Puerta A' }
  ];
}

function buildInitialData() {
  const units = defaultStructure();
  return {
    communityStructure: units,
    neighbors: units.map((u, index) => ({
      id: u.id,
      floor: u.floorLabel,
      portal: u.portal,
      floorNumber: u.floor,
      door: u.door,
      kind: u.kind || 'vivienda',
      exemptFromCleaning: !!u.exemptFromCleaning,
      username: null,
      passwordHash: null,
      twoFactorSecret: null,
      twoFactorRegistered: false,
      passkeys: [],
      phone: '',
      isAdmin: index === units.length - 1
    })),
    inviteTokens: [
      {
        token: config.BOOTSTRAP_TOKEN,
        floorId: (units[units.length - 1]?.id || '1'),
        used: false,
        createdAt: new Date().toISOString()
      }
    ],
    state: {
      currentTurnFloorId: config.START_FLOOR_ID.toString(),
      currentMonth: config.START_MONTH,
      lastRotationDate: new Date().toISOString()
    },
    history: [],
    financeRecords: [],
    financeContributions: [],
    financeMovements: [],
    notificationLogs: [],
    incidents: [],
    pollRecords: [],
    turnConfirmations: [],
    settings: {
      communityName: config.COMMUNITY_NAME || 'Comunidad VeciTurno',
      whatsappGroupId: '',
      remindersEnabled: true,
      reminderOffsetsDays: [3, 1, 0],
      lastReminderRunDate: '',
      ownersGroupId: '',
      debtorsGroupId: '',
      defaultFeeHousing: 25,
      defaultFeeCommercial: 20,
      adminUsername: '',
      adminOwnerFloorId: '',
      currentBankBalance: null
    }
  };
}

const initialData = buildInitialData();

function getTurnOrderIds(data) {
  return (data.neighbors || [])
    .filter((n) => !n.exemptFromCleaning)
    .slice()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(n => n.id);
}

function getNextTurnId(data, currentId) {
  const ids = getTurnOrderIds(data);
  if (ids.length === 0) return null;

  const idx = ids.indexOf(currentId);
  if (idx === -1) return ids[0];

  return ids[(idx + 1) % ids.length];
}

function ensureDataShape(data) {
  const safe = data && typeof data === 'object' ? data : {};

  safe.neighbors = Array.isArray(safe.neighbors) ? safe.neighbors : [];
  safe.inviteTokens = Array.isArray(safe.inviteTokens) ? safe.inviteTokens : [];
  safe.history = Array.isArray(safe.history) ? safe.history : [];
  safe.financeRecords = Array.isArray(safe.financeRecords) ? safe.financeRecords : [];
  safe.financeContributions = Array.isArray(safe.financeContributions) ? safe.financeContributions : [];
  safe.financeMovements = Array.isArray(safe.financeMovements) ? safe.financeMovements : [];
  safe.notificationLogs = Array.isArray(safe.notificationLogs) ? safe.notificationLogs : [];
  safe.incidents = Array.isArray(safe.incidents) ? safe.incidents : [];
  safe.pollRecords = Array.isArray(safe.pollRecords) ? safe.pollRecords : [];
  safe.turnConfirmations = Array.isArray(safe.turnConfirmations) ? safe.turnConfirmations : [];
  safe.settings = safe.settings && typeof safe.settings === 'object' ? safe.settings : {};
  if (typeof safe.settings.communityName !== 'string') {
    safe.settings.communityName = config.COMMUNITY_NAME || 'Comunidad VeciTurno';
  }
  if (typeof safe.settings.whatsappGroupId !== 'string') {
    safe.settings.whatsappGroupId = '';
  }
  if (typeof safe.settings.remindersEnabled !== 'boolean') {
    safe.settings.remindersEnabled = true;
  }
  if (!Array.isArray(safe.settings.reminderOffsetsDays)) {
    safe.settings.reminderOffsetsDays = [3, 1, 0];
  }
  if (typeof safe.settings.lastReminderRunDate !== 'string') {
    safe.settings.lastReminderRunDate = '';
  }
  if (typeof safe.settings.ownersGroupId !== 'string') {
    safe.settings.ownersGroupId = '';
  }
  if (typeof safe.settings.debtorsGroupId !== 'string') {
    safe.settings.debtorsGroupId = '';
  }
  if (!Number.isFinite(Number(safe.settings.defaultFeeHousing))) {
    safe.settings.defaultFeeHousing = 25;
  }
  if (!Number.isFinite(Number(safe.settings.defaultFeeCommercial))) {
    safe.settings.defaultFeeCommercial = 20;
  }
  if (typeof safe.settings.adminUsername !== 'string') {
    safe.settings.adminUsername = '';
  }
  if (typeof safe.settings.adminOwnerFloorId !== 'string') {
    safe.settings.adminOwnerFloorId = '';
  }
  if (safe.settings.currentBankBalance !== null && !Number.isFinite(Number(safe.settings.currentBankBalance))) {
    safe.settings.currentBankBalance = null;
  }
  if (!safe.settings.movementNameAssignments || typeof safe.settings.movementNameAssignments !== 'object') {
    safe.settings.movementNameAssignments = {};
  }
  if (!safe.settings.whatsappTemplates || typeof safe.settings.whatsappTemplates !== 'object') {
    safe.settings.whatsappTemplates = {
      turn_start_general: '🏡 *VeciTurno (Notificación General)*:\n\n¡Atención comunidad! Ha comenzado el turno de limpieza de *{mes}*.\n\nLe corresponde limpiar de forma automática a: *{vecino}*.\n\n¡Gracias por colaborar con la limpieza y mantenimiento del portal! ✨',
      turn_start_individual: '🏡 *VeciTurno (Aviso Forzado por Admin)*:\n\nSe envía recordatorio de inicio de turno de limpieza de *{mes}*.\n\nTurno actual: *{vecino}*.\n\nGracias por colaborar.',
      turn_reminder_general: '🧹 *Recordatorio de turno de limpieza*\n\nEl turno de *{vecino}* comienza *{tiempo}*.',
      turn_reminder_individual: '🧹 *Recordatorio de turno de limpieza*\n\nTu turno ({vecino}) comienza *{tiempo}*.\nPor favor confirma respondiendo: *OK TURNO*',
      monthly_summary: '📊 *Resumen mensual VeciTurno*\n\nTurno actual: *{vecino}*\nMes: *{mes}*\n\nÚltimos turnos:\n{historial}\n\nGracias por colaborar.',
      finance_summary: '💶 *Estado de cuotas y gastos ({mes})*\n\nIngresos por cuotas: {ingresos} €\nGasto seguro: {gasto_seguro} €\nGasto luz: {gasto_luz} €\nBalance: {balance} €\n{notas}',
      invite_neighbor: '🏡 *VeciTurno (Invitación de Registro)*:\n\n¡Hola! Te invitamos a registrarte en el sistema de turnos de limpieza de *{comunidad}*.\n\nPara configurar tu usuario y contraseña, accede al siguiente enlace:\n👉 {enlace}\n\n¡Gracias por colaborar! ✨'
    };
  }

  if (!safe.state || typeof safe.state !== 'object') {
    safe.state = {
      currentTurnFloorId: config.START_FLOOR_ID.toString(),
      currentMonth: config.START_MONTH,
      lastRotationDate: new Date().toISOString()
    };
  }

  // Migración desde formato antiguo (solo "Piso N") a estructura flexible.
  if (!Array.isArray(safe.communityStructure) || safe.communityStructure.length === 0) {
    safe.communityStructure = safe.neighbors.map((n, idx) => ({
      id: n.id || (idx + 1).toString(),
      portal: n.portal || 'A',
      floor: n.floorNumber || String(idx + 1),
      door: n.door || 'A',
      name: '',
      legalName: '',
      kind: n.kind || 'vivienda',
      exemptFromCleaning: !!n.exemptFromCleaning,
      floorLabel: n.floor || `Portal A · Planta ${idx + 1} · Puerta A`
    }));
  }

  // Normalizar vecinos contra estructura
  const byId = new Map(safe.neighbors.map(n => [n.id, n]));
  safe.neighbors = safe.communityStructure.map((unit, idx) => {
    const existing = byId.get(unit.id) || {};
    return {
      id: unit.id,
      floor: unit.floorLabel,
      portal: unit.portal,
      floorNumber: unit.floor,
      door: unit.door,
      kind: unit.kind || 'vivienda',
      exemptFromCleaning: !!unit.exemptFromCleaning,
      monthlyFeeOverride: Number.isFinite(Number(existing.monthlyFeeOverride)) ? Number(existing.monthlyFeeOverride) : null,
      username: existing.username || null,
      passwordHash: existing.passwordHash || null,
      twoFactorSecret: existing.twoFactorSecret || null,
      twoFactorRegistered: !!existing.twoFactorRegistered,
      passkeys: Array.isArray(existing.passkeys) ? existing.passkeys : [],
      phone: existing.phone || '',
      isAdmin: existing.isAdmin === true,
      deactivated: !!existing.deactivated
    };
  });

  if (!safe.settings.adminUsername) {
    const oldAdmin = safe.neighbors.find(n => n.isAdmin && n.username);
    if (oldAdmin && oldAdmin.username) {
      safe.settings.adminUsername = oldAdmin.username;
    }
  }

  const validIds = new Set(safe.neighbors.map(n => n.id));
  safe.inviteTokens = safe.inviteTokens.filter(t => validIds.has(t.floorId));

  const eligibleIds = getTurnOrderIds(safe);
  if (!validIds.has(safe.state.currentTurnFloorId) || !eligibleIds.includes(safe.state.currentTurnFloorId)) {
    safe.state.currentTurnFloorId = eligibleIds[0] || safe.neighbors[0]?.id || '1';
  }

  return safe;
}

function checkAndAutoRotate(data) {
  if (!data.state || !data.state.currentMonth) return data;

  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  const currentCalendarMonth = now.getMonth();

  const [dbYear, dbMonth] = data.state.currentMonth.split('-').map(Number);

  let dbDate = new Date(dbYear, dbMonth - 1, 1);
  const currentDate = new Date(currentCalendarYear, currentCalendarMonth, 1);

  let updated = false;

  while (currentDate > dbDate) {
    const currentId = data.state.currentTurnFloorId;
    const nextId = getNextTurnId(data, currentId);

    if (!nextId) break;

    const monthOptions = { month: 'long', year: 'numeric' };
    const formattedMonth = dbDate.toLocaleDateString('es-ES', monthOptions);
    const capitalizedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

    data.history.unshift({
      id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
      floorId: currentId,
      completedAt: new Date().toISOString(),
      completedBy: `Sistema (Mes de ${capitalizedMonth} finalizado)`
    });

    if (data.history.length > 50) {
      data.history = data.history.slice(0, 50);
    }

    data.state.currentTurnFloorId = nextId;

    dbDate.setMonth(dbDate.getMonth() + 1);
    data.state.currentMonth = dbDate.toISOString().slice(0, 10);
    data.state.lastRotationDate = new Date().toISOString();

    updated = true;
  }

  if (updated) {
    try {
      writeDB(data);

      const nextNeighbor = data.neighbors.find(n => n.id === data.state.currentTurnFloorId);
      const nextFloorName = nextNeighbor ? nextNeighbor.floor : 'Vivienda desconocida';
      const monthDate = new Date(data.state.currentMonth);
      const monthOptions = { month: 'long', year: 'numeric' };
      let formattedMonth = monthDate.toLocaleDateString('es-ES', monthOptions);
      formattedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

      const groupId = data.settings?.whatsappGroupId || '';
      const individualPhone = nextNeighbor?.phone || '';
      whatsappService.sendRotationNotification(nextFloorName, formattedMonth, {
        groupId,
        individualPhone
      })
        .then((result) => {
          if (result && Array.isArray(result.logs) && result.logs.length > 0) {
            const latest = readDB();
            latest.notificationLogs = latest.notificationLogs || [];
            latest.notificationLogs.unshift(...result.logs);
            if (latest.notificationLogs.length > 500) {
              latest.notificationLogs = latest.notificationLogs.slice(0, 500);
            }
            writeDB(latest);
          }
        })
        .catch(err => console.error('Error asíncrono al enviar WhatsApp de rotación:', err));
    } catch (err) {
      console.error('Error escribiendo base de datos en auto-rotación:', err);
    }
  }

  return data;
}

function readDB() {
  if (!dbInMemoryData) {
    dbInMemoryData = ensureDataShape(buildInitialData());
  }
  return checkAndAutoRotate(dbInMemoryData);
}

function writeDB(data) {
  dbInMemoryData = ensureDataShape(data);
  if (config.DATABASE_URL && pgPool) {
    // Sincronización asíncrona en segundo plano a PostgreSQL gestionado
    pgPool.query(
      'INSERT INTO veciturno_store (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1',
      [JSON.stringify(dbInMemoryData)]
    ).catch((err) => {
      console.error('Error al guardar asíncronamente en PostgreSQL:', err.message);
    });
  } else {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(dbInMemoryData, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error al escribir en la base de datos JSON local:', err.message);
    }
  }
}

const dbService = {
  initialize: async () => {
    if (config.DATABASE_URL) {
      console.log('🔌 Conectando a la base de datos remota de PostgreSQL gestionado...');
      pgPool = new Pool({
        connectionString: config.DATABASE_URL,
        ssl: config.PG_SSL ? { rejectUnauthorized: false } : false
      });

      try {
        await pgPool.query(`
          CREATE TABLE IF NOT EXISTS veciturno_store (
            id INT PRIMARY KEY,
            data JSONB
          );
        `);

        const res = await pgPool.query('SELECT data FROM veciturno_store WHERE id = 1');
        if (res.rows.length > 0) {
          console.log('✅ Base de datos remota cargada correctamente de PostgreSQL.');
          dbInMemoryData = ensureDataShape(res.rows[0].data);
        } else {
          console.log('📦 Inicializando base de datos vacía en PostgreSQL...');
          const data = buildInitialData();
          await pgPool.query('INSERT INTO veciturno_store (id, data) VALUES (1, $1)', [JSON.stringify(data)]);
          dbInMemoryData = ensureDataShape(data);
        }
      } catch (err) {
        console.error('❌ Error crítico al inicializar la base de datos remota en PostgreSQL:', err.message);
        console.log('⚠️ Rebotando al archivo JSON local temporal como medida de seguridad.');
        loadFromLocalJSONFile();
      }
    } else {
      console.log('🏡 Usando base de datos JSON local (desarrollo local).');
      loadFromLocalJSONFile();
    }
  },
  getNeighbors: () => readDB().neighbors,
  getNeighborById: (id) => readDB().neighbors.find(n => n.id === id),
  getNeighborByUsername: (username) => {
    if (!username) return null;
    return readDB().neighbors.find(n => n.username && n.username.toLowerCase() === username.toLowerCase());
  },
  updateNeighbor: (id, updates) => {
    const data = readDB();
    const index = data.neighbors.findIndex(n => n.id === id);
    if (index !== -1) {
      data.neighbors[index] = { ...data.neighbors[index], ...updates };
      
      const structIndex = data.communityStructure.findIndex(u => u.id === id);
      if (structIndex !== -1) {
        if (updates && Object.prototype.hasOwnProperty.call(updates, 'exemptFromCleaning')) {
          data.communityStructure[structIndex].exemptFromCleaning = !!updates.exemptFromCleaning;
        }
        if (updates && (Object.prototype.hasOwnProperty.call(updates, 'name') || Object.prototype.hasOwnProperty.call(updates, 'kind'))) {
          const u = data.communityStructure[structIndex];
          if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
            u.name = String(updates.name || '').trim();
          }
          if (Object.prototype.hasOwnProperty.call(updates, 'kind')) {
            u.kind = updates.kind === 'comercial' ? 'comercial' : 'vivienda';
          }
          
          const floorText = u.kind === 'comercial' ? `Bajo ${u.floor}` : `Planta ${u.floor}`;
          const doorText = u.door ? (u.kind === 'comercial' ? `Local ${u.door}` : `Puerta ${u.door}`) : '';
          const portalText = u.portal ? `Portal ${u.portal}` : '';
          const generatedLabel = [portalText, floorText, doorText].filter(Boolean).join(' · ');
          u.floorLabel = u.name || generatedLabel;
        }
      }
      
      writeDB(data);
      return data.neighbors[index];
    }
    return null;
  },
  getMonthlyFeeForNeighbor: (neighborId) => {
    const data = readDB();
    const neighbor = data.neighbors.find(n => n.id === neighborId);
    if (!neighbor) return 0;
    if (Number.isFinite(Number(neighbor.monthlyFeeOverride))) {
      return Number(neighbor.monthlyFeeOverride);
    }
    return (neighbor.kind === 'comercial')
      ? Number(data.settings?.defaultFeeCommercial || 20)
      : Number(data.settings?.defaultFeeHousing || 25);
  },
  setNeighborMonthlyFeeOverride: (neighborId, monthlyFeeOverride) => {
    const data = readDB();
    const neighbor = data.neighbors.find(n => n.id === neighborId);
    if (!neighbor) return null;
    neighbor.monthlyFeeOverride = monthlyFeeOverride === null ? null : Number(monthlyFeeOverride);
    writeDB(data);
    return neighbor;
  },
  getState: () => readDB().state,
  setCurrentTurnFloorId: (floorId) => {
    const data = readDB();
    if (data.state) {
      data.state.currentTurnFloorId = String(floorId);
      data.state.lastRotationDate = new Date().toISOString();
      writeDB(data);
      return data.state;
    }
    return null;
  },
  getHistory: () => readDB().history,
  getInviteTokens: () => readDB().inviteTokens,
  getInviteToken: (token) => readDB().inviteTokens.find(t => t.token === token),
  createInviteToken: (floorId, token) => {
    const data = readDB();
    data.inviteTokens = data.inviteTokens.filter(t => t.floorId !== floorId || t.used);
    const newToken = {
      token,
      floorId,
      used: false,
      createdAt: new Date().toISOString()
    };
    data.inviteTokens.push(newToken);
    writeDB(data);
    return newToken;
  },
  useInviteToken: (token) => {
    const data = readDB();
    const tokenObj = data.inviteTokens.find(t => t.token === token);
    if (tokenObj) {
      tokenObj.used = true;
      writeDB(data);
      return true;
    }
    return false;
  },
  getTurnOrderIds: () => {
    const data = readDB();
    return getTurnOrderIds(data);
  },
  getCommunityStructure: () => {
    const data = readDB();
    return data.communityStructure || [];
  },
  updateCommunityStructure: ({ units, adminUnitId }) => {
    const normalizedUnits = normalizeStructure(units);

    if (normalizedUnits.length === 0) {
      throw new Error('La estructura de comunidad debe tener al menos una vivienda.');
    }
    if (!normalizedUnits.some((u) => !u.exemptFromCleaning)) {
      throw new Error('Debe existir al menos una unidad no exenta para el turno de limpieza.');
    }

    const data = readDB();
    const oldNeighbors = data.neighbors || [];

    const preservedByLabel = new Map();
    oldNeighbors.forEach(n => {
      preservedByLabel.set((n.floor || '').toLowerCase(), n);
    });

    const currentAdminUsername = data.settings?.adminUsername || (oldNeighbors.find(n => n.isAdmin && n.username)?.username || '');
    const newNeighbors = normalizedUnits.map((unit, idx) => {
      const preserved = preservedByLabel.get(unit.floorLabel.toLowerCase()) || {};
      const isSystemAdmin = !!(currentAdminUsername && preserved.username && preserved.username.toLowerCase() === currentAdminUsername.toLowerCase());
      return {
        id: unit.id,
        floor: unit.floorLabel,
        portal: unit.portal,
        floorNumber: unit.floor,
        door: unit.door,
        name: unit.name || '',
        legalName: unit.legalName || '',
        kind: unit.kind || 'vivienda',
        exemptFromCleaning: !!unit.exemptFromCleaning,
        username: preserved.username || null,
        passwordHash: preserved.passwordHash || null,
        twoFactorSecret: preserved.twoFactorSecret || null,
        twoFactorRegistered: !!preserved.twoFactorRegistered,
        passkeys: Array.isArray(preserved.passkeys) ? preserved.passkeys : [],
        phone: preserved.phone || '',
        isAdmin: adminUnitId ? unit.id === adminUnitId : isSystemAdmin
      };
    });

    data.communityStructure = normalizedUnits;
    data.neighbors = newNeighbors;

    if (adminUnitId && !newNeighbors.some(n => n.isAdmin) && newNeighbors.length > 0) {
      newNeighbors[newNeighbors.length - 1].isAdmin = true;
    }

    const validIds = new Set(newNeighbors.map(n => n.id));
    data.inviteTokens = (data.inviteTokens || []).filter(t => validIds.has(t.floorId));

    const eligibleIds = getTurnOrderIds(data);
    if (!validIds.has(data.state.currentTurnFloorId) || !eligibleIds.includes(data.state.currentTurnFloorId)) {
      data.state.currentTurnFloorId = eligibleIds[0] || newNeighbors[0].id;
    }

    writeDB(data);

    return {
      communityStructure: normalizedUnits,
      neighbors: newNeighbors,
      state: data.state
    };
  },
  getFinanceRecords: () => readDB().financeRecords || [],
  getFinanceMovements: (limit = 5000) => {
    const data = readDB();
    return (data.financeMovements || []).slice(0, limit);
  },
  upsertFinanceMovement: ({ month, dateValue, amount, description, movementType = 'other', source = 'bank_import' }) => {
    const data = readDB();
    const rows = data.financeMovements || [];
    const key = `${month}|${dateValue}|${Number(amount).toFixed(2)}|${String(description || '').trim().toLowerCase()}`;
    const index = rows.findIndex((r) => r.key === key);
    const payload = {
      id: index >= 0 ? rows[index].id : `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      key,
      month,
      dateValue,
      amount: Number(amount) || 0,
      description: String(description || ''),
      movementType,
      source,
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) {
      rows[index] = payload;
    } else {
      rows.unshift(payload);
    }
    if (rows.length > 10000) data.financeMovements = rows.slice(0, 10000);
    else data.financeMovements = rows;
    writeDB(data);
    return { movement: payload, inserted: index < 0 };
  },
  rebuildFinanceRecordsFromMovements: ({ uploadedBy = 'system' } = {}) => {
    const data = readDB();
    const rows = data.financeMovements || [];
    const perMonth = new Map();
    rows.forEach((m) => {
      const month = String(m.month || '').trim();
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      if (!perMonth.has(month)) {
        perMonth.set(month, { incomeFees: 0, expenseInsurance: 0, expenseElectricity: 0, notes: [] });
      }
      const bucket = perMonth.get(month);
      const amount = Number(m.amount || 0);
      const kind = String(m.movementType || 'other');
      if (kind === 'income_fee') bucket.incomeFees += Math.max(0, amount);
      else if (kind === 'expense_insurance') bucket.expenseInsurance += Math.abs(amount);
      else if (kind === 'expense_electricity') bucket.expenseElectricity += Math.abs(amount);
      else if (amount < 0) bucket.notes.push(`Gasto no clasificado: ${m.description} (${Math.abs(amount).toFixed(2)} €)`);
    });

    const rebuilt = Array.from(perMonth.entries()).map(([month, v]) => ({
      id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      month,
      incomeFees: Number(v.incomeFees.toFixed(2)),
      expenseInsurance: Number(v.expenseInsurance.toFixed(2)),
      expenseElectricity: Number(v.expenseElectricity.toFixed(2)),
      notes: v.notes.join(' | '),
      uploadedBy,
      updatedAt: new Date().toISOString()
    })).sort((a, b) => (a.month < b.month ? 1 : -1));

    data.financeRecords = rebuilt;
    writeDB(data);
    return rebuilt;
  },
  resetFinanceData: ({ keepAssignments = true } = {}) => {
    const data = readDB();
    data.financeRecords = [];
    data.financeContributions = [];
    data.financeMovements = [];
    if (data.settings && typeof data.settings === 'object') {
      data.settings.currentBankBalance = null;
      data.settings.currentBankBalanceDate = null;
      if (!keepAssignments) {
        data.settings.movementNameAssignments = {};
      }
    }
    writeDB(data);
    return {
      records: 0,
      contributions: 0,
      movements: 0,
      keepAssignments: !!keepAssignments
    };
  },
  getFinanceContributions: (limit = 500) => {
    const data = readDB();
    return (data.financeContributions || []).slice(0, limit);
  },
  relinkFinanceContributionsByPayerKey: ({ payerKey, unitId, unitName }) => {
    const data = readDB();
    const rows = data.financeContributions || [];
    const normalizedKey = normalizeMovementText(payerKey);
    if (!normalizedKey) return 0;
    let updated = 0;
    rows.forEach((r) => {
      const desc = normalizeMovementText(r.description);
      if (desc.includes(normalizedKey)) {
        r.unitId = unitId || '';
        r.unitName = unitName || '';
        r.matched = !!unitId;
        r.updatedAt = new Date().toISOString();
        updated += 1;
      }
    });
    data.financeContributions = rows;
    writeDB(data);
    return updated;
  },
  upsertFinanceContribution: ({ month, dateValue, amount, description, unitId = '', unitName = '', matched = false, source = 'bank_import' }) => {
    const data = readDB();
    const rows = data.financeContributions || [];
    const key = `${month}|${dateValue}|${Number(amount).toFixed(2)}|${String(description || '').trim().toLowerCase()}`;
    const index = rows.findIndex((r) => r.key === key);
    const payload = {
      id: index >= 0 ? rows[index].id : `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      key,
      month,
      dateValue,
      amount: Number(amount) || 0,
      description: String(description || ''),
      unitId: unitId || '',
      unitName: unitName || '',
      matched: !!matched,
      source,
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) rows[index] = payload;
    else rows.unshift(payload);
    if (rows.length > 3000) data.financeContributions = rows.slice(0, 3000);
    else data.financeContributions = rows;
    writeDB(data);
    return payload;
  },
  upsertFinanceRecord: ({ month, incomeFees, expenseInsurance, expenseElectricity, notes, uploadedBy }) => {
    const data = readDB();
    const records = data.financeRecords || [];
    const index = records.findIndex(r => r.month === month);
    const payload = {
      id: index >= 0 ? records[index].id : `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      month,
      incomeFees: Number(incomeFees) || 0,
      expenseInsurance: Number(expenseInsurance) || 0,
      expenseElectricity: Number(expenseElectricity) || 0,
      notes: notes || '',
      uploadedBy,
      updatedAt: new Date().toISOString()
    };
    if (index >= 0) {
      records[index] = payload;
    } else {
      records.push(payload);
    }
    records.sort((a, b) => (a.month < b.month ? 1 : -1));
    data.financeRecords = records;
    writeDB(data);
    return payload;
  },
  getNotificationLogs: (limit = 200) => {
    const data = readDB();
    const logs = data.notificationLogs || [];
    return logs.slice(0, limit);
  },
  addNotificationLog: (logEntry) => {
    const data = readDB();
    data.notificationLogs = data.notificationLogs || [];
    data.notificationLogs.unshift({
      id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      ...logEntry
    });
    if (data.notificationLogs.length > 500) {
      data.notificationLogs = data.notificationLogs.slice(0, 500);
    }
    writeDB(data);
  },
  getSettings: () => readDB().settings || { whatsappGroupId: '' },
  isSystemAdminUsername: (username) => {
    if (!username) return false;
    const settings = readDB().settings || {};
    return !!(settings.adminUsername && settings.adminUsername.toLowerCase() === String(username).toLowerCase());
  },
  updateSettings: (partialSettings) => {
    const data = readDB();
    const normalized = { ...(partialSettings || {}) };
    if (Object.prototype.hasOwnProperty.call(normalized, 'defaultFeeHousing')) {
      normalized.defaultFeeHousing = Number(normalized.defaultFeeHousing);
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'defaultFeeCommercial')) {
      normalized.defaultFeeCommercial = Number(normalized.defaultFeeCommercial);
    }
    data.settings = {
      ...(data.settings || {}),
      ...normalized
    };
    writeDB(data);
    return data.settings;
  },
  addIncident: ({ source = 'whatsapp', from = '', text = '', status = 'open' }) => {
    const data = readDB();
    data.incidents = data.incidents || [];
    const incident = {
      id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      source,
      from,
      text,
      status
    };
    data.incidents.unshift(incident);
    if (data.incidents.length > 500) data.incidents = data.incidents.slice(0, 500);
    writeDB(data);
    return incident;
  },
  getIncidents: (limit = 100) => {
    const data = readDB();
    return (data.incidents || []).slice(0, limit);
  },
  addTurnConfirmation: ({ floorId, month, phone, via = 'whatsapp' }) => {
    const data = readDB();
    data.turnConfirmations = data.turnConfirmations || [];
    const existing = data.turnConfirmations.find(c => c.floorId === floorId && c.month === month);
    if (existing) {
      existing.updatedAt = new Date().toISOString();
      existing.phone = phone || existing.phone;
      existing.via = via;
      writeDB(data);
      return existing;
    }
    const item = {
      id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      floorId,
      month,
      phone,
      via
    };
    data.turnConfirmations.unshift(item);
    if (data.turnConfirmations.length > 500) data.turnConfirmations = data.turnConfirmations.slice(0, 500);
    writeDB(data);
    return item;
  },
  hasTurnConfirmation: ({ floorId, month }) => {
    const data = readDB();
    return !!(data.turnConfirmations || []).find(c => c.floorId === floorId && c.month === month);
  },
  createPoll: ({ question, options = [], channel = 'group', groupId = '' }) => {
    const data = readDB();
    data.pollRecords = data.pollRecords || [];
    const poll = {
      id: `P${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      question,
      options,
      channel,
      groupId,
      status: 'open',
      votes: []
    };
    data.pollRecords.unshift(poll);
    if (data.pollRecords.length > 200) data.pollRecords = data.pollRecords.slice(0, 200);
    writeDB(data);
    return poll;
  },
  getLatestOpenPoll: (groupId = '') => {
    const data = readDB();
    return (data.pollRecords || []).find(p => p.status === 'open' && (!groupId || p.groupId === groupId)) || null;
  },
  addPollVote: ({ pollId, voter, optionIndex }) => {
    const data = readDB();
    const poll = (data.pollRecords || []).find(p => p.id === pollId);
    if (!poll) return null;
    poll.votes = poll.votes || [];
    const existing = poll.votes.find(v => v.voter === voter);
    if (existing) {
      existing.optionIndex = optionIndex;
      existing.updatedAt = new Date().toISOString();
    } else {
      poll.votes.push({
        voter,
        optionIndex,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    writeDB(data);
    return poll;
  },
  closePoll: (pollId) => {
    const data = readDB();
    const poll = (data.pollRecords || []).find(p => p.id === pollId);
    if (!poll) return null;
    poll.status = 'closed';
    poll.closedAt = new Date().toISOString();
    writeDB(data);
    return poll;
  },
  saveGeneratedCertificate: (cert) => {
    const data = readDB();
    data.generatedCertificates = data.generatedCertificates || [];
    data.generatedCertificates.push(cert);
    writeDB(data);
  },
  getGeneratedCertificate: (csv) => {
    const data = readDB();
    return (data.generatedCertificates || []).find(c => c.csv === csv);
  }
};

module.exports = dbService;
