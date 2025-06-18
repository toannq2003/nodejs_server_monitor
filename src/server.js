const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
const { monitorPorts, sendCliCommand, getConnectedPorts } = require('./serial');
const { getAllPacketData, getAllKits, getFilteredPacketData, getDataWindow, getSimplePacketData } = require('./database');

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


// Thêm handler cho sliding window với filter
// Cập nhật handler trong server.js
socket.on('requestDataWindow', async ({ startId, direction, limit = 400, filters = {} }) => {
    try {
        console.log('Requesting data window:', { startId, direction, limit, filters });
        
        // Thử getDataWindow trước
        const result = await getDataWindow(startId, direction, limit, filters);
        socket.emit('dataWindow', result);
        
        console.log(`Sent ${direction} window: ${result.data.length} packets`);
    } catch (error) {
        console.error('Lỗi khi lấy data window, trying fallback:', error);
        
        try {
            // Fallback to simple query
            const result = await getSimplePacketData(limit);
            socket.emit('dataWindow', result);
            
            console.log(`Sent fallback data: ${result.data.length} packets`);
        } catch (fallbackError) {
            console.error('Fallback cũng lỗi:', fallbackError);
            
            // Gửi empty result
            socket.emit('dataWindow', {
                data: [],
                hasMoreNext: false,
                hasMorePrev: false,
                firstId: null,
                lastId: null,
                direction: direction || 'next'
            });
        }
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
});

monitorPorts(io, clientComPorts);

const PORT = process.env.SERVER_PORT || 8080;
server.listen(PORT, process.env.SERVER_HOST || 'localhost', () => {
    console.log(`Server running at http://${process.env.SERVER_HOST || 'localhost'}:${PORT}`);
});
