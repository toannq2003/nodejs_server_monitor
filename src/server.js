// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const dotenv = require('dotenv');
const { connectToPort, sendCliCommand, monitorPorts } = require('./serial');
const { getAllKits, getChartData } = require('./database');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/details', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/details.html'));
});

app.get('/charts', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/charts.html'));
});

// Socket.IO events
io.on('connection', socket => {
    console.log('Client connected');

    socket.on('joinRoom', room => {
        socket.join(room);
        console.log(`Client joined room: ${room}`);
    });

    socket.on('requestKitsList', async () => {
        try {
            const kits = await getAllKits();
            socket.emit('kitsList', kits);
        } catch (error) {
            console.error('Lỗi khi lấy danh sách kits:', error);
        }
    });

    socket.on('sendCli', ({ comPort, command }) => {
        const success = sendCliCommand(comPort, command);
        if (!success) {
            socket.emit('cliResponse', {
                comPort,
                response: 'Lỗi: Không thể gửi lệnh đến kit'
            });
        }
    });

    socket.on('requestChartData', async ({ kitIds, timeRange }) => {
        try {
            const data = await getChartData(kitIds, timeRange);
            socket.emit('chartData', data);
        } catch (error) {
            console.error('Lỗi khi lấy dữ liệu biểu đồ:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Khởi động monitor cổng COM
monitorPorts(io);

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, process.env.SERVER_HOST || 'localhost', () => {
    console.log(`Server running at http://${process.env.SERVER_HOST || 'localhost'}:${PORT}`);
});
