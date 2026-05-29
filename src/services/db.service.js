const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const whatsappService = require('./whatsapp.service');

const DB_PATH = path.join(__dirname, '../../db/database.json');

// Asegurar carpeta de BD
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Datos iniciales de la comunidad cargados desde configuración (.env)
const initialData = {
  neighbors: [
    {
      id: "1",
      floor: "Planta 1",
      username: null,
      passwordHash: null,
      twoFactorSecret: null,
      twoFactorRegistered: false,
      phone: "",
      isAdmin: false
    },
    {
      id: "2",
      floor: "Planta 2",
      username: null,
      passwordHash: null,
      twoFactorSecret: null,
      twoFactorRegistered: false,
      phone: "",
      isAdmin: false
    },
    {
      id: "3",
      floor: "Planta 3",
      username: null,
      passwordHash: null,
      twoFactorSecret: null,
      twoFactorRegistered: false,
      phone: "",
      isAdmin: true // Planta 3 es Administrador
    }
  ],
  inviteTokens: [
    {
      token: config.BOOTSTRAP_TOKEN,
      floorId: "3",
      used: false,
      createdAt: new Date().toISOString()
    }
  ],
  state: {
    currentTurnFloorId: config.START_FLOOR_ID.toString(),
    currentMonth: config.START_MONTH,
    lastRotationDate: new Date().toISOString()
  },
  history: []
};

// Comprobación y auto-rotación mensual basado en la fecha del calendario
function checkAndAutoRotate(data) {
  if (!data.state || !data.state.currentMonth) return data;

  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  const currentCalendarMonth = now.getMonth(); // 0-indexed

  const [dbYear, dbMonth] = data.state.currentMonth.split('-').map(Number);
  
  let dbDate = new Date(dbYear, dbMonth - 1, 1);
  let currentDate = new Date(currentCalendarYear, currentCalendarMonth, 1);

  let updated = false;

  while (currentDate > dbDate) {
    const currentId = data.state.currentTurnFloorId;
    let nextId = "1";
    if (currentId === "1") nextId = "2";
    else if (currentId === "2") nextId = "3";
    else if (currentId === "3") nextId = "1";

    const monthOptions = { month: 'long', year: 'numeric' };
    const formattedMonth = dbDate.toLocaleDateString('es-ES', monthOptions);
    const capitalizedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

    const newHistoryEntry = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
      floorId: currentId,
      completedAt: new Date().toISOString(),
      completedBy: `Sistema (Mes de ${capitalizedMonth} finalizado)`
    };

    data.history.unshift(newHistoryEntry);
    
    if (data.history.length > 20) {
      data.history = data.history.slice(0, 20);
    }

    data.state.currentTurnFloorId = nextId;
    
    dbDate.setMonth(dbDate.getMonth() + 1);
    data.state.currentMonth = dbDate.toISOString().slice(0, 10);
    data.state.lastRotationDate = new Date().toISOString();
    
    updated = true;
  }

  if (updated) {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
      
      // Enviar la notificación de WhatsApp de forma asíncrona sin bloquear la respuesta
      const nextNeighbor = data.neighbors.find(n => n.id === data.state.currentTurnFloorId);
      const nextFloorName = nextNeighbor ? nextNeighbor.floor : 'Planta Desconocida';
      const monthDate = new Date(data.state.currentMonth);
      const monthOptions = { month: 'long', year: 'numeric' };
      let formattedMonth = monthDate.toLocaleDateString('es-ES', monthOptions);
      formattedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);
      
      whatsappService.sendRotationNotification(nextFloorName, formattedMonth)
        .catch(err => console.error("Error asíncrono al enviar WhatsApp de rotación:", err));
    } catch (err) {
      console.error("Error escribiendo base de datos en auto-rotación:", err);
    }
  }

  return data;
}

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDB(initialData);
      return checkAndAutoRotate(initialData);
    }
    const rawData = fs.readFileSync(DB_PATH, 'utf-8');
    const data = JSON.parse(rawData);
    return checkAndAutoRotate(data);
  } catch (err) {
    console.error("Error al leer la base de datos JSON:", err);
    return initialData;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("Error al escribir en la base de datos JSON:", err);
  }
}

const dbService = {
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
      writeDB(data);
      return data.neighbors[index];
    }
    return null;
  },
  getState: () => readDB().state,
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
  }
};

module.exports = dbService;
