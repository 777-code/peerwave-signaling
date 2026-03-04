const { generateRoomId } = require('./security');

const rooms = new Map();

/**
 * Room structure
 * {
 *   roomId: string,
 *   peers: Set<WebSocket>,
 *   createdAt: number,
 *   timeoutId: NodeJS.Timeout
 * }
 */

// Global constant limits
const MAX_ABSOLUTE_TIMEOUT = 30 * 60 * 1000; // 30 mins
const MAX_IDLE_TIMEOUT = 5 * 60 * 1000;     // 5 mins

function createRoom(customId) {
    const roomId = customId || generateRoomId();

    const room = {
        roomId,
        peers: new Map(),
        createdAt: Date.now(),
    };

    // Immediate timeout to kill it if idle for 5 mins
    room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_IDLE_TIMEOUT);

    rooms.set(roomId, room);
    console.log(`[INFO] Room created: ${roomId}`);
    return room;
}

function getRoom(roomId) {
    return rooms.get(roomId);
}

function addPeerToRoom(roomId, ws) {
    const room = rooms.get(roomId);

    if (!room) {
        throw new Error('Room not found');
    }

    if (room.peers.size >= 6) {
        throw new Error('Room is full (max 6 peers).');
    }

    room.peers.set(ws.peerId, ws);
    ws.roomId = roomId;

    // Clear idle timeout
    clearTimeout(room.timeoutId);

    // Apply absolute timeout once room has active members
    room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_ABSOLUTE_TIMEOUT);
}

function removePeerFromRoom(roomId, ws) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.peers.delete(ws.peerId);
    delete ws.roomId;

    console.log(`[INFO] Peer ${ws.peerId} left room ${roomId}. Peers remaining: ${room.peers.size}`);

    // If room is empty, clear absolute timeout and re-establish 5min idle timeout
    if (room.peers.size === 0) {
        clearTimeout(room.timeoutId);
        room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_IDLE_TIMEOUT);
        console.log(`[INFO] Room ${roomId} is empty. Scheduled destruction in 5 mins.`);
    }
}

function getOtherPeers(roomId, excludePeerId) {
    const room = rooms.get(roomId);
    if (!room) return [];

    const others = [];
    for (const [id, peer] of room.peers.entries()) {
        if (id !== excludePeerId) {
            others.push(peer);
        }
    }
    return others;
}

function getPeerById(roomId, peerId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    return room.peers.get(peerId) || null;
}

function destroyRoom(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        clearTimeout(room.timeoutId);

        // Close remaining connections gracefully 
        for (const peer of room.peers.values()) {
            peer.send(JSON.stringify({ type: 'server-error', message: 'Room timeout expired.' }));
            peer.terminate();
        }

        rooms.delete(roomId);
        console.log(`[WARNING] Room ${roomId} destroyed due to timeout.`);
    }
}

module.exports = {
    createRoom,
    getRoom,
    addPeerToRoom,
    removePeerFromRoom,
    getOtherPeers,
    getPeerById,
    destroyRoom
};
