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

        // Tạo bảng com_data nếu chưa tồn tại
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS com_data (
                id INT AUTO_INCREMENT PRIMARY KEY,
                com_port VARCHAR(50),
                addr_ipv6 VARCHAR(50),
                rssi INT,
                lqi INT,
                crc VARCHAR(50),
                raw_data TEXT,
                timestamp DATETIME
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

async function saveComData({ comPort, addrIpv6, rssi, lqi, crc, rawData }) {
    const pool = await poolPromise;
    const query = `
        INSERT INTO com_data (com_port, addr_ipv6, rssi, lqi, crc, raw_data, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    await pool.execute(query, [comPort, addrIpv6, rssi, lqi, crc, rawData]);
}

async function getComData(comPort) {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT * FROM com_data WHERE com_port = ?',
        [comPort]
    );
    return rows;
}

async function getAllComDataForCharts() {
    const pool = await poolPromise;
    const [rows] = await pool.execute(
        'SELECT com_port AS comPort, rssi, lqi, timestamp FROM com_data ORDER BY timestamp'
    );
    return rows;
}

module.exports = { saveComData, getComData, getAllComDataForCharts };