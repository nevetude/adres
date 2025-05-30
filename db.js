const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: 'postgres', // Подключаемся к стандартной БД
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const runQuery = async (query, params = []) => {
    const client = await pool.connect();
    try {
        const res = await client.query(query, params);
        return res;
    } finally {
        client.release();
    }
};

module.exports = {
    pool,
    runQuery
};