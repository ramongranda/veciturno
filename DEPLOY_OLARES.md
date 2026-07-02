# 🏠 Guía de Despliegue en Olares (Self-Hosted, Fijo y Gratis)

Desplegar **VeciTurno** en tu **Olares** es la mejor opción para dejarlo **fijo y gratis**:
tu propio hardware, 24/7, con **almacenamiento persistente real**. La sesión de
WhatsApp (`.wwebjs_auth`) y la base de datos se guardan en un volumen que
**sobrevive reinicios y actualizaciones**, así que la vinculación del bot y las
sesiones de administrador se mantienen fijas.

Olares es Kubernetes por debajo, por lo que la app se despliega como un
**Olares Application Chart** (carpeta [`olares/`](olares/) de este repo).

---

## 📋 Arquitectura del despliegue

| Elemento | Valor |
| :--- | :--- |
| **Imagen** | Contenedor Docker construido con el [`Dockerfile`](Dockerfile) del repo (Node 20 + Chromium + Puppeteer). |
| **Puerto interno** | `7860` (HTTP; Olares hace la terminación TLS en su gateway). |
| **Persistencia** | `hostPath` sobre `appData` → montado en `/usr/src/app/db` → contiene `.wwebjs_auth`, `database.json` y `documents`. |
| **Base de datos** | JSON local sobre el volumen persistente (sin dependencias externas). Opcional: Postgres citus gestionado de Olares. |
| **WhatsApp** | Bot autohospedado **activado** (NO se define `DISABLE_WHATSAPP`). |

> ⚠️ Si desactivas el bot con `DISABLE_WHATSAPP=true`, no habrá WhatsApp. Aquí lo dejamos encendido a propósito.

---

## 🐳 Paso 1: Construir y publicar la imagen Docker

Olares arranca las apps desde una **imagen de contenedor** (no desde el código
fuente), así que primero hay que construir la imagen —con el fix de sesión ya
incluido— y subirla a un registro que tu Olares pueda descargar (Docker Hub o GHCR).

1. Averigua la arquitectura de tu nodo Olares (`amd64` para mini-PC x86, `arm64` para SBC tipo Raspberry/Rockchip):
   ```bash
   uname -m   # x86_64 → amd64 ; aarch64 → arm64
   ```
2. Inicia sesión en tu registro:
   ```bash
   docker login            # Docker Hub
   # o: echo $GHCR_TOKEN | docker login ghcr.io -u TU_USUARIO --password-stdin
   ```
3. Construye y sube la imagen **multi-arquitectura** (recomendado, funciona en cualquier nodo):
   ```bash
   docker buildx build \
     --platform linux/amd64,linux/arm64 \
     -t docker.io/TU_USUARIO/veciturno:1.0.0 \
     --push .
   ```
   *(Si solo tienes un nodo amd64, puedes usar `docker build -t docker.io/TU_USUARIO/veciturno:1.0.0 . && docker push docker.io/TU_USUARIO/veciturno:1.0.0`).*

4. Apunta la imagen en [`olares/values.yaml`](olares/values.yaml):
   ```yaml
   image:
     repository: docker.io/TU_USUARIO/veciturno
     tag: "1.0.0"
   ```

---

## ⚙️ Paso 2: Instalar la app en Olares (vía Studio)

La forma más sencilla en un Olares doméstico es el **Studio** (Devbox):

1. Instala **Studio** desde el **Olares Market** si no lo tienes.
2. En Studio ➔ **Create a new application**. Introduce:
   * **Name**: `veciturno`
   * **Type**: `app`
   * **Image**: `docker.io/TU_USUARIO/veciturno:1.0.0`
   * **Port**: `7860`
3. Studio genera un esqueleto de chart. Sustituye su contenido por los archivos de la carpeta [`olares/`](olares/) de este repo:
   * [`OlaresManifest.yaml`](olares/OlaresManifest.yaml) → permisos (`appData`, `appCache`), entrada web pública en el puerto 7860 y las variables de entorno.
   * [`templates/deployment.yaml`](olares/templates/deployment.yaml) → montaje del volumen persistente en `/usr/src/app/db` + Chromium.
   * [`templates/service.yaml`](olares/templates/service.yaml) → servicio `veciturno-svc:7860`.
   * [`values.yaml`](olares/values.yaml) → tu imagen.
4. Al instalar, Olares te pedirá las variables declaradas en `envs`. Rellénalas:

