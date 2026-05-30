# 🏡 VeciTurno - Comunidad de Vecinos

**VeciTurno** es una aplicación web ligera, moderna y premium diseñada específicamente para gestionar turnos rotativos en comunidades de vecinos (ej. turnos de limpieza de escalera o tareas comunes). 

Esta aplicación está completamente optimizada para ejecutarse en el plan gratuito de **Oracle Cloud Infrastructure (OCI Free Tier)**, consumiendo el mínimo de recursos y sin requerir servicios externos de pago.

---

## ✨ Características Principales

- **Dashboard Público e Interactivo (Premium CSS/Glassmorphism)**: 
  * Una interfaz táctil, animada y fluida con sombras de neón en 3D.
  * **Halo Orbit Activo**: Un aro giratorio de neón verde esmeralda rodea al avatar del vecino que tiene el turno activo actual.
  * Colapso adaptativo inteligente que garantiza que el título y los avatares nunca se superpongan en pantallas móviles.
- **Gráficas de Tesorería Interactivas (Neón HD)**:
  * Gráfico de evolución de gastos de los últimos 12 meses con trazos de neón flotantes. En el modo "Todos", divide los gastos en series dinámicas independientes (Luz, Seguro, Otros) con su leyenda interactiva correspondiente.
  * Donut charts interactivos encogidos al tamaño ideal de tarjeta KPI para ver ingresos, egresos y balances a simple vista.
- **Firma Electrónica y Código Seguro de Verificación (CSV) para PDFs**:
  * Los certificados de abono descargables en PDF incorporan una firma electrónica oficial en el pie de página.
  * Cada documento emitido genera un hash criptográfico SHA-256 único formateado como `CSV-XXXX-XXXX-XXXX-XXXX` y guardado en la base de datos.
  * **Verificador Público**: Desde el sidebar del dashboard, cualquier propietario o entidad puede validar el código CSV para certificar en tiempo real que el documento PDF es auténtico e inalterado.
- **Aviso Rotativo por WhatsApp Web.js (Autohospedado)**:
  * Pasarela automatizada y autohospedada en Node.js que arranca un Puppeteer en segundo plano para el envío de alertas y notificaciones del tablón y turnos gratis.
- **Autenticación Segura en 2 Pasos (2FA/TOTP)**:
  * Los vecinos acceden de manera segura y configuran obligatoriamente el doble factor de autenticación TOTP con su app preferida (Google Authenticator, Authy, etc.).
- **Invitaciones de Un Solo Uso**:
  * Enlaces seguros de registro inicial únicos generados por el administrador.

---

## 🛠️ Tecnologías y Seguridad

- **Backend**: Node.js & Express
- **Seguridad y Cifrado**:
  * **HTTPS Local Automático**: Genera certificados SSL auto-firmados en JavaScript puro al arrancar, protegiendo tus credenciales y cookies locales en `https://localhost:3000`.
  * **Helmet**: Blindaje estricto de cabeceras HTTP de seguridad global y políticas CSP configuradas a medida.
  * **Express Rate Limit**: Mitigación integrada contra ataques DoS y fuerza bruta en autenticación y validación CSV.
  * **Cifrado**: JWT (JSON Web Tokens), `bcryptjs` (hashing seguro puro JS).
- **Diseño**: HTML5 & **Vanilla CSS** con estética *Glassmorphic*, animaciones `@keyframes`, sombras radiales y transiciones táctiles elásticas (`transform: scale(0.96) !important` en clics).

---

## 🚀 Instalación y Uso en Local (HTTPS Habilitado)

### Requisitos Previos
- Tener instalado **Node.js** (versión 20 o superior).
- Tener instalado **pnpm** (o npm / yarn).

### Pasos de Instalación

1. **Instalar dependencias**:
   ```bash
   pnpm install
   ```
2. **Configurar el entorno**:
   Copia el archivo `.env.example` como `.env` y edita los valores si es necesario:
   ```bash
   cp .env.example .env
   ```
3. **Arrancar en modo desarrollo**:
   ```bash
   pnpm dev
   ```
   * **Arranque Seguro automático**: El sistema detectará que estás en desarrollo y que no tienes certificados SSL locales. **Los generará automáticamente** en el directorio `certs/` (excluido de Git) y arrancará en **HTTPS** de forma inmediata.
