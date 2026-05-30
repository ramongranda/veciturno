#!/bin/bash
# ==============================================================================
# 🏡 VeciTurno - Oracle Cloud Infrastructure (OCI) Deployment Automation Script
# ==============================================================================
# Región recomendada: eu-madrid-1 (Madrid, España)
# Diseñado para: Ubuntu 22.04 LTS o superior (Compatible con AMD y Ampere A1 ARM64)
# ==============================================================================

# Colores para salida en consola
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # Sin color
BOLD='\033[1m'

echo -e "${GREEN}${BOLD}🏡 VeciTurno - OCI Auto-Deployment Script${NC}"
echo -e "Región OCI: Madrid (eu-madrid-1) y Global"
echo "------------------------------------------------------------------"

# 1. Verificar permisos de root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Este script debe ejecutarse con privilegios de administrador (sudo).${NC}"
  echo "Uso: sudo ./deploy-oci.sh"
  exit 1
fi

# 2. Actualizar repositorios del sistema
echo -e "\n${GREEN}[1/6] Actualizando repositorios del sistema...${NC}"
apt-get update -y

# 3. Instalar dependencias para compilar y ejecutar Chromium/Puppeteer en Headless
echo -e "\n${GREEN}[2/6] Instalando librerías requeridas para Puppeteer / WhatsApp Web...${NC}"
# Estas librerías son indispensables para que Puppeteer lance el navegador en segundo plano en Ubuntu Server
apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  lsb-release \
  wget \
  xdg-utils \
  git \
  curl \
  zip \
  unzip \
  iptables-persistent

# 4. Instalar Node.js v20 LTS y herramientas globales
echo -e "\n${GREEN}[3/6] Instalando Node.js v20 LTS, pnpm y PM2...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Instalar pnpm y pm2 globalmente
npm install -g pnpm pm2

# Verificar versiones instaladas
echo -e "  ✅ Node.js versión: $(node -v)"
echo -e "  ✅ npm versión: $(npm -v)"
echo -e "  ✅ pnpm versión: $(pnpm -v)"
echo -e "  ✅ PM2 versión: $(pm2 -v)"

# 5. Configuración del Cortafuegos local (Indispensable en OCI Ubuntu)
# Las instancias de Oracle Cloud Ubuntu vienen pre-configuradas para rechazar todo tráfico entrante
# excepto SSH en el puerto 22. Necesitamos abrir los puertos necesarios a nivel de sistema operativo.
echo -e "\n${GREEN}[4/6] Configurando reglas del cortafuegos de Linux (iptables) para OCI...${NC}"

# Verificar si se puede insertar en iptables
iptables -I INPUT 6 -p tcp --dport 3000 -j ACCEPT -m comment --comment "VeciTurno Port" 2>/dev/null
iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT -m comment --comment "HTTP Reverse Proxy" 2>/dev/null
iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT -m comment --comment "HTTPS Reverse Proxy" 2>/dev/null

# Guardar las reglas del cortafuegos de forma persistente para que sobrevivan a reinicios
if command -v netfilter-persistent &> /dev/null; then
  netfilter-persistent save
  echo "  ✅ Reglas de iptables guardadas de forma persistente."
else
  echo "  ⚠️ netfilter-persistent no encontrado. Asegurando persistencia manual..."
  iptables-save > /etc/iptables/rules.v4
fi

# 6. Preparar directorios de base de datos local
echo -e "\n${GREEN}[5/6] Preparando directorios del proyecto...${NC}"
mkdir -p db
chmod -R 775 db

# 7. Configuración final
echo -e "\n${GREEN}[6/6] ¡Configuración del sistema completada con éxito! 🎉${NC}"
echo "------------------------------------------------------------------"
echo -e "${BOLD}Siguientes pasos en tu instancia OCI:${NC}"
echo "1. Configura tu archivo .env copiándolo desde la plantilla:"
echo "   cp .env.example .env"
echo "2. Edita las variables de entorno (PORT, JWT_SECRET, etc.):"
echo "   nano .env"
echo "3. Genera un token JWT_SECRET de producción seguro de 32 caracteres:"
echo "   openssl rand -base64 32"
echo "4. Instala las dependencias del proyecto con pnpm:"
echo "   pnpm install --prod"
echo "5. Levanta el servicio de forma permanente con PM2:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save && pm2 startup"
echo "------------------------------------------------------------------"
echo -e "${GREEN}VeciTurno está casi listo para desplegar en Oracle Cloud Madrid.${NC}"
