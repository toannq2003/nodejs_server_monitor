const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function initializeDatabase() {
    console.log('Bắt đầu khởi tạo cơ sở dữ liệu...');
    console.log('Thông tin kết nối:', {
        host: process.env.DB_HOST,
        user: process.env.DB_ROOT_USER,
        password: process.env.DB_ROOT_PASSWORD,
        database: process.env.DB_NAME
    });

    // Kết nối với MySQL bằng tài khoản root
    console.log('Kết nối với MySQL bằng tài khoản root...');
    const rootPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_ROOT_USER,
        password: process.env.DB_ROOT_PASSWORD
    });
    console.log('Kết nối root thành công.');

    try {
        // Tạo cơ sở dữ liệu nếu chưa tồn tại
        console.log(`Tạo cơ sở dữ liệu ${process.env.DB_NAME} nếu chưa tồn tại...`);
        await rootPool.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        console.log(`Cơ sở dữ liệu ${process.env.DB_NAME} đã được tạo hoặc đã tồn tại.`);

        // Tạo tài khoản người dùng nếu chưa tồn tại
        console.log(`Tạo tài khoản người dùng ${process.env.DB_USER} nếu chưa tồn tại...`);
        await rootPool.query(`
            CREATE USER IF NOT EXISTS '${process.env.DB_USER}'@'${process.env.DB_HOST}'
            IDENTIFIED BY '${process.env.DB_PASSWORD}'
        `);
        console.log(`Tài khoản ${process.env.DB_USER} đã được tạo hoặc đã tồn tại.`);

        // Cấp quyền cho người dùng
        console.log(`Cấp quyền cho ${process.env.DB_USER}...`);
        await rootPool.query(`
            GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* 
            TO '${process.env.DB_USER}'@'${process.env.DB_HOST}'
        `);
        console.log(`Quyền đã được cấp cho ${process.env.DB_USER}.`);

        // Đóng kết nối root
        console.log('Đóng kết nối root...');
        await rootPool.end();
        console.log('Kết nối root đã đóng.');

        // Kết nối tới cơ sở dữ liệu với tài khoản người dùng
        console.log('Kết nối tới cơ sở dữ liệu với tài khoản người dùng...');
        const pool = mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        console.log('Kết nối với tài khoản người dùng thành công.');
        console.log('Pool được tạo:', pool);

        // Tạo bảng com_data nếu chưa tồn tại
        console.log('Tạo bảng com_data nếu chưa tồn tại...');
        const connection = await pool.getConnection();
        try {
            await connection.query(`
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
            console.log('Bảng com_data đã được tạo hoặc đã tồn tại.');
        } finally {
            connection.release();
        }

        return pool;
    } catch (err) {
        console.error('Lỗi khi khởi tạo cơ sở dữ liệu:', err);
        throw err;
    }
}

const poolPromise = initializeDatabase();

async function saveComData({ comPort, addrIpv6, rssi, lqi, crc, rawData }) {
    const pool = await poolPromise;
    console.log('saveComData: Pool đã sẵn sàng.');
    const connection = await pool.getConnection();
    try {
        const query = `
            INSERT INTO com_data (com_port, addr_ipv6, rssi, lqi, crc, raw_data, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `;
        await connection.query(query, [comPort, addrIpv6, rssi, lqi, crc, rawData]);
    } finally {
        connection.release();
    }
}

async function getComData(comPort) {
    const pool = await poolPromise;
    console.log('getComData: Pool đã sẵn sàng.');
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            'SELECT * FROM com_data WHERE com_port = ?',
            [comPort]
        );
        return rows;
    } finally {
        connection.release();
    }
}

async function getAllComDataForCharts() {
    const pool = await poolPromise;
    console.log('getAllComDataForCharts: Pool đã sẵn sàng.');
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            'SELECT com_port AS comPort, rssi, lqi, timestamp FROM com_data ORDER BY timestamp'
        );
        return rows;
    } finally {
        connection.release();
    }
}

module.exports = { saveComData, getComData, getAllComDataForCharts };