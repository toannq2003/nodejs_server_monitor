// serial.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { saveKitInfo, updateKitStatus, saveLogData } = require('./database');

const connectedPorts = new Map();
const kitUniqueIds = new Map(); // Map comPort -> uniqueId

// Phân tích định dạng log
function parseLogData(data, comPort) {
    const trimmedData = data.trim();
    
    // Kiểm tra định dạng log
    if (trimmedData.startsWith('TX,') || trimmedData.startsWith('TXE,') || trimmedData.startsWith('RX,')) {
        return parsePacketLog(trimmedData, comPort);
    }
    
    // Kiểm tra unique ID (giả sử format: UNIQUE_ID:ABC123DEF456)
    if (trimmedData.startsWith('UNIQUE_ID:')) {
        const uniqueId = trimmedData.split(':')[1];
        kitUniqueIds.set(comPort, uniqueId);
        saveKitInfo(uniqueId, comPort);
        return { type: 'unique_id', uniqueId };
    }
    
    // Dữ liệu CLI hoặc string khác
    return { type: 'cli_response', data: trimmedData };
}

// serial.js - Cập nhật parseLogData
function parseLogData(data, comPort) {
    const trimmedData = data.trim();
    const parts = trimmedData.split(',');
    
    // Kiểm tra định dạng log mới với unique_id ở vị trí thứ 2
    // Format: TX,{unique_id},{length},{data_hex},{isAck},{channel},{timestamp}
    // Format: TXE,{unique_id},{errorCode},{timestamp}
    // Format: RX,{unique_id},{length},{data_hex},{crcPassed},{isAck},{rssi},{lqi},{channel},{timestamp},{errorCode}
    
    if (parts.length >= 3 && (parts[0] === 'TX' || parts[0] === 'TXE' || parts[0] === 'RX')) {
        const logType = parts[0];
        const uniqueId = parts[1]; // unique_id ở vị trí thứ 2
        
        // Lưu unique_id cho cổng này nếu chưa có
        if (!kitUniqueIds.has(comPort)) {
            kitUniqueIds.set(comPort, uniqueId);
            saveKitInfo(uniqueId, comPort);
        }
        
        return parsePacketLogNewFormat(parts, comPort);
    }
    
    // Dữ liệu string khác - hiển thị trực tiếp
    return { type: 'string_data', data: trimmedData };
}

function parsePacketLogNewFormat(parts, comPort) {
    const logType = parts[0];
    const uniqueId = parts[1];
    
    let logData = {
        kitUniqueId: uniqueId,
        comPort,
        logType,
        raw_data: parts.join(',')
    };
    
    switch (logType) {
        case 'TX':
            // TX,{unique_id},{length},{data_hex},{isAck},{channel},{timestamp}
            logData.length = parseInt(parts[2]);
            logData.dataHex = parts[3];
            logData.isAck = parts[4] === '1';
            logData.channel = parseInt(parts[5]);
            logData.kitTimestamp = parseInt(parts[6]);
            break;
            
        case 'TXE':
            // TXE,{unique_id},{errorCode},{timestamp}
            logData.errorCode = parseInt(parts[2]);
            logData.kitTimestamp = parseInt(parts[3]);
            logData.error_description = getTxErrorDescription(logData.errorCode);
            break;
            
        case 'RX':
            // RX,{unique_id},{length},{data_hex},{crcPassed},{isAck},{rssi},{lqi},{channel},{timestamp},{errorCode}
            logData.length = parseInt(parts[2]);
            logData.dataHex = parts[3];
            logData.crcPassed = parts[4] === '1';
            logData.isAck = parts[5] === '1';
            logData.rssi = parseInt(parts[6]);
            logData.lqi = parseInt(parts[7]);
            logData.channel = parseInt(parts[8]);
            logData.kitTimestamp = parseInt(parts[9]);
            logData.errorCode = parseInt(parts[10]);
            logData.error_description = getRxErrorDescription(logData.errorCode);
            break;
    }
    
    return { type: 'log_data', data: logData };
}


