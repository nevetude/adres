const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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