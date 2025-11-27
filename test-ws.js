import { WebSocket } from 'ws';

console.log('Script started');
// Try 127.0.0.1 to avoid localhost resolution ambiguity
const url = 'ws://127.0.0.1:4000/ws/state';
console.log(`Attempting connection to ${url}...`);

try {
  const ws = new WebSocket(url);

  ws.on('headers', (headers, response) => {
    console.log('Received headers:', headers);
    console.log('Response status:', response.statusCode, response.statusMessage);
  });

  ws.on('open', () => {
    console.log('Connected successfully!');
    ws.close();
  });

  ws.on('error', (err) => {
    console.error('Connection Error:', err);
  });

  ws.on('close', (code, reason) => {
    console.log(`Connection Closed: Code=${code}, Reason=${reason.toString()}`);
  });
} catch (e) {
  console.error('Synchronous error creating WebSocket:', e);
}

// Timeout after 5 seconds to prevent hanging
setTimeout(() => {
    console.log('Timeout reached (5s), exiting...');
    process.exit(1);
}, 5000);
