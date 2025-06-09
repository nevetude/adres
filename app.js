require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const { pool, runQuery } = require('./db');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const app = express();

// Настройка загрузки файлов
const upload = multer({ dest: 'public/images/' });
const receiptsDir = path.join(__dirname, 'public/receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}

// Инициализация структуры базы данных для PostgreSQL
const initializeDatabase = async () => {
    try {
        // Проверяем соединение с БД
        await pool.query('SELECT 1');
        console.log('Successfully connected to PostgreSQL database');
        // Создание таблиц с синтаксисом PostgreSQL
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price NUMERIC(10,2) NOT NULL CHECK(price >= 0),
                old_price NUMERIC(10,2) CHECK(old_price IS NULL OR old_price >= 0),
                category TEXT NOT NULL,
                gender TEXT NOT NULL,
                image TEXT DEFAULT 'default.jpg',
                quantity INTEGER DEFAULT 0 CHECK(quantity >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                UNIQUE(user_id, product_id)
            )`,
            `CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                last_name TEXT NOT NULL,
                first_name TEXT NOT NULL,
                middle_name TEXT,
                phone TEXT NOT NULL,
                postal_code TEXT NOT NULL,
                region TEXT NOT NULL,
                city TEXT NOT NULL,
                street TEXT NOT NULL,
                building_number TEXT NOT NULL,
                apartment_number TEXT,
                comment TEXT,
                total NUMERIC(10,2) NOT NULL CHECK(total >= 0),
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'cancelled')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL CHECK(quantity > 0),
                price NUMERIC(10,2) NOT NULL CHECK(price >= 0),
                size TEXT DEFAULT 'N/A'
            )`,
            `CREATE TABLE IF NOT EXISTS user_carts (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                cart_data TEXT
            )`
        ];

        // Проверяем существование таблиц перед созданием
        const { rows: existingTables } = await runQuery(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"    
        );

        if (existingTables.length === 0) {
            for (const table of tables) {
                await runQuery(table);
            }

            // Добавление тестовых данных
            const initialProducts = [
                ['CRYSQUAD T-shirt', 'Черная футболка с логотипом CRYSQUAD', 1999, 2499, 'Футболки', 'Мужское', 'tshirt1.jpg', 10],
                ['WHITENER Casper', 'Черная футболка с принтом Casper', 1999, 2499, 'Футболки', 'Женское', 'tshirt_whitener.jpg', 15],
                ['AQUAKEY SWORD', 'Черная футболка с принтом', 3999, 4499, 'Свитшоты', 'Мужское', 'tshirt_aquakey.jpg', 8],
                ['Haru Matsui', 'Черная футболка с принтом', 3999, 4499, 'Свитшоты', 'Женское', 'tshirt_hm.jpg', 5],
                ['Black Basic', 'Базовая черная футболка', 1499, null, 'Футболки', 'Мужское', 'black.jpg', 20],
                ['White Basic', 'Базовая белая футболка', 1499, null, 'Футболки', 'Женское', 'white.jpg', 15]
            ];

            for (const product of initialProducts) {
                await runQuery(
                    `INSERT INTO products 
                    (name, description, price, old_price, category, gender, image, quantity) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    product
                );
            }

            console.log(`Added ${initialProducts.length} sample products`);

            // Добавление администратора
            const { rows: [{ count }] } = await runQuery(
                "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
            );

            if (parseInt(count) === 0) {
                const hashedPassword = bcrypt.hashSync('admin', 10);
                await runQuery(
                    "INSERT INTO users (email, name, password, role) VALUES ($1, $2, $3, $4)",
                    ['admin@adres.com', 'Admin', hashedPassword, 'admin']
                );
                console.log("Admin user created");
            }
        }

        console.log('Database initialization complete');
    } catch (err) {
        console.error('Database initialization error:', err);
        process.exit(1);
    }
};

// Настройка сессии с учетом продакшена
const isProduction = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1); // Важно для работы за прокси

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 60 // Очистка старых сессий каждый час
    }),
    secret: process.env.SESSION_SECRET || 'adres_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/',
        domain: isProduction ? 'adres-i9tk.onrender.com' : undefined // Ваш домен Render.com
    },
    name: 'app.sid'
}));

app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/receipts', express.static(path.join(__dirname, 'public/receipts')));

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.set('views', [
    path.join(__dirname, 'views'),
    path.join(__dirname, 'views/admin'),
    path.join(__dirname, 'views/auth'),
    path.join(__dirname, 'views/error'),
    path.join(__dirname, 'views/product'),
    path.join(__dirname, 'views/partials')
]);

// Middleware для сессии
app.use(async (req, res, next) => {
    try {
        res.locals.user = req.session.user;
        res.locals.cart = req.session.cart || [];
        
        if (req.session.user) {
            const { rows: favorites } = await runQuery(
                "SELECT p.* FROM favorites f JOIN products p ON f.product_id = p.id WHERE f.user_id = $1",
                [req.session.user.id]
            );
            res.locals.favorites = favorites;
        } else {
            req.session.cart = [];
            res.locals.favorites = [];
        }
        
        next();
    } catch (err) {
        next(err);
    }
});

// Подключение маршрутов
app.use('/', require('./routes/api'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/cart', require('./routes/cart'));

// Обработка ошибок
app.use((req, res) => {
    res.status(404).render('error', { 
        message: 'Страница не найдена',
        status: 404
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).render('error', { 
        message: 'Внутренняя ошибка сервера',
        status: 500,
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Запуск сервера
const startServer = async () => {
    try {
        await initializeDatabase();
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Database URL: ${process.env.DATABASE_URL}`);
            console.log(`Session secure: ${isProduction}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

process.on('SIGINT', async () => {
    await pool.end();
    console.log('PostgreSQL connection pool closed');
    process.exit(0);
});

module.exports = { app };
startServer();