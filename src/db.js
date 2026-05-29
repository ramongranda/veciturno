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
      isAdmin: true // La primera planta actúa como administrador por defecto
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
      isAdmin: false
    }
  ],
  inviteTokens: [
    {
      token: "registro-inicial-planta1",
      floorId: "1",
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

// Cargar base de datos
function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      writeDB(initialData);
      return initialData;
    }
    const rawData = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(rawData);
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
