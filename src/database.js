const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function initializeDatabase() {
    // Kết nối với MySQL bằng tài khoản root
    const rootPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_ROOT_USER,
        password: process.env.DB_ROOT_PASSWORD
    });

    try {
        // Tạo cơ sở dữ liệu nếu chưa tồn tại
        await rootPool.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);

        // Tạo tài khoản người dùng nếu chưa tồn tại
        await rootPool.execute(`
            CREATE USER IF NOT EXISTS '${process.env.DB_USER}'@'${process.env.DB_HOST}'
            IDENTIFIED BY '${process.env.DB_PASSWORD}'
        `);

        // Cấp quyền cho người dùng
        await rootPool.execute(`
            GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.*
            TO '${process.env.DB_USER}'@'${process.env.DB_HOST}'
        `);

        // Đóng kết nối root
        await rootPool.end();

        // Kết nối tới cơ sở dữ liệu với tài khoản người dùng
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // Tạo bảng packet_data mới thay thế com_data
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
                INDEX idx_timestamp (timestamp),
                INDEX idx_kit_unique (kit_unique),
                INDEX idx_type (type)
            )
        `);

        return pool;
    } catch (err) {
        console.error('Lỗi khi khởi tạo cơ sở dữ liệu:', err);
        throw err;
    }
}

// Khởi tạo pool khi module được tải
const poolPromise = initializeDatabase();

async function savePacketData({ type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort }) {
    const pool = await poolPromise;
    const query = `
        INSERT INTO packet_data (type, packet_length, packet_data, kit_unique, error_code, is_ack, channel, com_port, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await pool.execute(query, [type, packetLength, packetData, kitUnique, errorCode, isAck, channel, comPort]);
}

async function getAllPacketData() {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM packet_data ORDER BY timestamp DESC LIMIT 1000'
    );
    return rows;
}

async function getPacketDataByKit(kitUnique) {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM packet_data WHERE kit_unique = ? ORDER BY timestamp DESC',
        [kitUnique]
    );
    return rows;
}

module.exports = { savePacketData, getAllPacketData, getPacketDataByKit };
