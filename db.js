const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Обязательно для внешних серверов (например, Render)
  }
});

// Обработка ошибок подключения
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Функция для выполнения запросов
const runQuery = async (query, params) => {
  const client = await pool.connect();
  try {
    return await client.query(query, params);
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  runQuery
};



