const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    console.log('Connected to server. Attempting abuse...');

    // 1. Send invalid JSON
    // ws.send('This is not json');

    // 2. Send 50 messages rapidly (Rate limit is 30)
    for (let i = 0; i < 50; i++) {
        ws.send(JSON.stringify({ type: 'ice', payload: 'spam' }));
    }
});

ws.on('close', () => {
    console.log('Socket closed by server. (Expected behavior on abuse)');
});

ws.on('error', (err) => {
    console.error('Socket error:', err.message);
});
