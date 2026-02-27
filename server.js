require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { validatePayload } = require('./security');
const { createRoom, addPeerToRoom, removePeerFromRoom, getOtherPeer, getRoom } = require('./roomManager');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
        return;
    }
    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({ server });

// Rate Limiting Config
const RATE_LIMIT_MSGS = 30; // 30 messages
const RATE_LIMIT_WINDOW = 1000; // per 1 second

server.listen(PORT, () => {
    console.log(`[START] Signaling Server running on http/ws port ${PORT}`);
});

wss.on('connection', (ws, req) => {
    // Basic IP logging
    const ip = req.socket.remoteAddress;
    console.log(`[CONNECT] New connection from ${ip}`);

    // Rate Limiting State per Socket
    ws.msgCount = 0;
    ws.rateLimitResetTime = Date.now() + RATE_LIMIT_WINDOW;

    ws.on('message', (message) => {
        // --- 1. Rate Limiting ---
        const now = Date.now();
        if (now > ws.rateLimitResetTime) {
            ws.msgCount = 0;
            ws.rateLimitResetTime = now + RATE_LIMIT_WINDOW;
        }

        ws.msgCount++;

        if (ws.msgCount > RATE_LIMIT_MSGS) {
            console.log(`[ABUSE] Rate limit exceeded by socket from ${ip}. Current rate: ${ws.msgCount} msgs/sec. Dropping connection.`);
            ws.terminate();
            return;
        }

        // --- 2. Payload Validation ---
        let parsed;
        try {
            parsed = validatePayload(message);
        } catch (error) {
            console.log(`[SECURITY] Invalid payload from ${ip}: ${error.message}. Dropping connection.`);
            ws.terminate();
            return;
        }

        // --- 3. Routing ---
        const { type, payload } = parsed;
        const roomId = parsed.roomId ? parsed.roomId.toLowerCase() : undefined;

        try {
            if (type === 'join') {
                handleJoin(ws, roomId);
            } else if (['offer', 'answer', 'ice'].includes(type)) {
                // Manually inject lowercased ID back into the relay object
                handleRelay(ws, { type, roomId: ws.roomId, payload });
            }
        } catch (error) {
            // General catch for room errors (e.g. room full, room not found)
            console.log(`[ERROR] Routing error for ${ip}: ${error.message}`);
            ws.send(JSON.stringify({ type: 'server-error', message: error.message }));
        }
    });

    ws.on('close', () => {
        console.log(`[DISCONNECT] Connection closed from ${ip}`);
        if (ws.roomId) {
            removePeerFromRoom(ws.roomId, ws);

            // Notify other peer
            const otherPeer = getOtherPeer(ws.roomId, ws);
            if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
                otherPeer.send(JSON.stringify({ type: 'peer-disconnected' }));
            }
        }
    });

    ws.on('error', (err) => {
        console.log(`[ERROR] Socket error from ${ip}: ${err.message}`);
    });
});

function handleJoin(ws, requestedRoomId) {
    if (!requestedRoomId) {
        // Create new room with random ID
        const room = createRoom();
        ws.send(JSON.stringify({ type: 'room-created', roomId: room.roomId }));
        addPeerToRoom(room.roomId, ws);
    } else {
        const existingRoom = getRoom(requestedRoomId);
        if (existingRoom) {
            // Join existing room
            addPeerToRoom(requestedRoomId, ws);
            ws.send(JSON.stringify({ type: 'room-joined', roomId: requestedRoomId }));

            // Notify the other peer that someone joined, they should initiate offer
            const otherPeer = getOtherPeer(requestedRoomId, ws);
            if (otherPeer && otherPeer.readyState === WebSocket.OPEN) {
                otherPeer.send(JSON.stringify({ type: 'peer-joined' }));
            }
        } else {
            // Create requested custom room
            const room = createRoom(requestedRoomId);
            ws.send(JSON.stringify({ type: 'room-created', roomId: room.roomId }));
            addPeerToRoom(room.roomId, ws);
        }
    }
}

function handleRelay(ws, parsedMessage) {
    if (!ws.roomId) {
        throw new Error('Cannot relay message: Peer is not in a room.');
    }

    const otherPeer = getOtherPeer(ws.roomId, ws);
    if (!otherPeer) {
        // It's possible the other peer disconnected during dialing, we just ignore
        console.log(`[WARN] Peer tried to send ${parsedMessage.type} but no other peer is in room ${ws.roomId}`);
        return;
    }

    if (otherPeer.readyState === WebSocket.OPEN) {
        otherPeer.send(JSON.stringify(parsedMessage));
    }
}
