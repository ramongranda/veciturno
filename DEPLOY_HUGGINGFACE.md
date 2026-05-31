# 🚀 Guía de Despliegue en Hugging Face Spaces + Supabase (100% Gratis y Sin Tarjeta)

Esta guía te guiará paso a paso para alojar **VeciTurno** de manera **100% gratuita y sin introducir ninguna tarjeta de crédito**. 

Utilizaremos **Hugging Face Spaces** (un entorno de contenedores en la nube que corre 24/7 con **16 GB de RAM y 2 vCPUs**) para la aplicación y **Supabase** (PostgreSQL gratuito de 500 MB) para guardar todos los datos de vecinos, cuotas e historial de forma persistente.

---

## 🛠️ Paso 1: Crear la Base de Datos Gratuita en Supabase

Supabase ofrece bases de datos PostgreSQL de alta velocidad en su capa gratuita sin pedir tarjeta de crédito.

1. Entra en [Supabase](https://supabase.com/) y regístrate de forma gratuita (puedes usar tu cuenta de GitHub).
2. Haz clic en **New Project** (Nuevo Proyecto).
3. Configura los datos del proyecto:
   * **Name**: `veciturno-db`
   * **Database Password**: Introduce una contraseña segura y **apúntala** (la necesitarás ahora).
   * **Region**: Selecciona una cercana (ej. *EU (Frankfurt)* o *EU (London)*).
   * **Plan**: Asegúrate de seleccionar el plan **Free** (Gratuito).
4. Espera 1 minuto a que se aprovisione la base de datos.
5. Ve a **Project Settings** (icono de engranaje abajo a la izquierda) ➔ **Database**.
6. Busca la sección **Connection String** (Cadena de conexión), selecciona la pestaña **URI** y copia el texto.
   * La cadena tendrá un formato como este:
     `postgresql://postgres.[TU-ID-PROYECTO]:[TU-CONTRASEÑA]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
   * **IMPORTANTE**: Sustituye `[TU-CONTRASEÑA]` por la contraseña real que configuraste en el paso 3. Guarda esta URL para el siguiente paso.

---

## 🤗 Paso 2: Crear el Space en Hugging Face

Hugging Face nos permite levantar nuestro contenedor Docker a medida (que ya incluye Chromium para el bot de WhatsApp) y tener la app en línea las 24 horas del día.

1. Entra en [Hugging Face](https://huggingface.com/) y regístrate de forma gratuita si no tienes cuenta.
2. Ve a la pestaña **Spaces** (arriba a la derecha) y haz clic en **Create new Space**.
3. Configura los campos del Space:
   * **Space Name**: `veciturno` (o el nombre de tu comunidad).
   * **License**: `mit`
   * **SDK**: Selecciona **Docker** (⚠️ *Muy importante: no elijas Streamlit ni Gradio*).
   * **Docker Template**: Selecciona **Blank** (Vacío).
   * **Space Visibility**: Puedes elegir **Public** (Público) para que los vecinos accedan de forma directa mediante la URL de Hugging Face.
4. Haz clic en **Create Space**.

---

## ⚙️ Paso 3: Configurar las Variables de Entorno (Secrets)

Ahora debemos introducir de forma segura las claves de nuestra aplicación en Hugging Face:

1. Dentro de tu nuevo Space en Hugging Face, ve a la pestaña **Settings** (arriba a la derecha).
2. Desplázate hacia abajo hasta la sección **Variables and secrets**.
3. Haz clic en **New secret** (Nuevo secreto) para agregar cada una de las siguientes variables:

| Nombre del Secreto | Valor de Ejemplo | Descripción |
| :--- | :--- | :--- |
| **`DATABASE_URL`** | `postgresql://postgres.xyz...:6543/postgres` | La URL de conexión de Supabase que copiaste en el Paso 1 (con la contraseña resuelta). |
| **`JWT_SECRET`** | `tu-cadena-super-secreta-y-larga-2026` | Una clave aleatoria larga para firmar las sesiones de usuario y 2FA. |
| **`COMMUNITY_NAME`** | `"San Juan Bautista de la Salle N 37"` | El nombre oficial de tu comunidad de vecinos. |
| **`BOOTSTRAP_TOKEN`** | `"registro-inicial-planta3"` | Token para el primer registro del administrador. |
| **`START_MONTH`** | `2026-06-01` | Mes de inicio de la rotación de limpieza. |
| **`START_FLOOR_ID`** | `1` | ID de la vivienda que arranca el primer turno. |
| **`APP_BASE_URL`** | `https://rgranda-veciturno.hf.space` | URL pública real de tu Space. Imprescindible para que los enlaces de invitación apunten al despliegue y no al host interno. |

---

## 📤 Paso 4: Subir tu Código y Desplegar

Hugging Face Spaces funciona exactamente como un repositorio de Git. Podemos empujar nuestro código local directamente allí:

1. Abre tu terminal local en la carpeta del proyecto de VeciTurno.
2. Agrega el repositorio de tu Space de Hugging Face como un control remoto adicional de Git:
   ```bash
   git remote add huggingface https://huggingface.co/spaces/TU_USUARIO_HF/TU_NOMBRE_SPACE
   ```
   *(Reemplaza por tu nombre de usuario y el nombre que le diste al Space en el Paso 2).*
3. Sube el código al Space:
   ```bash
   git push huggingface master:main -f
   ```
   *(Nota: Hugging Face requiere que la rama de ejecución principal se llame `main`, por lo que empujamos nuestra rama `master` local hacia `main` remota).*
4. Si la terminal te pide tus credenciales de Hugging Face:
   * **Username**: Tu usuario de Hugging Face.
   * **Password**: Tu contraseña de Hugging Face o un token de acceso (que puedes generar en los ajustes de tu cuenta de HF en la sección *Access Tokens*).

---

## ⚡ Paso 5: ¡Listo y en Marcha!

¡Eso es todo! Hugging Face detectará automáticamente el archivo `Dockerfile` en el código que acabas de subir:
1. Compilará el contenedor.
2. Descargará Chromium y las librerías necesarias.
3. Se conectará a **Supabase** y creará automáticamente la tabla necesaria.
4. Levantará la aplicación en puerto `7860` de forma interna.

Podrás ver el estado del despliegue en la pestaña **App** de tu Space. Una vez completado (tarda unos 2-3 minutos la primera vez), **tu aplicación estará 100% activa en internet en la URL oficial de tu Space**:
`https://huggingface.co/spaces/TU_USUARIO_HF/TU_NOMBRE_SPACE`

### 💬 Escanear el Bot de WhatsApp
1. Entra a tu aplicación VeciTurno desde la URL de Hugging Face.
2. Regístrate usando el link de invitación inicial (`/invite?token=registro-inicial-planta3`).
3. Ve al Panel de Administración ➔ **Configuración de WhatsApp**.
4. Escanea el código QR en pantalla con tu móvil para asociar la cuenta de notificaciones de la comunidad. 

Dado que Hugging Face **nunca entra en suspensión (24/7)**, el bot de WhatsApp permanecerá conectado permanentemente para enviar las alertas diarias de limpieza y del tablón de anuncios de forma automática.
