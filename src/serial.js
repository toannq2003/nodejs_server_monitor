const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const usbDetect = require('usb-detection');
const { saveComData } = require('./database');

const connectedPorts = new Map();
const connectionAttempts = new Map(); // Theo dõi số lần thử kết nối

async function listComPorts() {
    try {
        const ports = await SerialPort.list();
        return ports.map(p => ({
            path: p.path,
            manufacturer: p.manufacturer || 'Unknown',
            vendorId: p.vendorId || 'Unknown',
            productId: p.productId || 'Unknown'
        }));
    } catch (error) {
        console.error('Lỗi khi liệt kê cổng COM:', error);
        return [];
    }
}

async function updateComList(io) {
    try {
        const ports = Array.from(connectedPorts.values());
        console.log('Gửi danh sách cổng COM hiện có:', ports.map(p => p.path));

        io.to('indexRoom').emit('comList', ports.map((p, index) => ({
            id: index + 1,
            comPort: p.path,
            addrIpv6: 'fe80::1'
        })));
    } catch (error) {
        console.error('Lỗi khi gửi danh sách cổng COM hiện có:', error);
    }
}

function connectToPort(path, io, clientComPorts) {

    if (connectedPorts.has(path)) {
        console.log(`Cổng ${path} đã được kết nối`);
        return;
    }

    const attempts = connectionAttempts.get(path) || 0;
    if (attempts >= 3) {
        console.error(`Đã thử kết nối cổng ${path} quá nhiều lần, bỏ qua`);
        return;
    }
    
    try {
        console.log(`Đang thử kết nối đến cổng ${path}...`);
        
        const port = new SerialPort({ 
            path, 
            baudRate: 115200,
            autoOpen: false // Không tự động mở, sẽ mở thủ công để xử lý lỗi
        });

        // Mở cổng với xử lý lỗi
        port.open((err) => {
            if (err) {
                console.error(`Lỗi khi mở cổng ${path}:`, err.message);
                connectionAttempts.set(path, attempts + 1);
                
                // Thử lại sau 5 giây nếu chưa quá 3 lần
                if (attempts < 2) {
                    setTimeout(() => {
                        connectToPort(path, io, clientComPorts);
                    }, 2000);
                }
                return;
            }

            // Kết nối thành công
            console.log(`Cổng ${path} đã mở thành công`);
            
            connectedPorts.set(path, port);
            connectionAttempts.delete(path); // Reset số lần thử
            updateComList(io);

            const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

            parser.on('data', data => {
                const buffer = Buffer.from(data);
                console.log(`[${path}] Dữ liệu nhận được:`, buffer.toString());
                try {
                    const parsedData = {
                        comPort: path,
                        addrIpv6: 'fe80::1',
                        rssi: -50,
                        lqi: 100,
                        crc: 'OK',
                        rawData: data
                    };
                    
                    saveComData(parsedData);

                    // Gửi dữ liệu mới cho tất cả client để cập nhật đồ thị
                    io.to('dashboardRoom').emit('newComData', parsedData);

                    // Gửi đến các client quan tâm đến comPort này
                    for (const [socketId, comPort] of clientComPorts) {
                        if (comPort === parsedData.comPort) {
                            io.to(socketId).emit('comData', parsedData);
                        }
                    }
                } catch (error) {
                    console.error(`Lỗi khi xử lý dữ liệu từ ${path}:`, error);
                }
            });

            port.on('error', err => {
                console.error(`Lỗi cổng ${path}:`, err.message);
                connectedPorts.delete(path);
                updateComList(io);
            });

            port.on('close', () => {
                console.log(`Cổng ${path} đã đóng`);
                connectedPorts.delete(path);
                updateComList(io);
            });
        });

    } catch (error) {
        console.error(`Lỗi khi khởi tạo cổng ${path}:`, error.message);
        connectionAttempts.set(path, attempts + 1);
    }
    
}

function monitorPorts(io, clientComPorts) {
    initializeExistingPorts(io, clientComPorts);

    usbDetect.startMonitoring();

    usbDetect.on('add', async () => {
        console.log('Phát hiện thiết bị USB mới');
        setTimeout(async () => {
            const ports = await listComPorts();
            console.log('Danh sách cổng sau khi thêm USB:', ports.map(p => p.path));
            
            for (const p of ports) {
                    await connectToPort(p.path, io, clientComPorts);
            }
        }, 1000);
    });
}

async function initializeExistingPorts(io, clientComPorts) {
    console.log('Khởi tạo kết nối đến các cổng hiện có...');
    const ports = await listComPorts();
    
    for (const p of ports) {
        await connectToPort(p.path, io, clientComPorts);
        // Đợi một chút giữa các kết nối để tránh xung đột
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

function sendCliCommand(comPort, command) {
    const port = connectedPorts.get(comPort);
    if (port && port.isOpen) {
        port.write(`${command}\r\n`, err => {
            if (err) {
            return console.log('Error on write:', err.message);
            }
        });
        console.log('Đã gửi lệnh:', command, 'đến cổng', comPort);
        return true;
    }
    return false;
}

module.exports = { monitorPorts, sendCliCommand, listComPorts };