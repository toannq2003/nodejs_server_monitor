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
                com_port VARCHAR(50) NOT NULL,
                rssi INT NULL,
                lqi INT NULL,
                crc_passed BOOLEAN NULL,
                INDEX idx_timestamp (timestamp),
                INDEX idx_kit_unique (kit_unique),
                INDEX idx_type (type)
            )
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

        return pool;
    } catch (err) {
        console.error('Lỗi khi khởi tạo cơ sở dữ liệu:', err);
        throw err;
    }
}

const poolPromise = initializeDatabase();

async function savePacketData({ type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort, rssi, lqi, crcPassed }) {
    const pool = await poolPromise;
    
    // Kiểm tra xem có phải RX packet không (chỉ RX mới có rssi, lqi, crc_passed)
    if (type === 'RX' && (rssi !== undefined || lqi !== undefined || crcPassed !== undefined)) {
        // Lưu packet RX với đầy đủ thông tin
        const query = `
            INSERT INTO packet_data (type, packet_length, packet_data, kit_unique, error_code, is_ack, channel, com_port, rssi, lqi, crc_passed, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await pool.execute(query, [type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort, rssi || null, lqi || null, crcPassed || null]);
    } else {
        // Lưu packet TX chỉ với thông tin cơ bản
        const query = `
            INSERT INTO packet_data (type, packet_length, packet_data, kit_unique, error_code, is_ack, channel, com_port, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;
        await pool.execute(query, [type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort]);
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
        'SELECT * FROM packet_data ORDER BY timestamp DESC LIMIT 1000'
    );
    return rows;
}

async function getAllKits() {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM kits ORDER BY last_seen DESC'
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
    let query = 'SELECT * FROM packet_data WHERE 1=1';
    const params = [];
    
    if (filters.type) {
        query += ' AND type = ?';
        params.push(filters.type);
    }
    
    if (filters.kit_unique) {
        query += ' AND kit_unique = ?';
        params.push(filters.kit_unique);
    }
    
    if (filters.com_port) {
        query += ' AND com_port = ?';
        params.push(filters.com_port);
    }
    
    if (filters.search) {
        query += ' AND packet_data LIKE ?';
        params.push(`%${filters.search}%`);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(filters.limit || 1000);
    
    const [rows] = await pool.execute(query, params);
    return rows;
}

module.exports = {
    savePacketData,
    getAllPacketData,
    getFilteredPacketData, // Thêm function mới
    getAllKits,
    updateKitStatus,
    updateOrInsertKit
};

