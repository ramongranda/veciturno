# 🚀 Guía de Despliegue en Oracle Cloud Infrastructure (OCI)

Esta guía detalla paso a paso cómo publicar **VeciTurno** de forma gratuita y segura en **Oracle Cloud (región `eu-madrid-1` - España)** o cualquier otra región, aprovechando los recursos de la capa gratuita (**Always Free Tier**).

---

## 📋 Arquitectura de Despliegue Recomendada

* **Servidor**: Instancia VM Always Free (Ubuntu 22.04 LTS o superior, compatible con AMD Micro y Ampere A1).
* **Gestor de Procesos**: **PM2** (con reinicio automático, gestión de logs y limitación de memoria RAM).
* **Red y Seguridad**:
  * Cortafuegos local configurado con `iptables` persistente (abriendo puertos `80`, `443` y `3000`).
  * **Nginx** como Proxy Inverso, controlando la red externa en puerto `80` y `443`.
  * **Certbot (Let's Encrypt)** para obtener un certificado SSL oficial y gratuito con renovación automática.

---

## 🛠️ Paso 1: Creación de la Instancia VM en Oracle Cloud Console

1. Inicia sesión en tu cuenta de [Oracle Cloud Infrastructure (OCI)](https://cloud.oracle.com/).
2. En el menú de navegación principal, ve a **Compute** ➔ **Instances** y haz clic en **Create Instance**.
3. **Nombre**: Asigna un nombre descriptivo (ej. `veciturno-prod`).
4. **Placement (Región)**: Asegúrate de estar en tu compartimento principal (ej. Madrid).
5. **Image and Shape**:
   * **Image**: Haz clic en *Change Image* y selecciona **Ubuntu** (versión recomendada: `Ubuntu 22.04 LTS Minimal` o `Ubuntu 22.04 LTS Standard`).
   * **Shape**: 
     * Opción AMD: `VM.Standard.E2.1.Micro` (1 OCPU, 1 GB de RAM) -> **Always Free**.
     * Opción Ampere ARM (Recomendada si hay stock): `VM.Standard.A1.Flex` (1-4 OCPUs, 6-24 GB de RAM) -> **Always Free**.
6. **Networking**: 
   * Crea una nueva Virtual Cloud Network (VCN) y una Subred Pública de forma automática.
   * Selecciona **Assign a public IPv4 address** para que tenga una IP accesible desde internet.
7. **SSH Keys**: 
   * Haz clic en **Save private key** y guárdala localmente en tu ordenador (ej. `clave-oci.key`). La necesitarás para conectarte.
8. Haz clic en **Create** en la parte inferior. Tu máquina virtual estará lista en 1-2 minutos.

---

## 🔒 Paso 2: Apertura de Puertos (Reglas de Entrada) en OCI Console

Oracle Cloud bloquea por defecto todo el tráfico de internet a nivel de red virtual. Para poder acceder a tu aplicación, debes abrir los puertos correspondientes en el panel de OCI:

1. En la página de detalles de tu instancia creada, busca la sección **Instance details** y haz clic en la subred pública que se muestra en **Subnet**.
2. Haz clic en la **Default Security List** de la VCN.
3. Haz clic en **Add Ingress Rules** e introduce las siguientes 3 reglas de entrada:

| Tipo de Tráfico | Source CIDR | IP Protocol | Source Port | Destination Port Range | Descripción |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pruebas (App)** | `0.0.0.0/0` | `TCP` | `All` | `3000` | Acceso directo a VeciTurno (Opcional) |
| **HTTP (Nginx)** | `0.0.0.0/0` | `TCP` | `All` | `80` | Servidor Nginx (Entrada Web estándar) |
| **HTTPS (SSL)** | `0.0.0.0/0` | `TCP` | `All` | `443` | Tráfico seguro encriptado Let's Encrypt |

4. Haz clic en **Add Ingress Rules** para guardar los cambios.

---

## 🖥️ Paso 3: Conexión SSH y Ejecución del Instalador Automático

1. Abre una terminal de comandos en tu ordenador (PowerShell o Git Bash en Windows, Terminal en Linux/Mac).
2. Asegura los permisos de tu clave privada descargada (requerido en Linux/Mac):
   ```bash
   chmod 400 /ruta/a/tu/clave-oci.key
   ```
3. Conéctate vía SSH usando la IP pública de tu servidor (se muestra en el panel de OCI):
   ```bash
   ssh -i /ruta/a/tu/clave-oci.key ubuntu@IP_PUBLICA_DE_TU_SERVIDOR
   ```
4. Una vez dentro de la máquina virtual de Ubuntu, clona tu repositorio de VeciTurno o sube tus archivos de distribución.
   ```bash
   git clone <url_de_tu_repositorio_veciturno> veciturno
   cd veciturno
   ```
5. Dale permisos de ejecución al script instalador de OCI que hemos creado para ti:
   ```bash
   chmod +x scripts/deploy-oci.sh
   ```
6. Ejecuta el instalador con privilegios de superusuario (`sudo`):
   ```bash
   sudo ./scripts/deploy-oci.sh
   ```
   *Este script instalará automáticamente Node.js 20 LTS, pnpm, PM2, configurará el cortafuegos `iptables` local de la máquina y descargará las dependencias de sistema esenciales para que Puppeteer (WhatsApp Web) funcione sin problemas en modo headless.*

---

## 📝 Paso 4: Configuración del Entorno en Producción

1. Copia la plantilla del archivo de variables de entorno:
   ```bash
   cp .env.example .env
   ```
2. Genera una clave secreta segura de 32 bytes para la encriptación de sesiones JWT y 2FA:
   ```bash
   openssl rand -base64 32
   ```
   *(Copia la cadena resultante en la consola).*
3. Abre el editor nano para configurar tu archivo `.env`:
   ```bash
   nano .env
   ```
   * Modifica `JWT_SECRET` pegando el valor seguro generado en el paso anterior.
   * Cambia `COMMUNITY_NAME` al nombre oficial de tu vecindario.
   * Modifica `START_MONTH` y `START_FLOOR_ID` según la configuración deseada.
   * Guarda los cambios presionando `Ctrl + O`, `Enter` y sal con `Ctrl + X`.
4. Instala las dependencias del proyecto optimizadas para producción:
   ```bash
   pnpm install --prod
   ```

---

## 🦄 Paso 5: Despliegue Permanente con PM2

Para evitar que tu aplicación se apague cuando cierres tu terminal SSH, usaremos PM2 como gestor de procesos:

1. Arranca VeciTurno usando la configuración declarativa `ecosystem.config.js`:
   ```bash
   pm2 start ecosystem.config.js
   ```
2. Verifica que el proceso esté corriendo correctamente y observa los logs:
   ```bash
   pm2 status
   pm2 logs veciturno
   ```
3. Configura PM2 para que se ejecute en el arranque del sistema operativo. Esto garantiza que si la máquina virtual de Oracle se reinicia por mantenimiento, tu app vuelva a levantarse sola:
   ```bash
   pm2 startup
   ```
   *(Copia y pega en la consola el comando que genera la salida de PM2 en pantalla).*
4. Guarda el estado actual del servicio:
   ```bash
   pm2 save
   ```

*(¡En este punto, si entras en `http://IP_PUBLICA_DE_TU_SERVIDOR:3000` en tu navegador, tu aplicación ya estará totalmente funcional!).*

---

## 🛡️ Paso 6: Configurar Proxy Inverso con Nginx y SSL Oficial (HTTPS)

Para no exponer el puerto `3000` al usuario y tener un dominio web limpio (ej. `veciturno.com`) con cifrado SSL de nivel bancario, utilizaremos Nginx.

1. Instala el servidor Nginx y Certbot en el sistema:
   ```bash
   sudo apt install nginx certbot python3-certbot-nginx -y
   ```
2. Crea el archivo de configuración para tu sitio web:
   ```bash
   sudo nano /etc/nginx/sites-available/veciturno
   ```
3. Pega la siguiente plantilla de configuración (sustituye `tu-dominio.com` por el tuyo):
   ```nginx
   server {
       listen 80;
       server_name tu-dominio.com www.tu-dominio.com;

       # Redirección del WebSocket de WhatsApp Web.js si es necesario y endpoints REST
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
4. Activa el sitio creando el enlace simbólico y desactiva la plantilla por defecto de Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/veciturno /etc/nginx/sites-enabled/
   sudo rm /etc/nginx/sites-enabled/default
   ```
5. Verifica la sintaxis de Nginx y reinicia el servicio:
   ```bash
   sudo nginx -t
   sudo systemctl restart nginx
   ```
6. **Obtener el certificado SSL HTTPS Gratuito**:
   Asegúrate de que las DNS de tu dominio ya apunten a la IP pública de tu servidor OCI y ejecuta:
   ```bash
   sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
   ```
   *Sigue las sencillas instrucciones interactivas en consola (ingresa tu email y acepta redireccionar todo el tráfico HTTP a HTTPS de manera automática).*

---

## 🤖 Despliegue Continuo (CD) Automático con GitHub Actions

Hemos integrado soporte completo para despliegues continuos automatizados. Cada vez que hagas un tag de versión (`v*`) y lo subas a tu repositorio en GitHub, la acción de GitHub Actions hará lo siguiente de forma automática:
1. **Compilar y verificar** la aplicación.
2. **Generar un ZIP limpio** listo para producción y publicarlo como una **Release** oficial en GitHub.
3. **Conectarse vía SSH** de manera segura a tu instancia OCI, descargar la versión exacta y reiniciar PM2 con **cero tiempo de inactividad**.

### ⚙️ Configuración de Secretos en GitHub

Para que la automatización pueda conectarse a tu máquina virtual de Oracle Cloud, debes configurar 3 secretos en tu repositorio de GitHub:

1. Ve a tu repositorio en GitHub.
2. Navega a **Settings** ➔ **Secrets and variables** ➔ **Actions**.
3. Haz clic en **New repository secret** y añade las siguientes variables:

* **`SSH_HOST`**: La IP pública de tu servidor de Oracle Cloud (ej. `140.238.X.X`).
* **`SSH_USERNAME`**: El usuario del sistema operativo de tu instancia. Por defecto en OCI Ubuntu es `ubuntu`.
* **`SSH_PRIVATE_KEY`**: Abre la clave SSH privada con la que te conectas (ej. el archivo `clave-oci.key` que descargaste en el paso 1) con un editor de texto, copia **todo su contenido** (incluyendo las líneas de `-----BEGIN OPENSSH PRIVATE KEY-----` y `-----END OPENSSH PRIVATE KEY-----`) y pégalo aquí.

### 🚀 Cómo Publicar y Desplegar una Nueva Versión

Una vez configurados los secretos, desplegar una nueva versión es extremadamente sencillo. Desde tu terminal local, simplemente ejecuta:

```bash
# 1. Asegúrate de añadir y hacer commit de tus cambios
git add .
git commit -m "feat: descripción de mis mejoras"

# 2. Crea una etiqueta de versión (ej. v1.0.0)
git tag -a v1.0.0 -m "Lanzamiento de versión 1.0.0"

# 3. Sube tus commits y el tag a GitHub
git push origin master --tags
```

¡Y listo! GitHub Actions se encargará de compilar, empaquetar, crear la release y auto-desplegar tu aplicación en la nube de Madrid automáticamente en segundos. Puedes monitorizar el proceso en la pestaña **Actions** de tu repositorio.

---

## 🎉 ¡Listo! Despliegue Finalizado

¡Enhorabuena! Has completado el despliegue de **VeciTurno** en la nube de Oracle Cloud (eu-madrid-1). La aplicación ya está disponible públicamente de forma segura en `https://tu-dominio.com`, equipada con:
- Despliegue continuo en un solo paso mediante etiquetas de Git.
- Inicio automático en caso de caídas o reinicios físicos del servidor.
- Cifrado SSL automático y gratuito con Let's Encrypt.
- Un bot de WhatsApp integrado de alto rendimiento corriendo aislado y de forma óptima.