async function connectToPort(path, io) {
    if (connectedPorts.has(path)) {
        console.log(`Cổng ${path} đã được kết nối`);
        return;
    }

    try {
        const port = new SerialPort({
            path,
            baudRate: 115200,
            autoOpen: false
        });

        port.open((err) => {
            if (err) {
                console.error(`Lỗi khi mở cổng ${path}:`, err.message);
                return;
            }

            console.log(`Cổng ${path} đã mở thành công`);
            connectedPorts.set(path, port);
            
            // Gửi lệnh lấy unique ID
            setTimeout(() => {
                port.write('unique\r\n');
            }, 1000);

            updateComList(io);

            const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
            
            parser.on('data', async (data) => {
                try {
                    const parsedData = parseLogData(data, path);
                    
                    if (!parsedData) return;
                    
                    switch (parsedData.type) {
                        case 'unique_id':
                            console.log(`Kit ${parsedData.uniqueId} kết nối qua ${path}`);
                            io.to('indexRoom').emit('kitConnected', {
                                uniqueId: parsedData.uniqueId,
                                comPort: path
                            });
                            break;
                            
                        case 'log_data':
                            await saveLogData(parsedData.data);
                            // Gửi dữ liệu mới đến các client
                            io.to('dashboardRoom').emit('newLogData', parsedData.data);
                            io.to('chartsRoom').emit('newChartData', {
                                kitUniqueId: parsedData.data.kitUniqueId,
                                rssi: parsedData.data.rssi,
                                lqi: parsedData.data.lqi,
                                timestamp: new Date()
                            });
                            break;
                            
                        case 'cli_response':
                            io.to('indexRoom').emit('cliResponse', {
                                comPort: path,
                                response: parsedData.data
                            });
                            break;
                    }
                } catch (error) {
                    console.error(`Lỗi khi xử lý dữ liệu từ ${path}:`, error);
                }
            });
        });

        port.on('error', err => {
            console.error(`Lỗi cổng ${path}:`, err.message);
            connectedPorts.delete(path);
            kitUniqueIds.delete(path);
            updateKitStatus(path, 'offline');
            updateComList(io);
        });

        port.on('close', () => {
            console.log(`Cổng ${path} đã đóng`);
            connectedPorts.delete(path);
            kitUniqueIds.delete(path);
            updateKitStatus(path, 'offline');
            updateComList(io);
        });

    } catch (error) {
        console.error(`Lỗi khi khởi tạo cổng ${path}:`, error.message);
    }
}

async function updateComList(io) {
    try {
        const kits = await require('./database').getAllKits();
        io.to('indexRoom').emit('kitsList', kits);
    } catch (error) {
        console.error('Lỗi khi cập nhật danh sách kits:', error);
    }
}

function sendCliCommand(comPort, command) {
    const port = connectedPorts.get(comPort);
    if (port && port.isOpen) {
        port.write(`${command}\r\n`);
        return true;
    }
    return false;
}

// Hàm monitor ports - đây là hàm bị thiếu
async function monitorPorts(io) {
    console.log('Bắt đầu monitor cổng COM...');
    
    // Quét cổng COM định kỳ
    setInterval(async () => {
        try {
            const ports = await SerialPort.list();
            
            // Tìm các cổng có thể là kit Silab
            const silabPorts = ports.filter(port => {
                // Lọc theo vendor ID của Silab hoặc tên cổng
                return port.vendorId === '10C4' || // Silicon Labs VID
                       port.manufacturer?.toLowerCase().includes('silicon') ||
                       port.manufacturer?.toLowerCase().includes('silab');
            });
            
            // Kết nối đến các cổng mới
            for (const port of silabPorts) {
                if (!connectedPorts.has(port.path)) {
                    console.log(`Phát hiện cổng mới: ${port.path}`);
                    await connectToPort(port.path, io);
                }
            }
            
            // Kiểm tra các cổng đã ngắt kết nối
            const currentPaths = silabPorts.map(p => p.path);
            for (const [path, port] of connectedPorts) {
                if (!currentPaths.includes(path)) {
                    console.log(`Cổng ${path} đã bị ngắt kết nối`);
                    port.close();
                }
            }
            
        } catch (error) {
            console.error('Lỗi khi quét cổng COM:', error);
        }
    }, 2000); // Quét mỗi 2 giây
    
    // Quét lần đầu
    try {
        const ports = await SerialPort.list();
        console.log('Danh sách cổng COM có sẵn:');
        ports.forEach(port => {
            console.log(`- ${port.path}: ${port.manufacturer || 'Unknown'}`);
        });
        
        // Kết nối đến các cổng Silab
        const silabPorts = ports.filter(port => {
            return port.vendorId === '10C4' || 
                   port.manufacturer?.toLowerCase().includes('silicon') ||
                   port.manufacturer?.toLowerCase().includes('silab');
        });
        
        for (const port of silabPorts) {
            await connectToPort(port.path, io);
        }
        
    } catch (error) {
        console.error('Lỗi khi quét cổng COM lần đầu:', error);
    }
}

module.exports = { 
    connectToPort, 
    sendCliCommand, 
    updateComList,
    monitorPorts  // Thêm hàm này vào exports
};
