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

async function connectToPort(path, io, clientComPorts) {

    if (connectedPorts.has(path)) {
        console.log(`Cổng ${path} đã được kết nối`);
        return;
    }

    const attempts = connectionAttempts.get(path) || 0;
    if (attempts >= 3) {
        connectionAttempts.delete(path); // Reset số lần thử
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
                
                // Thử lại sau 2 giây nếu chưa quá 3 lần
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

            //const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

            // parser.on('data', async (data) => {
            //     const buffer = Buffer.from(data);
            //     console.log(`[${path}] Dữ liệu nhận được:`, buffer.toString());
            //     try {
            //         const parsedData = {
            //             comPort: path,
            //             addrIpv6: 'fe80::1',
            //             rssi: -50,
            //             lqi: 100,
            //             crc: 'OK',
            //             rawData: data
            //         };
                    
            //         await saveComData(parsedData);

            //         // Gửi dữ liệu mới cho tất cả client để cập nhật đồ thị
            //         io.to('dashboardRoom').emit('newComData', parsedData);

            //         // Gửi đến các client quan tâm đến comPort này
            //         for (const [socketId, comPort] of clientComPorts) {
            //             if (comPort === parsedData.comPort) {
            //                 io.to(socketId).emit('comData', parsedData);
            //             }
            //         }
            //     } catch (error) {
            //         console.error(`Lỗi khi xử lý dữ liệu từ ${path}:`, error);
            //     }
            // });

            let state = "idle";
            let buffer = Buffer.alloc(0);
            let offset = 0;

            let type = 0, length = 0, totalLength = 0;

            port.on("data", (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);

                while (buffer.length > offset) {
                    switch (state) {
                        case "idle":
                            // Ưu tiên tìm nhị phân
                            if (buffer.length - offset < 2 ) break; // Chưa đủ để xác định

                            if (buffer[offset] === 0xAA && buffer[offset + 1] === 0x55) {
                                state = "binary";
                                console.log(`frame nhị phân  ${buffer.subarray(offset, offset + 2).toString('hex')}`);
                                continue;
                            } else if (buffer[offset] === 0x0D && buffer[offset + 1] === 0x0A) {
                                state = "string";
                                continue;
                            } else if (buffer[offset] === 0x3E && buffer[offset + 1] === 0x20) {
                                state = "> ";
                                continue;
                            } else {
                            // Nếu không khớp gì, nhảy qua 1 byte và tiếp tục
                                offset++;
                                continue;
                            }

                        case "string":
                        case "> ":
                            const line = buffer.subarray(0, offset + 2).toString();
                            console.log("String:", buffer.subarray(0, offset + 2).toString('hex'));
                            io.to('indexRoom').emit('cliResponse', { success: 1 , comPort : path, response: line });
                            buffer = buffer.subarray(offset + 2); // Cắt bỏ phần đã xử lý
                            state = "idle"; // Reset state sau khi xử lý chuỗi
                            offset = 0; // Reset offset sau khi xử lý chuỗi
                            continue;
                
                        case "binary":
                            if (buffer.length - offset < 4) break; // Chưa đủ xác định type
                            // Đọc type và length
                            type = buffer[offset + 2];
                            length = buffer[offset + 3] - 2;
                            console.log("Tính type, Length:", buffer.subarray(offset + 2, offset + 4).toString('hex'));
                            switch (type) {
                                case 0xFD:
                                    state = "binary_tx";
                                    totalLength = 2 + 1 + 1 + length + 1 + 1 + 2; // header + type + length + payload + isAck + channel + footer
                                    console.log(`Vô 0xFD type, Length: ${length}, totalLength ${totalLength}`);
                                    break;
                                case 0xF9:
                                    state = "binary_rx";
                                    totalLength = 2 + 1 + 1 + length + 1 + 1 + 1 + 1 + 1 + 2; // header + type + length + payload + isAck + channel + crc + rssi + lqi + footer
                                    console.log("Vô 0xF9 type, Length:", totalLength);
                                    break;
                                default:
                                    console.warn("Unknown binary type:", type);
                                    state = "idle";
                                    offset++;
                                    continue;
                            }

                        case "binary_tx":
                        case "binary_rx":
                            console.log("buffer.length - offset, offset:", buffer.length - offset, offset);
                            if (buffer.length - offset < totalLength) break; // Chưa đủ toàn bộ frame
                            console.log("Vô totalLength", buffer.subarray(offset + totalLength - 2, offset + totalLength).toString('hex'));
                            console.log("footer totalLength", buffer.subarray(offset, offset + totalLength).toString('hex'), buffer.subarray(offset, offset + totalLength).toString('hex').length);
                            // Kiểm tra footer
                            if (
                                buffer[offset + totalLength - 2] === 0x0D &&
                                buffer[offset + totalLength - 1] === 0x0A
                            ) {
                                let frame;
                                console.log("Vô footer");
                                //let info;
                                switch (state) {
                                    case "binary_tx":
                                        frame = buffer.subarray(offset + 3, offset + totalLength - 4);
                                        //info = buffer.subarray(offset + totalLength - 4, offset + totalLength - 2)
                                        console.log(`Frame nhị phân Tx ${type}: ${frame}\nRadio_Info: isAck ${buffer[offset + totalLength - 4]} channel ${buffer[offset + totalLength - 3]}`);
                                        //saveFrameToDatabase(type, frame, info); // Giả sử có hàm lưu frame vào DB
                                        //socket.emit('cliResponse', { comPort, command, response: frame.toString('hex') });
                                        break;
                                    case "binary_rx":
                                        frame = buffer.subarray(offset + 3, offset + totalLength - 7);
                                        //info = buffer.subarray(offset + totalLength - 7, offset + totalLength - 2)
                                        console.log(`Frame nhị phân Rx ${type}: ${frame}\nRadio_Info: isAck ${buffer[offset + totalLength - 7]} channel ${buffer[offset + totalLength - 6]} crc ${buffer[offset + totalLength - 5]} rssi ${buffer[offset + totalLength - 4]} lqi ${buffer[offset + totalLength - 3]}`);
                                        //saveFrameToDatabase(type, frame, info); // Giả sử có hàm lưu frame vào DB
                                        //socket.emit('cliResponse', { comPort, command, response: frame.toString('hex') });
                                        break;
                                } 
                                
                                const first = buffer.subarray(0, offset);
                                const second = buffer.subarray(offset + totalLength);
                                buffer = Buffer.concat([first, second]);
                                state = "idle";
                                continue; // Tiếp tục xử lý buffer mới với offset đó
                            } else {
                                // Lỗi đồng bộ, nhảy qua 1 byte
                                //buffer= buffer.subarray(offset + 2);
                                offset++;
                                console.log("Lỗi đồng bộ");
                                state = "idle"; // Reset state sau khi lỗi
                                continue;
                            }
                            
                        default:
                            console.error("Unknown state:", state);
                            offset++;
                            state = "idle"; // Reset state sau khi lỗi
                            continue;
                    }

                    break; // Đợi dữ liệu mới để tiêp tục do không đủ buffer
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