| Variable | Valor | Nota |
| :--- | :--- | :--- |
| **`JWT_SECRET`** | *(cadena aleatoria larga)* | **Fíjala una vez.** Genérala con `openssl rand -base64 32`. Al ser fija, se acaban los 403 "Sesión expirada". |
| **`COMMUNITY_NAME`** | `"San Juan Bautista de la Salle N 37"` | Nombre de tu comunidad. |
| **`BOOTSTRAP_TOKEN`** | `registro-inicial-planta3` | Registro del primer admin. |
| **`START_MONTH`** | `2026-06-01` | Inicio de la rotación. |
| **`START_FLOOR_ID`** | `1` | Vivienda que arranca. |
| **`APP_BASE_URL`** | *(URL de la entrada en Olares)* | Rellénala tras la primera instalación con la URL pública que te asigne Olares. |

5. Pulsa **Install** y espera a que el estado pase de **Processing** a **Running**.

> **Alternativa CLI/Market-dev:** si prefieres no usar Studio, puedes empaquetar la carpeta `olares/` como chart y subirla a tu Market privado / instalarla con `olares-cli`. La estructura del chart ya es válida.

---

## 💬 Paso 3: Vincular el bot de WhatsApp (una sola vez)

1. Abre VeciTurno desde la URL de la entrada que te da Olares.
2. Regístrate con el enlace de invitación inicial: `…/invite?token=registro-inicial-planta3`.
3. Panel de Administración ➔ **WhatsApp Servidor** ➔ escanea el **código QR** con tu móvil.
4. Como el volumen es persistente y el fix conserva la sesión en cortes de red,
   **solo tendrás que escanear el QR esta vez**. La vinculación queda fija entre reinicios.

---

## 🔒 Por qué ahora sí queda fijo

- **Almacenamiento persistente**: `appData` (`hostPath`) sobrevive reinicios y actualizaciones de la app → `.wwebjs_auth` no se pierde.
- **Fix de código** ([`whatsapp.service.js`](src/services/whatsapp.service.js)): las desconexiones transitorias (red/navegación) ya **no borran** la sesión; solo se borra si desvinculas el dispositivo desde el móvil (`LOGOUT`). Reconexión automática sin QR.
- **`JWT_SECRET` fijo**: los tokens de sesión sobreviven reinicios → adiós al 403 "Sesión expirada o token no válido".
- **Sin límites de RAM asfixiantes**: `requiredMemory: 512Mi` / `limitedMemory: 1536Mi` para que Chromium no muera por OOM.

---

## 🗄️ (Opcional) Usar el Postgres gestionado de Olares (citus)

VeciTurno detecta automáticamente `POSTGRES_HOST/USER/PASSWORD/DB` (ver
[`src/config/env.js`](src/config/env.js)) y el citus interno de Olares **no usa SSL**
(no pongas `PG_SSL`). Para usarlo, añade al `OlaresManifest.yaml`:

```yaml
middleware:
  postgres:
    username: veciturno
    databases:
      - name: veciturno
```

y en `deployment.yaml` inyecta las variables que Olares expone:

```yaml
            - name: PGHOST
              value: "{{ .Values.postgres.host }}"
            - name: PGPORT
              value: "{{ .Values.postgres.port }}"
            - name: PGUSER
              value: "{{ .Values.postgres.username }}"
            - name: PGPASSWORD
              value: "{{ .Values.postgres.password }}"
            - name: PGDATABASE
              value: "{{ .Values.postgres.databases.veciturno.name }}"
```

Con Postgres, los datos y los documentos se guardan en la BD; aun así conviene
mantener el volumen persistente para `.wwebjs_auth` (la sesión de WhatsApp).

---

## 🩺 Solución de problemas

| Síntoma | Causa / arreglo |
| :--- | :--- |
| El pod reinicia en bucle | RAM insuficiente para Chromium. Sube `limitedMemory` a `2Gi`. |
| QR no aparece / "connecting" eterno | Chromium no arranca. Verifica `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` y que la imagen sea de la arquitectura correcta del nodo. |
| "Sesión expirada o token no válido" tras reiniciar | `JWT_SECRET` no fijo o vacío. Fíjalo como variable y no lo cambies. |
| Permiso denegado al escribir en `/usr/src/app/db` | Alinea `runAsUser/fsGroup: 1000` (ya en `deployment.yaml`) con el dueño de la carpeta `appData`. |
| Pierde la vinculación tras cada reinicio | El volumen no es persistente: confirma que `appData` está montado en `/usr/src/app/db`. |
