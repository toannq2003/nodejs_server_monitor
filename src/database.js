const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function initializeDatabase() {
    const rootPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_ROOT_USER,
        password: process.env.DB_ROOT_PASSWORD
    });

    try {
        await rootPool.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        await rootPool.execute(`
            CREATE USER IF NOT EXISTS '${process.env.DB_USER}'@'${process.env.DB_HOST}'
            IDENTIFIED BY '${process.env.DB_PASSWORD}'
        `);
        await rootPool.execute(`
            GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.*
            TO '${process.env.DB_USER}'@'${process.env.DB_HOST}'
        `);
        await rootPool.end();

        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // Tạo bảng packet_data
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS packet_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                type VARCHAR(10) NOT NULL,
                packet_length INT NOT NULL,
                packet_data TEXT NOT NULL,
                kit_unique VARCHAR(50) NOT NULL,
                error_code INT NOT NULL,
                is_ack BOOLEAN NOT NULL,
                channel INT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                kit_timestamp BIGINT NULL,  -- Thêm cột mới cho timestamp từ kit
                com_port VARCHAR(50) NOT NULL,
                rssi INT NULL,
                lqi INT NULL,
                crc_passed BOOLEAN NULL,
                INDEX idx_timestamp (timestamp),
                INDEX idx_kit_unique (kit_unique),
                INDEX idx_type (type)
            )
        `);

        // 2. Tạo VIEW bảng packet_data với các trường đã đổi tên
        await pool.execute(`
        CREATE OR REPLACE VIEW v_packet_data AS
        SELECT 
            id,
            type,
            packet_length AS packetLength,
            packet_data AS packetData,
            kit_unique AS kitUnique,
            error_code AS errorCode,
            is_ack AS isAck,
            channel,
            timestamp,
            kit_timestamp AS kitTimestamp,
            com_port AS comPort,
            rssi,
            lqi,
            crc_passed AS crcPassed
        FROM packet_data
        `);

        // Tạo bảng kits để quản lý danh sách kit
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS kits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                kit_unique VARCHAR(50) UNIQUE NOT NULL,
                com_port VARCHAR(50) NOT NULL,
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                status ENUM('online', 'offline') DEFAULT 'online',
                packet_count INT DEFAULT 0,
                INDEX idx_kit_unique (kit_unique),
                INDEX idx_status (status)
            )
        `);



        // 2. Tạo VIEW bảng kits với các trường đã đổi tên
        await pool.execute(`
        CREATE OR REPLACE VIEW v_kits AS
        SELECT
            id,
            kit_unique AS kitUnique,
            com_port AS comPort,
            last_seen AS lastSeen,
            status,
            packet_count AS packetCount
        FROM kits;
        `);

        console.log(`Tạo view thành công`);




        

        return pool;
    } catch (err) {
        console.error('Lỗi khi khởi tạo cơ sở dữ liệu:', err);
        throw err;
    }
}

const poolPromise = initializeDatabase();

async function savePacketData({ type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort, kitTimestamp, rssi, lqi, crcPassed }) {
    const pool = await poolPromise;
    
    // Kiểm tra xem có phải RX packet không (chỉ RX mới có rssi, lqi, crc_passed)
    if (type === 'RX' && (rssi !== undefined || lqi !== undefined || crcPassed !== undefined)) {
        // Lưu packet RX với đầy đủ thông tin
        const query = `
            INSERT INTO packet_data (type, packet_length, packet_data, kit_unique, error_code, is_ack, channel, com_port, kit_timestamp, rssi, lqi, crc_passed, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await pool.execute(query, [type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort, kitTimestamp, rssi || null, null || lqi, null || crcPassed]);
    } else {
        // Lưu packet TX chỉ với thông tin cơ bản
        const query = `
            INSERT INTO packet_data (type, packet_length, packet_data, kit_unique, error_code, is_ack, channel, com_port, kit_timestamp, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await pool.execute(query, [type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort, kitTimestamp]);
    }
    
    // Cập nhật hoặc thêm kit
    await updateOrInsertKit(kitUnique, comPort);
}


async function updateOrInsertKit(kitUnique, comPort) {
    const pool = await poolPromise;
    
    // Kiểm tra kit đã tồn tại chưa
    const [existing] = await pool.execute(
        'SELECT id, packet_count FROM kits WHERE kit_unique = ?',
        [kitUnique]
    );
    
    if (existing.length > 0) {
        // Cập nhật kit hiện có
        await pool.execute(`
            UPDATE kits 
            SET com_port = ?, last_seen = NOW(), status = 'online', packet_count = packet_count + 1
            WHERE kit_unique = ?
        `, [comPort, kitUnique]);
    } else {
        // Thêm kit mới
        await pool.execute(`
            INSERT INTO kits (kit_unique, com_port, last_seen, status, packet_count)
            VALUES (?, ?, NOW(), 'online', 1)
        `, [kitUnique, comPort]);
    }
}

async function getAllPacketData() {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM v_packet_data ORDER BY timestamp DESC LIMIT 1000'
    );
    // console.table(rows);
    return rows;
}

async function getAllKits() {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM v_kits ORDER BY lastSeen DESC'
    );
    return rows;
}

async function updateKitStatus(comPort, status) {
    const pool = await poolPromise;
    await pool.execute(
        'UPDATE kits SET status = ?, last_seen = NOW() WHERE com_port = ?',
        [status, comPort]
    );
}

