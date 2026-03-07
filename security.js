const crypto = require('crypto');

// Generate 12-char lowercase alphanumeric room ID (a-z0-9)
function generateRoomId() {
  const charset = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomValues = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}

// Generate 8-char lowercase alphanumeric peer ID
function generatePeerId() {
  const charset = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  const randomValues = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}

// Hash a room password using SHA-256
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Strictly allow only defined signaling types
const ALLOWED_TYPES = ['join', 'offer', 'answer', 'ice'];

function validatePayload(data) {
  // Reject payload strictly > 8KB (8192 bytes)
  if (data.length > 8192) {
    throw new Error('Payload too large (limit 8KB).');
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error('Invalid JSON payload.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Payload must be a JSON object.');
  }

  if (!ALLOWED_TYPES.includes(parsed.type)) {
    throw new Error(`Forbidden message type: ${parsed.type}`);
  }

  // Validate roomId structure if it exists.
  if (parsed.roomId) {
    if (typeof parsed.roomId !== 'string') {
      throw new Error('roomId must be a string.');
    }
    if (!/^[a-z0-9_]{3,32}$/.test(parsed.roomId)) {
      throw new Error('Invalid roomId format. Must be 3-32 alphanumeric characters or underscores.');
    }
  }

  if (parsed.to) {
    if (typeof parsed.to !== 'string' || !/^[a-z0-9]{8}$/.test(parsed.to)) {
      throw new Error('Invalid to field format.');
    }
  }

  if (parsed.from) {
    if (typeof parsed.from !== 'string' || !/^[a-z0-9]{8}$/.test(parsed.from)) {
      throw new Error('Invalid from field format.');
    }
  }

  return parsed;
}

module.exports = {
  generateRoomId,
  generatePeerId,
  validatePayload,
  hashPassword,
};
