FROM node:20

# Instalar Chromium y las dependencias de fuentes/gráficos indispensables para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copiar archivos de definición de paquetes e instalar con pnpm
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile

# Copiar el código fuente completo del proyecto
COPY . .

# Hugging Face Spaces ejecuta el contenedor con el usuario con UID 1000.
# Nos aseguramos de crear los directorios necesarios y darles la pertenencia correcta.
RUN mkdir -p db certs logs .wwebjs_auth .wwebjs_cache && \
    chown -R 1000:1000 /usr/src/app

USER 1000

# Variables de entorno esenciales para Puppeteer y producción
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Hugging Face Spaces expone por defecto el puerto 7860 de forma dinámica
EXPOSE 7860

CMD ["node", "server.js"]