// Thêm function lấy dữ liệu với filter
async function getFilteredPacketData(filters = {}) {
    const pool = await poolPromise;
    let query = 'SELECT * FROM v_packet_data WHERE 1=1';
    const params = [];
    
    if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
    }
    
    if (filters.kit_unique) {
        query += ' AND kitUnique = ?';
        params.push(filters.kitUnique);
    }
    
    if (filters.com_port) {
        query += ' AND comPort = ?';
        params.push(filters.comPort);
    }
    
    if (filters.search) {
        query += ' AND packetData LIKE ?';
        params.push(`%${filters.search}%`);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(filters.limit || 1000);
    
    const [rows] = await pool.execute(query, params);
    return rows;
}

// Thêm vào cuối file database.js, trước module.exports

async function getKitStatistics(kitUnique) {
    const pool = await poolPromise;
    
    try {
        // Lấy thông tin kit
        const [kitInfo] = await pool.execute(
            'SELECT * FROM v_kits WHERE kitUnique = ?',
            [kitUnique]
        );

        console.log(kitInfo[0].lastSeen);
        
        if (kitInfo.length === 0) {
            throw new Error('Kit không tồn tại');
        }
        
        // Thống kê tổng quan
        const [totalStats] = await pool.execute(`
            SELECT 
                COUNT(*) as totalPackets,
                SUM(CASE WHEN type = 'TX' AND is_ack = 0 THEN 1 ELSE 0 END) as dataTxPackets,
                SUM(CASE WHEN type = 'RX' AND is_ack = 0 THEN 1 ELSE 0 END) as dataRxPackets,
                SUM(CASE WHEN type = 'TX' AND is_ack = 1 THEN 1 ELSE 0 END) as ackTxPackets,
                SUM(CASE WHEN type = 'RX' AND is_ack = 1 THEN 1 ELSE 0 END) as ackRxPackets,
                SUM(CASE WHEN is_ack = 1 THEN 1 ELSE 0 END) as ackPackets
            FROM packet_data 
            WHERE kit_unique = ?
        `, [kitUnique]);
        
        // Thống kê RX (PER, RSSI, LQI)
        const [rxStats] = await pool.execute(`
            SELECT 
                COUNT(*) as totalRxPackets,
                SUM(CASE WHEN error_code = 1 THEN 1 ELSE 0 END) as crcFailedPackets,
                AVG(CASE WHEN rssi IS NOT NULL THEN rssi END) as avgRssi,
                MIN(CASE WHEN rssi IS NOT NULL THEN rssi END) as minRssi,
                MAX(CASE WHEN rssi IS NOT NULL THEN rssi END) as maxRssi,
                AVG(CASE WHEN lqi IS NOT NULL THEN lqi END) as avgLqi
            FROM packet_data 
            WHERE kit_unique = ? AND type = 'RX'
        `, [kitUnique]);
        
        // Thống kê lỗi TX
        const [txErrors] = await pool.execute(`
            SELECT errorCode, COUNT(*) as count
            FROM v_packet_data 
            WHERE kitUnique = ? AND type = 'TX'
            GROUP BY errorCode
            ORDER BY errorCode
        `, [kitUnique]);
        
        // Thống kê lỗi RX
        const [rxErrors] = await pool.execute(`
            SELECT errorCode, COUNT(*) as count
            FROM v_packet_data 
            WHERE kitUnique = ? AND type = 'RX'
            GROUP BY errorCode
            ORDER BY errorCode
        `, [kitUnique]);
        
        // Tính toán PER
        const totalRx = rxStats[0].totalRxPackets || 0;
        const crcFailed = rxStats[0].crcFailedPackets || 0;
        const per = totalRx > 0 ? ((crcFailed / totalRx) * 100).toFixed(2) : 0;
        
        
        // Chuẩn bị dữ liệu trả về
        const stats = {
            totalPackets: totalStats[0].totalPackets || 0,
            dataTxPackets: totalStats[0].dataTxPackets || 0,
            dataRxPackets: totalStats[0].dataRxPackets || 0,
            ackTxPackets: totalStats[0].ackTxPackets || 0,
            ackRxPackets: totalStats[0].ackRxPackets || 0,
            per: per,
            avgRssi: parseFloat(rxStats[0].avgRssi || '0').toFixed(2),
            minRssi: rxStats[0].minRssi || 0,
            maxRssi: rxStats[0].maxRssi || 0,
            avgLqi: parseFloat(rxStats[0].avgLqi || '0').toFixed(2),
            txErrors: {},
            rxErrors: {}
        };

        // Log chi tiết để kiểm tra
console.log('avgRssi value:', rxStats[0].avgRssi);
console.log('avgRssi type:', typeof rxStats[0].avgRssi);
console.log('avgRssi constructor:', rxStats[0].avgRssi.constructor.name);
console.log('Is Number?', rxStats[0].avgRssi instanceof Number);
        
        // Chuyển đổi lỗi thành object
        txErrors.forEach(error => {
            stats.txErrors[error.errorCode] = error.count;
        });
        
        rxErrors.forEach(error => {
            stats.rxErrors[error.errorCode] = error.count;
        });
        
        return {
            kitInfo: kitInfo[0],
            stats: stats
        };
        
    } catch (error) {
        console.error('Lỗi khi lấy thống kê kit:', error);
        throw error;
    }
}

// Cập nhật module.exports
module.exports = {
    savePacketData,
    getAllPacketData,
    getFilteredPacketData,
    getAllKits,
    updateKitStatus,
    updateOrInsertKit,
    getKitStatistics // Thêm function mới
};