4. **Abrir en tu navegador**:
   Entra en: **[https://localhost:3000](https://localhost:3000)**
   *(Acepta la advertencia inicial de certificado auto-firmado de desarrollo en tu navegador para continuar).*

---

## 📦 Distribución y Despliegue Automatizado (GitHub & OCI)

Este proyecto está completamente preparado para ciclos de integración y distribución continua:

### 1. Generación de Release Automático en GitHub (Actions CI/CD)
Hemos incluido un flujo de trabajo de GitHub Actions en `.github/workflows/release.yml`. Cada vez que generes y subas una versión con una etiqueta (por ejemplo, `v1.2.0`), GitHub se encargará automáticamente de:
1. Compilar el código en un contenedor Ubuntu limpio.
2. Limpiar y excluir todos los archivos sensibles (`.env`, certificados `/certs`, cachés de WhatsApp `.wwebjs_*`, bases de datos locales `db/database.json`).
3. Empaquetar todo en un archivo zip optimizado de producción: `veciturno-release.zip`.
4. Crear una **Release** en tu repositorio de GitHub y subir el ZIP como un asset oficial listo para descargar e instalar.

Para activar este flujo:
```bash
git add .
git commit -m "feat: implementar HTTPS local, CSP Helmet, CSV para PDF y flujos de release"
git tag -a v1.0.0 -m "Versión Inicial Estable de Producción"
git push origin main --tags
```

### 2. Despliegue en Servidor en la Nube (Oracle Cloud / VPS)

Para facilitar el despliegue automático y óptimo en **Oracle Cloud (región eu-madrid-1)**, hemos preparado una guía paso a paso y herramientas dedicadas:

> [!TIP]
> 📖 **Guía Completa de Producción**: Consulta nuestra guía interactiva paso a paso **[DEPLOY_OCI.md](file:///c:/Users/ramon/workspaces/veciturno/DEPLOY_OCI.md)** para configurar tu cuenta OCI, abrir los puertos de red en la consola web, configurar Nginx como proxy inverso y obtener certificados SSL gratuitos con Let's Encrypt.

En tu servidor VPS con Ubuntu o Oracle Linux:

1. **Descargar el release oficial** o clonar el repositorio:
   ```bash
   git clone <tu-repositorio-url>
   cd veciturno
   ```
2. **Ejecutar el script automatizador para OCI**:
   ```bash
   chmod +x scripts/deploy-oci.sh
   sudo ./scripts/deploy-oci.sh
   ```
   *(Este script instala Node.js 20, pnpm, pm2, abre los puertos en el cortafuegos de Linux y descarga todas las librerías necesarias para Puppeteer).*
3. **Configurar entorno**:
   ```bash
   cp .env.example .env
   # Genera una clave segura para producción
   openssl rand -base64 32
   nano .env
   ```
4. **Instalar dependencias de producción**:
   ```bash
   pnpm install --prod
   ```
5. **Mantener activo y arrancar de forma permanente con PM2**:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

---

## 📁 Estructura del Proyecto

```
veciturno/
├── .github/
│   └── workflows/
│       └── release.yml        # CI/CD de empaquetado de producción en GitHub
├── certs/                     # Certificados locales SSL auto-firmados (autocreados en dev)
├── db/
│   └── database.json          # Base de datos integrada JSON local (autocreada en inicio)
├── public/
│   ├── index.html             # Interfaz web de panel único (SPA)
│   ├── js/
│   │   └── app.js             # Lógica interactiva del frontend, visualizaciones y CSV
│   └── css/
│       └── styles.css         # Estilo de diseño premium y neón Glassmorphic
├── scripts/
│   ├── generate-certs.js      # Generador portable JS de certificados auto-firmados
│   └── deploy-oci.sh          # Script de automatización de dependencias y cortafuegos en OCI
├── src/
│   ├── config/
│   │   └── env.js             # Validador y cargador de variables de entorno
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── neighbor.controller.js # Generación de PDFs firmados por CSV
│   │   └── turn.controller.js     # Rutas de verificación de CSV
│   ├── middlewares/
│   │   └── auth.middleware.js # Autenticación de API y control administrativo
│   └── services/
│       ├── db.service.js      # Conector de base de datos JSON local
│       └── whatsapp.service.js# Pasarela WhatsApp autohospedada
├── .env.example               # Plantilla modelo documentada de configuración
├── ecosystem.config.js        # Configuración de procesos PM2 para producción
├── server.js                  # Servidor Express, HTTPS nativo y middlewares de seguridad
└── package.json               # Dependencias de producción y scripts de ejecución
```

