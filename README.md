# 🏡 VeciTurno - Comunidad de Vecinos

**VeciTurno** es una aplicación web ligera, moderna y premium diseñada específicamente para gestionar turnos rotativos en comunidades de vecinos (ej. turnos de limpieza de escalera o tareas comunes). 

Esta aplicación está completamente optimizada para ejecutarse en el plan gratuito de **Oracle Cloud Infrastructure (OCI Free Tier)**, consumiendo el mínimo de recursos y sin requerir servicios externos de pago.

---

## ✨ Características Principales

- **Dashboard Público e Interactivo**: Los vecinos pueden visualizar en tiempo real quién tiene el turno activo, quién fue el anterior y quién será el siguiente. No requiere inicio de sesión para visualización básica.
- **Aviso Rotativo por WhatsApp**: Un botón integrado que genera un enlace de WhatsApp (`wa.me`) con un mensaje cortés y pre-redactado para notificar al vecino de turno con un solo clic, sin coste de APIs externas.
- **Autenticación Segura en 2 Pasos**: Los vecinos acceden con usuario y contraseña, seguido por la validación de un **código de doble factor (2FA/TOTP)** que puede ser escaneado con Google Authenticator, Authy o Microsoft Authenticator.
- **Invitaciones de Un Solo Uso**: El registro inicial se realiza a través de un enlace de un solo uso generado en la consola del administrador. Al registrarse, se fuerza la configuración del 2FA.
- **Ligero y Portable**: Base de datos integrada en JSON (actúa como ORM local portable, ideal para VPS pequeños) sin dependencias nativas complejas.

---

## 🛠️ Tecnologías y Dependencias

- **Backend**: Node.js & Express
- **Seguridad**: JWT (JSON Web Tokens), `bcryptjs` (hashing seguro puro JS, ideal para evitar fallos de compilación en Windows/Linux)
- **Doble Factor (2FA)**: `speakeasy` (algoritmo TOTP de nivel industrial) y `qrcode` (generador de códigos QR)
- **Diseño**: HTML5 & **Vanilla CSS** con estética premium de *Glassmorphic* (tema oscuro, desenfoques transTranslúcidos y micro-interacciones fluidas).

---

## 🚀 Instalación y Uso en Local

### Requisitos Previos

- Tener instalado **Node.js** (versión 18 o superior).
- Recomendado usar **pnpm** (o npm / yarn).

### Pasos de Instalación

1. Instalar todas las dependencias del proyecto:
   ```bash
   pnpm install
   ```
2. Ejecutar la aplicación en modo desarrollo:
   ```bash
   pnpm dev
   ```
3. Abrir en tu navegador preferido:
   `http://localhost:3000`

---

## 📁 Estructura del Proyecto

```
veciturno/
├── db/
│   └── database.json          # Archivo de base de datos local JSON (autocreado)
├── public/
│   ├── index.html             # Interfaz web única (SPA)
│   ├── app.js                 # Lógica interactiva del frontend
│   └── styles.css             # Estilo CSS premium y dinámico
├── src/
│   ├── db.js                  # Manejador de Base de Datos estructurada
│   ├── auth.js                # Helpers para JWT, contraseñas y 2FA
│   └── routes.js              # Endpoints de API
├── .env                       # Variables de entorno (JWT_SECRET, PORT)
├── .gitignore                 # Exclusiones de Git
├── server.js                  # Servidor Express principal
└── package.json               # Dependencias del proyecto
```

---

## 💻 Despliegue en Oracle Cloud (Gratuito)

La máquina virtual Always Free de **Oracle Linux** o **Ubuntu** en Oracle Cloud es perfecta para VeciTurno. Sigue estos pasos para desplegarla en tu VPS:

### 1. Preparar la Máquina en Oracle Cloud
1. Conéctate a tu VPS OCI mediante SSH.
2. Actualiza tu sistema e instala Node.js y Git:
   - **Ubuntu**:
     ```bash
     sudo apt update && sudo apt install -y nodejs npm git
     ```
   - **Oracle Linux (RHEL)**:
     ```bash
     sudo dnf install -y nodejs npm git
     ```
3. Instala `pnpm` globalmente para optimizar almacenamiento:
   ```bash
   sudo npm install -g pnpm
   ```

### 2. Clonar y Configurar VeciTurno
1. Clona tu repositorio de GitHub (ver siguiente sección):
   ```bash
   git clone <tu-url-del-repositorio>
   cd veciturno
   ```
2. Instala dependencias:
   ```bash
   pnpm install
   ```
3. Crea un archivo `.env` de producción:
   ```bash
   echo "PORT=3000" > .env
   echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
   ```

### 3. Abrir el Puerto en OCI (¡Muy Importante!)
Para acceder a la web, debes abrir el puerto `3000` tanto en el cortafuegos interno de la máquina virtual como en el panel de OCI:

1. **Cortafuegos Interno del VPS**:
   - **Ubuntu**:
     ```bash
     sudo ufw allow 3000/tcp
     ```
   - **Oracle Linux**:
     ```bash
     sudo firewall-cmd --permanent --add-port=3000/tcp
     sudo firewall-cmd --reload
     ```
2. **Consola Web de Oracle Cloud (Security Lists)**:
   - Ve a tu instancia OCI -> haz clic en la **VCN (Red Virtual)** -> **Security Lists** -> **Default Security List**.
   - Haz clic en **Add Ingress Rules**.
   - Configura:
     - **Source CIDR**: `0.0.0.0/0`
     - **IP Protocol**: `TCP`
     - **Destination Port Range**: `3000`
     - Haz clic en **Add Ingress Rule**.

### 4. Mantener la Aplicación Activa (PM2)
Instala `pm2` para garantizar que la app siga corriendo de fondo incluso tras reiniciar la consola:
```bash
sudo pnpm add -g pm2
pm2 start server.js --name veciturno
pm2 save
pm2 startup
```

---

## 🐙 Subir a un Repositorio de GitHub

Este proyecto ya está inicializado localmente como un repositorio Git. Para subirlo a tu cuenta de GitHub:

1. Crea un repositorio vacío en la web de GitHub llamado `veciturno` (sin inicializar README o gitignore).
2. Vincula tu repositorio local con el de GitHub:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/veciturno.git
   ```
3. Haz tu primer commit y súbelo:
   ```bash
   git add .
   git commit -m "primer commit: estructura premium de VeciTurno"
   git branch -M main
   git push -u origin main
   ```
