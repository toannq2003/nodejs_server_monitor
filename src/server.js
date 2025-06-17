const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
const { monitorPorts, sendCliCommand } = require('./serial');
const { getAllPacketData, getAllKits } = require('./database');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const clientComPorts = new Map();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

io.on('connection', socket => {
    console.log('Client connected');
    
    socket.on('joinRoom', room => {
        socket.join(room);
        console.log(`Client joined room: ${room}`);
    });

    // Gửi dữ liệu packet khi client yêu cầu
    socket.on('requestPacketData', async () => {
        try {
            const data = await getAllPacketData();
            socket.emit('packetData', data);
        } catch (error) {
            console.error('Lỗi khi lấy dữ liệu packet:', error);
        }
    });

    // Thêm handler cho requestComList
    socket.on('requestComList', async () => {
        try {
            const ports = Array.from(connectedPorts.values());
            socket.emit('comList', ports.map((p, index) => ({
                id: index + 1,
                comPort: p.path,
                addrIpv6: 'fe80::1'
            })));
        } catch (error) {
            console.error('Lỗi khi gửi danh sách COM:', error);
        }
    });

    // Gửi danh sách kit khi client yêu cầu
    socket.on('requestKitList', async () => {
        try {
            const kits = await getAllKits();
            socket.emit('kitList', kits);
        } catch (error) {
            console.error('Lỗi khi lấy danh sách kit:', error);
        }
    });

    socket.on('sendCli', ({ comPort, command }) => {
        const success = sendCliCommand(comPort, command);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        clientComPorts.delete(socket.id);
    });
});

monitorPorts(io, clientComPorts);

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, process.env.SERVER_HOST, () => {
    console.log(`Server running at http://${process.env.SERVER_HOST}:${PORT}`);
});
