const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
const { monitorPorts, sendCliCommand, getConnectedPorts } = require('./serial');
// Thêm import
const { getAllPacketData, getAllKits, getFilteredPacketData, getKitStatistics } = require('./database');

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

    // Handler cho requestComList - ĐÃ SỬA
    socket.on('requestComList', async () => {
        try {
            const ports = Array.from(getConnectedPorts().values());
            socket.emit('comList', ports.map((p, index) => ({
                id: index + 1,
                comPort: p.path,
                addrIpv6: 'fe80::1'
            })));
        } catch (error) {
            console.error('Lỗi khi gửi danh sách COM:', error);
            socket.emit('comList', []);
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
        if (!success) {
            socket.emit('cliResponse', {
                success: 0,
                comPort: comPort,
                response: 'Error: Port not connected or command failed'
            });
        }
    });

    // Handler cho filtered data
    socket.on('requestFilteredPacketData', async (filters) => {
        try {
            const data = await getFilteredPacketData(filters);
            socket.emit('packetData', data);
        } catch (error) {
            console.error('Lỗi khi lấy dữ liệu packet filtered:', error);
        }
    });

    // Thêm vào server.js
    socket.on('requestKitUpdate', async () => {
    try {
        const kits = await getAllKits();
        socket.emit('kitList', kits);
    } catch (error) {
        console.error('Lỗi khi cập nhật danh sách kit:', error);
    }
});

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        clientComPorts.delete(socket.id);
    });

    // Thêm socket handler (trong phần io.on('connection', socket => {...}))
socket.on('requestKitStats', async (kitUnique) => {
    try {
        const data = await getKitStatistics(kitUnique);
        socket.emit('kitStats', data);
    } catch (error) {
        console.error('Lỗi khi lấy thống kê kit:', error);
        socket.emit('kitStatsError', error.message);
    }
});

});

// Thêm route cho trang thống kê kit (sau route cho trang chính)
app.get('/kit-stats', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/kit-stats.html'));
});

monitorPorts(io, clientComPorts);

const PORT = process.env.SERVER_PORT || 8080;
server.listen(PORT, process.env.SERVER_HOST || 'localhost', () => {
    console.log(`Server running at http://${process.env.SERVER_HOST || 'localhost'}:${PORT}`);
});
