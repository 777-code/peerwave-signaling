require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { validatePayload, generatePeerId } = require('./security');
const { createRoom, addPeerToRoom, removePeerFromRoom, getOtherPeers, getPeerById, getRoom, validateRoomPassword } = require('./roomManager');

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
                handleJoin(ws, roomId, parsed.peerId, parsed.password);
            } else if (['offer', 'answer', 'ice'].includes(type)) {
                // Relay explicit routing payload
                handleRelay(ws, parsed);
            }
        } catch (error) {
            // General catch for room errors (e.g. room full, room not found)
            console.log(`[ERROR] Routing error for ${ip}: ${error.message}`);
            ws.send(JSON.stringify({ type: 'server-error', message: error.message }));
        }
    });

    ws.on('close', () => {
        console.log(`[DISCONNECT] Connection closed from ${ip} (PeerId: ${ws.peerId || 'Unknown'})`);
        if (ws.roomId && ws.peerId) {
            const others = getOtherPeers(ws.roomId, ws.peerId);
            removePeerFromRoom(ws.roomId, ws);

            for (const peer of others) {
                if (peer.readyState === WebSocket.OPEN) {
                    peer.send(JSON.stringify({ type: 'peer-left', peerId: ws.peerId }));
                }
            }
        }
    });

    ws.on('error', (err) => {
        console.log(`[ERROR] Socket error from ${ip}: ${err.message}`);
    });
});

function handleJoin(ws, requestedRoomId, requestedPeerId, password) {
    ws.peerId = requestedPeerId && /^[a-z0-9]{8}$/.test(requestedPeerId) ? requestedPeerId : generatePeerId();

    if (!requestedRoomId) {
        // Create new room with random ID (password optional)
        const room = createRoom(null, password);
        addPeerToRoom(room.roomId, ws);
        ws.send(JSON.stringify({ type: 'room-created', roomId: room.roomId, peerId: ws.peerId, peers: [] }));
    } else {
        const existingRoom = getRoom(requestedRoomId);
        if (existingRoom) {
            // Validate password before joining
            if (!validateRoomPassword(requestedRoomId, password)) {
                throw new Error('Invalid room password.');
            }

            // Join existing room
            addPeerToRoom(requestedRoomId, ws);
            const others = getOtherPeers(requestedRoomId, ws.peerId);
            const otherIds = others.map(p => p.peerId);

            ws.send(JSON.stringify({ type: 'room-joined', roomId: requestedRoomId, peerId: ws.peerId, peers: otherIds }));

            for (const peer of others) {
                if (peer.readyState === WebSocket.OPEN) {
                    peer.send(JSON.stringify({ type: 'peer-joined', peerId: ws.peerId }));
                }
            }
        } else {
            // Create requested custom room (password optional)
            const room = createRoom(requestedRoomId, password);
            addPeerToRoom(room.roomId, ws);
            ws.send(JSON.stringify({ type: 'room-created', roomId: room.roomId, peerId: ws.peerId, peers: [] }));
        }
    }
}

function handleRelay(ws, parsedMessage) {
    if (!ws.roomId) throw new Error('Cannot relay message: Peer is not in a room.');
    if (!ws.peerId) throw new Error('Sender has no peerId.');

    if (!parsedMessage.to) {
        console.log(`[WARN] Peer ${ws.peerId} tried to relay ${parsedMessage.type} without a target 'to' field.`);
        return;
    }

    const targetPeer = getPeerById(ws.roomId, parsedMessage.to);
    if (!targetPeer) {
        console.log(`[WARN] Peer ${ws.peerId} tried to route ${parsedMessage.type} to unknown peer ${parsedMessage.to}`);
        return;
    }

    // Embed strict sender identity so the target knows who it came from relative to Perfect Negotiation context
    parsedMessage.from = ws.peerId;
    parsedMessage.roomId = ws.roomId;

    if (targetPeer.readyState === WebSocket.OPEN) {
        targetPeer.send(JSON.stringify(parsedMessage));
    }
}
