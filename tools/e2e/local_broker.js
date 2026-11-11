// Throwaway local MQTT broker for the end-to-end test (no TLS, no auth).
const aedes = require('aedes')();
const server = require('net').createServer(aedes.handle);
aedes.on('clientDisconnect', (c) => console.log('disconnect', c && c.id));
aedes.on('client', (c) => console.log('connect', c && c.id));
server.listen(18830, '127.0.0.1', () => console.log('broker ready on 18830'));
