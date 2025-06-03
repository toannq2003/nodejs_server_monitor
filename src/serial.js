const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const usbDetect = require('usb-detection');
const { saveComData } = require('./database');

const connectedPorts = new Map();

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

    io.to('indexRoom').emit('comList', ports.map((p, index) => ({
        id: index + 1,
        comPort: p.path,
        addrIpv6: 'fe80::1'
    })));
}

function connectToPort(path, io, clientComPorts) {
    if (!connectedPorts.has(path)) {
        const port = new SerialPort({ path, baudRate: 9600 });
        connectedPorts.set(path, port);

        const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

        parser.on('data', data => {
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
            const buffer = Buffer.from(data);
            console.log(buffer.toString('hex'));
        });

        port.on('error', err => {
            console.error(`Lỗi cổng ${path}:`, err);
            connectedPorts.delete(path);
            updateComList(io);
        });

        port.on('close', () => {
            console.log(`Cổng ${path} đã đóng`);
            connectedPorts.delete(path);
        });
    }
}

function monitorPorts(io, clientComPorts) {
    usbDetect.startMonitoring();

    usbDetect.on('add', async () => {
        console.log('Phát hiện thiết bị USB mới');
        const ports = await listComPorts();
        ports.forEach(p => connectToPort(p.path, io, clientComPorts));
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