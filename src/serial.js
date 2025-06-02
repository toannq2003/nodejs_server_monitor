const { SerialPort } = require('serialport');
const usbDetect = require('usb-detection');
const { saveComData } = require('./database');

const connectedPorts = new Map();
let lastComList = []; // Lưu danh sách cổng COM trước đó

async function listComPorts() {
    const ports = await SerialPort.list();
    return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Unknown',
        vendorId: p.vendorId || 'Unknown',
        productId: p.productId || 'Unknown'
    }));
}

async function updateComList(io) {
    const ports = await listComPorts();
    const currentComList = ports.map(p => p.path).sort();

    if (JSON.stringify(currentComList) !== JSON.stringify(lastComList)) {
        lastComList = currentComList;
        io.emit('comList', ports.map((p, index) => ({
            id: index + 1,
            comPort: p.path,
            addrIpv6: 'fe80::1' // Thay bằng logic lấy IPv6 thực tế
        })));
        console.log('Cập nhật danh sách cổng COM:', currentComList);
    }
}

function connectToPort(path, io) {
    if (!connectedPorts.has(path)) {
        const port = new SerialPort({ path, baudRate: 9600 });
        connectedPorts.set(path, port);

        port.on('data', data => {
            const parsedData = {
                comPort: path,
                addrIpv6: 'fe80::1',
                rssi: -50,
                lqi: 100,
                crc: 'OK',
                rawData: data.toString('hex')
            };
            saveComData(parsedData);
            io.emit('comData', parsedData);
        });

        port.on('error', err => {
            console.error(`Lỗi cổng ${path}:`, err);
            connectedPorts.delete(path);
            updateComList(io);
        });

        port.on('close', () => {
            console.log(`Cổng ${path} đã đóng`);
            connectedPorts.delete(path);
            updateComList(io);
        });
    }
}

function monitorPorts(io) {
    usbDetect.startMonitoring();

    usbDetect.on('add', async () => {
        console.log('Phát hiện thiết bị USB mới');
        const ports = await listComPorts();
        ports.forEach(p => connectToPort(p.path, io));
        updateComList(io);
    });

    usbDetect.on('remove', async () => {
        console.log('Thiết bị USB bị ngắt');
        const ports = await listComPorts();
        const currentPortPaths = ports.map(p => p.path);
        for (const [path, port] of connectedPorts) {
            if (!currentPortPaths.includes(path)) {
                port.close();
                connectedPorts.delete(path);
            }
        }
        updateComList(io);
    });
}

function sendCliCommand(comPort, command) {
    const port = connectedPorts.get(comPort);
    if (port && port.isOpen) {
        port.write(`${command}\n`);
        return true;
    }
    return false;
}

module.exports = { monitorPorts, sendCliCommand, listComPorts };