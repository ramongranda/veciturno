const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../db/database.json');

// Garantizar que la carpeta db existe
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Datos iniciales de la comunidad
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
      isAdmin: true // La tercera planta actúa como administrador ahora
    }
  ],
  inviteTokens: [
    {
      token: "registro-inicial-planta3",
      floorId: "3",
      used: false,
      createdAt: new Date().toISOString()
    }
  ],
  state: {
    currentTurnFloorId: "1", // Empieza el Vecino de la Planta 1
    currentMonth: "2026-06-01", // Empieza en Junio de 2026
    lastRotationDate: new Date().toISOString()
  },
  history: []
};

// Comprobación y auto-rotación mensual basado en la fecha del calendario
function checkAndAutoRotate(data) {
  if (!data.state || !data.state.currentMonth) return data;

  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  const currentCalendarMonth = now.getMonth(); // 0-indexed (5 es Junio)

  // Parsear el mes de turno en BD ("YYYY-MM-DD")
  const [dbYear, dbMonth] = data.state.currentMonth.split('-').map(Number);
  
  let dbDate = new Date(dbYear, dbMonth - 1, 1);
  let currentDate = new Date(currentCalendarYear, currentCalendarMonth, 1);

  let updated = false;

  // Si la fecha actual del sistema supera el mes de turno guardado en BD
  while (currentDate > dbDate) {
    const currentId = data.state.currentTurnFloorId;
    let nextId = "1";
    if (currentId === "1") nextId = "2";
    else if (currentId === "2") nextId = "3";
    else if (currentId === "3") nextId = "1";

    const monthOptions = { month: 'long', year: 'numeric' };
    const formattedMonth = dbDate.toLocaleDateString('es-ES', monthOptions);
    const capitalizedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);

    // Registrar en el historial que el mes finalizó y rotó automáticamente
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
    
    // Incrementar el mes en BD por 1 mes
    dbDate.setMonth(dbDate.getMonth() + 1);
    data.state.currentMonth = dbDate.toISOString().slice(0, 10);
    data.state.lastRotationDate = new Date().toISOString();
    
    updated = true;
  }

  if (updated) {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error("Error escribiendo base de datos en auto-rotación:", err);
    }
  }

  return data;
}

// Cargar base de datos
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

// Escribir base de datos
function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error("Error al escribir en la base de datos JSON:", err);
  }
}

// Métodos de consulta y actualización
const db = {
  // Vecinos
  getNeighbors: () => {
    return readDB().neighbors;
  },
  getNeighborById: (id) => {
    return readDB().neighbors.find(n => n.id === id);
  },
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

  // Estado del Turno
  getState: () => {
    return readDB().state;
  },
  rotateTurn: (completedByUsername) => {
    const data = readDB();
    const currentId = data.state.currentTurnFloorId;
    
    // Calcular siguiente vecino de forma cíclica (1 -> 2 -> 3 -> 1)
    let nextId = "1";
    if (currentId === "1") nextId = "2";
    else if (currentId === "2") nextId = "3";
    else if (currentId === "3") nextId = "1";

    // Registrar en el historial
    const newHistoryEntry = {
      id: Date.now().toString(),
      floorId: currentId,
      completedAt: new Date().toISOString(),
      completedBy: completedByUsername || "Sistema"
    };
    
    data.history.unshift(newHistoryEntry); // Añadir al inicio del historial
    
    // Limitar historial a los últimos 20 registros
    if (data.history.length > 20) {
      data.history = data.history.slice(0, 20);
    }

    data.state.currentTurnFloorId = nextId;
    
    // Avanzar el mes del turno (incrementar 1 mes)
    if (data.state.currentMonth) {
      const currentMonthDate = new Date(data.state.currentMonth);
      currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
      data.state.currentMonth = currentMonthDate.toISOString().slice(0, 10);
    }

    data.state.lastRotationDate = new Date().toISOString();

    writeDB(data);
    return { state: data.state, history: data.history };
  },

  // Historial
  getHistory: () => {
    return readDB().history;
  },

  // Tokens de Invitación (Registro de un solo uso)
  getInviteTokens: () => {
    return readDB().inviteTokens;
  },
  createInviteToken: (floorId, token) => {
    const data = readDB();
    
    // Invalidar tokens previos para esta planta
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
  getInviteToken: (token) => {
    return readDB().inviteTokens.find(t => t.token === token);
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

module.exports = db;
