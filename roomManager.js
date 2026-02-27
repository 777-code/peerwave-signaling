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
        peers: new Set(),
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

    if (room.peers.size >= 2) {
        throw new Error('Room is full (max 2 peers).');
    }

    room.peers.add(ws);
    ws.roomId = roomId;

    // Clear idle timeout
    clearTimeout(room.timeoutId);

    // If room is full (2 peers), we transition from idle to absolute maximum timeout
    if (room.peers.size === 2) {
        console.log(`[INFO] Room ${roomId} full. Switching to absolute timeout.`);
        room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_ABSOLUTE_TIMEOUT);
    } else {
        // Still 1 peer. Keep an idle timeout so they dont hold room forever if nobody joins.
        room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_IDLE_TIMEOUT);
    }
}

function removePeerFromRoom(roomId, ws) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.peers.delete(ws);
    delete ws.roomId;

    console.log(`[INFO] Peer left room ${roomId}. Peers remaining: ${room.peers.size}`);

    // If room is empty, clear absolute timeout and re-establish 5min idle timeout
    if (room.peers.size === 0) {
        clearTimeout(room.timeoutId);
        room.timeoutId = setTimeout(() => destroyRoom(roomId), MAX_IDLE_TIMEOUT);
        console.log(`[INFO] Room ${roomId} is empty. Scheduled destruction in 5 mins.`);
    }
}

function getOtherPeer(roomId, senderWs) {
    const room = rooms.get(roomId);
    if (!room) return null;

    for (const peer of room.peers) {
        if (peer !== senderWs) {
            return peer;
        }
    }
    return null;
}

function destroyRoom(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        clearTimeout(room.timeoutId);

        // Close remaining connections gracefully 
        for (const peer of room.peers) {
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
    getOtherPeer,
    destroyRoom
};
