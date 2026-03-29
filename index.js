const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// In-memory storage for rooms (max 2 users per room)
const rooms = new Map();
const ROOM_CAPACITY = 2;

// Serve static files
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Server error');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const roomId = req.url.split('room=')[1] || 'default';
    let userInfo = { id: Date.now() + Math.random(), name: 'User', lastSeen: Date.now() };

    console.log(`👤 User connected to room: ${roomId}`);

    // Send room info
    ws.send(JSON.stringify({ type: 'roomInfo', roomId, capacity: ROOM_CAPACITY }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            handleMessage(ws, roomId, msg, userInfo);
        } catch (e) {
            console.error('Invalid message:', e);
        }
    });

    ws.on('close', () => {
        leaveRoom(roomId, ws);
        console.log(`👋 User left room: ${roomId}`);
    });
});

function handleMessage(ws, roomId, msg, userInfo) {
    if (!rooms.has(roomId)) rooms.set(roomId, { users: new Set(), messages: [] });

    const room = rooms.get(roomId);

    switch (msg.type) {
        case 'join':
            userInfo.name = msg.name;
            room.users.add({ ws, userInfo });
            
            // Limit to 2 users
            if (room.users.size > ROOM_CAPACITY) {
                ws.send(JSON.stringify({ type: 'error', message: 'Room full! Max 2 users.' }));
                ws.close();
                return;
            }

            // Notify others
            broadcastRoom(roomId, { 
                type: 'userJoined', 
                users: Array.from(room.users).map(u => u.userInfo.name),
                userCount: room.users.size 
            });

            // Send chat history
            ws.send(JSON.stringify({ type: 'chatHistory', messages: room.messages.slice(-50) }));
            break;

        case 'message':
            const message = {
                id: Date.now(),
                text: msg.text,
                sender: userInfo.name,
                time: new Date().toISOString(),
                status: 'sent'
            };
            room.messages.push(message);
            
            // Keep only last 100 messages
            if (room.messages.length > 100) room.messages.shift();
            
            broadcastRoom(roomId, { type: 'message', ...message });
            break;

        case 'typing':
            broadcastRoom(roomId, { type: 'typing', user: userInfo.name, isTyping: msg.isTyping });
            break;

        case 'read':
            broadcastRoom(roomId, { type: 'read', messageId: msg.messageId });
            break;

        case 'clear':
            room.messages = [];
            broadcastRoom(roomId, { type: 'clear' });
            break;

        case 'heartbeat':
            userInfo.lastSeen = Date.now();
            break;
    }
}

function broadcastRoom(roomId, data) {
    if (!rooms.has(roomId)) return;
    
    const room = rooms.get(roomId);
    room.users.forEach(({ ws }) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    });
}

function leaveRoom(roomId, ws) {
    if (!rooms.has(roomId)) return;
    
    const room = rooms.get(roomId);
    room.users = new Set(Array.from(room.users).filter(u => u.ws !== ws));
    
    if (room.users.size === 0) {
        rooms.delete(roomId);
    } else {
        // Notify remaining users
        broadcastRoom(roomId, { 
            type: 'userLeft', 
            users: Array.from(room.users).map(u => u.userInfo.name),
            userCount: room.users.size 
        });
    }
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 PrivateChat Server running on http://localhost:${PORT}`);
    console.log(`📱 Open 2 browser tabs to test!`);
    console.log(`👥 Max 2 users per room\n`);
});