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

// Phục vụ các tệp tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, '../public')));

// Route cho trang chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Route cho trang chi tiết
app.get('/details', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/details.html'));
});

io.on('connection', socket => {
    console.log('Client connected');

    // Xử lý yêu cầu danh sách cổng COM
    socket.on('requestComList', async () => {
        const ports = await require('./serial').listComPorts();
        socket.emit('comList', ports.map((p, index) => ({
            id: index + 1,
            comPort: p.path,
            addrIpv6: 'fe80::1' // Thay bằng logic thực tế
        })));
    });

    // Xử lý yêu cầu dữ liệu cổng COM
    socket.on('getComData', async comPort => {
        const data = await getComData(comPort);
        socket.emit('comDataHistory', data);
    });

    // Xử lý lệnh CLI
    socket.on('sendCli', ({ comPort, command }) => {
        const success = sendCliCommand(comPort, command);
        socket.emit('cliResponse', { success, comPort, command });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Bắt đầu giám sát cổng COM
monitorPorts(io);

const PORT = process.env.SERVER_PORT || 3000;
server.listen(PORT, process.env.SERVER_HOST, () => {
    console.log(`Server running at http://${process.env.SERVER_HOST}:${PORT}`);
});