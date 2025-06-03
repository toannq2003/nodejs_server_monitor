const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
const { monitorPorts, sendCliCommand } = require('./serial');
const { getComData } = require('./database');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Lưu trữ thông tin comPort của mỗi client
const clientComPorts = new Map();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/details', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/details.html'));
});

io.on('connection', socket => {
    console.log('Client connected');

    socket.on('joinRoom', room => {
        socket.join(room);
        console.log(`Client joined room: ${room}`);
    });

    // Client đăng ký comPort mà nó quan tâm
    socket.on('registerComPort', comPort => {
        clientComPorts.set(socket.id, comPort);
        console.log(`Client ${socket.id} registered for comPort: ${comPort}`);
    });

    socket.on('requestComList', async () => {
        const ports = await require('./serial').listComPorts();
        io.to('indexRoom').emit('comList', ports.map((p, index) => ({
            id: index + 1,
            comPort: p.path,
            addrIpv6: 'fe80::1'
        })));
    });

    socket.on('getComData', async comPort => {
        const data = await getComData(comPort);
        socket.emit('comDataHistory', data);
    });

    socket.on('sendCli', ({ comPort, command }) => {
        const success = sendCliCommand(comPort, command);
        socket.emit('cliResponse', { success, comPort, command });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        clientComPorts.delete(socket.id);
    });
});

// Truyền io để sử dụng trong serial.js
monitorPorts(io, clientComPorts);

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, process.env.SERVER_HOST, () => {
    console.log(`Server running at http://${process.env.SERVER_HOST}:${PORT}`);
});