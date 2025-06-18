require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const pgSession = require('connect-pg-simple')(session);
const { pool, runQuery } = require('./db'); // Импортируем и pool, и runQuery
const app = express();

// Настройка загрузки файлов
const upload = multer({ dest: 'public/images/' });
const receiptsDir = path.join(__dirname, 'public/receipts');
if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
}

// Инициализация структуры базы данных (остается такой же как в оригинале)
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

        // Проверяем существование таблиц
        const { rows: existingTables } = await runQuery(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        );

        if (existingTables.length === 0) {
            for (const table of tables) {
                await runQuery(table);
            }

            // Добавление тестовых данных
            const initialProducts = [
                // Мужская коллекция (из папки man)
                ['Футболка Mono Vibe', 'Мужская футболка Mono Vibe', 1999, 2499, 'Футболки', 'Мужское', 'man/Футболка Mono Vibe.jpg', 10],
                ['Худи Collapse', 'Мужское худи Collapse', 3999, 4499, 'Худи', 'Мужское', 'man/Худи Collapse.jpg', 8],
                ['Рубашка Clean Frame', 'Мужская рубашка Clean Frame', 2999, 3499, 'Рубашки', 'Мужское', 'man/Рубашка Clean Frame.jpg', 7],
                ['Пиджак Bronze Signal', 'Мужской пиджак Bronze Signal', 5999, 6499, 'Пиджаки', 'Мужское', 'man/Пиджак Bronze Signal.jpg', 5],
                ['Пальто Grey Author', 'Мужское пальто Grey Author', 7999, 8499, 'Пальто', 'Мужское', 'man/Пальто Grey Author.jpg', 4],
                ['Джинсы Static Wash', 'Мужские джинсы Static Washing', 4999, 5499, 'Джинсы', 'Мужское', 'man/Джинсы Static Wash.jpg', 6],
                ['Брюки Line Step', 'Мужские брюки Line Step', 3499, 3999, 'Брюки', 'Мужское', 'man/Брюки Line Step.jpg', 5],
                
                // Женская коллекция (из папки woman)
                ['Футболка White Static', 'Женская футболка White Static', 1999, 2499, 'Футболки', 'Женское', 'woman/Футболка White Static.jpg', 12],
                ['Худи Noise Layer', 'Женское худи Noise Layer', 3999, 4499, 'Худи', 'Женское', 'woman/Худи Noise Layer.jpg', 9],
                ['Рубашка Void Collar', 'Женская рубашка Void Collar', 2999, 3499, 'Рубашки', 'Женское', 'woman/Рубашка Void Collar.jpg', 6],
                ['Куртка Smoke Signal', 'Женская куртка Smoke Signal', 5999, 6499, 'Куртки', 'Женское', 'woman/Куртка Smoke Signal.jpg', 4],
                ['Пальто Night Frame', 'Женское пальто Night Frame', 7999, 8499, 'Пальто', 'Женское', 'woman/Пальто Night Frame.jpg', 3],
                ['Джинсы Dustlight', 'Женские джинсы Dustlight', 4999, 5499, 'Джинсы', 'Женское', 'woman/Джинсы Dustlight.jpg', 7],
                ['Брюки Sharp Echo', 'Женские брюки Sharp Echo', 3499, 3999, 'Брюки', 'Женское', 'woman/Брюки Sharp Echo.jpg', 5],
                
                // Базовые товары (из корня)
                //['Black Basic', 'Базовая черная футболка', 1499, null, 'Футболки', 'Унисекс', 'black.jpg', 20],
                //['White Basic', 'Базовая белая футболка', 1499, null, 'Футболки', 'Унисекс', 'white.jpg', 15]
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

// Настройка сессии
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Для локального использования отключаем secure
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        path: '/'
    },
    name: 'app.sid'
}));

// Middleware
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

// Middleware для передачи данных в шаблоны
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

app.locals.formatPrice = (price) => {
    return Number(price).toFixed(2);
};
// Подключение маршрутов
app.use('/', require('./routes/api'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/cart', require('./routes/cart'));

// Обработка 404 и ошибок (остается такой же как в оригинале)
app.use((req, res) => {
    res.status(404).render('error', { 
        message: 'Страница не найдена',
        status: 404
    });
});

app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    
    if (err.message.includes('session')) {
        req.session.destroy(() => {
            res.clearCookie('app.sid', { path: '/' });
            return res.status(500).render('error', { 
                message: 'Ошибка сессии. Пожалуйста, попробуйте снова.',
                status: 500
            });
        });
    } else {
        res.status(500).render('error', { 
            message: 'Внутренняя ошибка сервера',
            status: 500,
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Инициализация и запуск сервера
const startServer = async () => {
    try {
        await initializeDatabase();
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log(`Admin credentials: admin@adres.com / admin`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
};

// Обработка завершения работы
process.on('SIGINT', async () => {
    await pool.end();
    console.log('PostgreSQL connection pool closed');
    process.exit(0);
});

module.exports = { app, pool, runQuery };
startServer();