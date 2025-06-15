// database.js
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

        // Tạo bảng kits để lưu thông tin kit
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS kits (
                id INT AUTO_INCREMENT PRIMARY KEY,
                unique_id VARCHAR(100) UNIQUE NOT NULL,
                com_port VARCHAR(50),
                last_seen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                status ENUM('online', 'offline') DEFAULT 'online',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Cập nhật bảng log_data với mã định danh và thời gian server
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS log_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                kit_unique_id VARCHAR(100) NOT NULL,
                com_port VARCHAR(50),
                log_type ENUM('TX', 'TXE', 'RX') NOT NULL,
                length INT,
                data_hex TEXT,
                is_ack BOOLEAN,
                channel INT,
                rssi INT,
                lqi INT,
                crc_passed BOOLEAN,
                error_code INT,
                kit_timestamp BIGINT,
                server_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_kit_id (kit_unique_id),
                INDEX idx_timestamp (server_timestamp),
                FOREIGN KEY (kit_unique_id) REFERENCES kits(unique_id) ON DELETE CASCADE
            )
        `);

        return pool;
    } catch (err) {
        console.error('Lỗi khi khởi tạo cơ sở dữ liệu:', err);
        throw err;
    }
}

const poolPromise = initializeDatabase();

// Lưu thông tin kit
async function saveKitInfo(uniqueId, comPort) {
    const pool = await poolPromise;
    await pool.execute(`
        INSERT INTO kits (unique_id, com_port, status) 
        VALUES (?, ?, 'online')
        ON DUPLICATE KEY UPDATE 
        com_port = VALUES(com_port), 
        status = 'online',
        last_seen = CURRENT_TIMESTAMP
    `, [uniqueId, comPort]);
}

// Cập nhật trạng thái kit
async function updateKitStatus(comPort, status) {
    const pool = await poolPromise;
    await pool.execute(
        'UPDATE kits SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE com_port = ?',
        [status, comPort]
    );
}

// Lưu dữ liệu log
async function saveLogData(logData) {
    const pool = await poolPromise;
    const query = `
        INSERT INTO log_data (
            kit_unique_id, com_port, log_type, length, data_hex, 
            is_ack, channel, rssi, lqi, crc_passed, error_code, kit_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    await pool.execute(query, [
        logData.kitUniqueId, logData.comPort, logData.logType,
        logData.length, logData.dataHex, logData.isAck, logData.channel,
        logData.rssi, logData.lqi, logData.crcPassed, logData.errorCode,
        logData.kitTimestamp
    ]);
}

// Lấy danh sách kits
async function getAllKits() {
    const pool = await poolPromise;
    const [rows] = await pool.execute('SELECT * FROM kits ORDER BY last_seen DESC');
    return rows;
}

// Lấy dữ liệu log cho biểu đồ
async function getChartData(kitIds = null, timeRange = '24h') {
    const pool = await poolPromise;
    let query = `
        SELECT kit_unique_id, rssi, lqi, server_timestamp 
        FROM log_data 
        WHERE log_type IN ('TX', 'RX') AND rssi IS NOT NULL AND lqi IS NOT NULL
    `;
    
    const params = [];
    
    if (kitIds && kitIds.length > 0) {
        query += ` AND kit_unique_id IN (${kitIds.map(() => '?').join(',')})`;
        params.push(...kitIds);
    }
    
    // Thêm điều kiện thời gian
    switch (timeRange) {
        case '1h':
            query += ' AND server_timestamp >= DATE_SUB(NOW(), INTERVAL 1 HOUR)';
            break;
        case '24h':
            query += ' AND server_timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)';
            break;
        case '7d':
            query += ' AND server_timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
            break;
    }
    
    query += ' ORDER BY server_timestamp ASC';
    
    const [rows] = await pool.execute(query, params);
    return rows;
}

module.exports = { 
    saveKitInfo, 
    updateKitStatus, 
    saveLogData, 
    getAllKits, 
    getChartData 
};
