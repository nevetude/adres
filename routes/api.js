const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Преобразование данных продукта
const transformProduct = (product) => ({
    ...product,
    price: Number(product.price),
    old_price: product.old_price ? Number(product.old_price) : null
});

router.get('/favorites', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login?redirect=/favorites');
    }
    
    try {
        const { rows } = await pool.query(`
            SELECT p.*, p.price::numeric, p.old_price::numeric 
            FROM favorites f 
            JOIN products p ON f.product_id = p.id 
            WHERE f.user_id = $1
        `, [req.session.user.id]);
        
        res.render('product/favorites', {
            title: 'Избранное',
            favorites: rows.map(p => ({
                ...p,
                price: Number(p.price),
                old_price: p.old_price ? Number(p.old_price) : null
            }))
        });
    } catch (err) {
        console.error('Ошибка загрузки избранного:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке избранного',
            status: 500
        });
    }
});

// Главная страница
router.get('/', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT *, price::numeric, old_price::numeric 
            FROM products 
            ORDER BY created_at DESC 
            LIMIT 4
        `);
        
        res.render('index', { 
            title: 'Главная',
            products: rows.map(transformProduct)
        });
    } catch (err) {
        console.error('Ошибка загрузки товаров:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке товаров',
            status: 500
        });
    }
});

// Все товары
router.get('/products', async (req, res) => {
    try {
        const { gender, category } = req.query;
        let query = "SELECT *, price::numeric, old_price::numeric FROM products";
        const params = [];
        
        if (gender || category) {
            query += " WHERE";
            if (gender) {
                query += " gender = $1";
                params.push(gender);
            }
            if (gender && category) {
                query += " AND";
            }
            if (category) {
                query += ` category = $${params.length + 1}`;
                params.push(category);
            }
        }
        query += " ORDER BY created_at DESC";
        
        const { rows } = await pool.query(query, params);
        
        res.render('product/products', {
            title: 'Все товары',
            products: rows.map(transformProduct),
            gender,
            category
        });
    } catch (err) {
        console.error('Ошибка загрузки товаров:', err);
        res.status(500).render('error', { 
            message: 'Ошибка при загрузке товаров',
            status: 500
        });
    }
});

// Мужские товары
router.get('/men', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT *, price::numeric, old_price::numeric 
            FROM products 
            WHERE gender = 'Мужское' 
            ORDER BY created_at DESC
        `);
        
        res.render('product/products', {
            title: 'Мужское',
            products: rows.map(transformProduct),
            gender: 'Мужское'
        });
    } catch (err) {
        console.error('Ошибка загрузки мужских товаров:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке товаров',
            status: 500
        });
    }
});

// Женские товары
router.get('/women', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT *, price::numeric, old_price::numeric 
            FROM products 
            WHERE gender = 'Женское' 
            ORDER BY created_at DESC
        `);
        
        res.render('product/products', {
            title: 'Женское',
            products: rows.map(transformProduct),
            gender: 'Женское'
        });
    } catch (err) {
        console.error('Ошибка загрузки женских товаров:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке товаров',
            status: 500
        });
    }
});

// Товары по категории
router.get('/category/:gender/:category', async (req, res) => {
    try {
        const { gender, category } = req.params;
        const { rows } = await pool.query(`
            SELECT *, price::numeric, old_price::numeric 
            FROM products 
            WHERE gender = $1 AND category = $2
        `, [gender, category]);
        
        res.render('product/products', {
            title: `${gender} ${category}`,
            products: rows.map(transformProduct),
            gender,
            category
        });
    } catch (err) {
        console.error('Ошибка загрузки категории:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке категории',
            status: 500
        });
    }
});

// Страница товара
router.get('/product/:id', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT *, price::numeric, old_price::numeric 
            FROM products 
            WHERE id = $1
        `, [req.params.id]);
        
        if (!rows.length) return res.redirect('/');
        
        res.render('product/product', {
            title: rows[0].name,
            product: transformProduct(rows[0])
        });
    } catch (err) {
        console.error('Ошибка загрузки товара:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке товара',
            status: 500
        });
    }
});

// Проверка количества товара
router.post('/check-quantity', async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const { rows } = await pool.query(`
            SELECT quantity, name 
            FROM products 
            WHERE id = $1
        `, [productId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        
        const product = rows[0];
        if (product.quantity < quantity) {
            return res.json({ 
                error: `Доступно только ${product.quantity} шт. товара "${product.name}"` 
            });
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка проверки количества:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Список заказов
router.get('/orders', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    
    try {
        const { rows } = await pool.query(`
            SELECT 
                o.id, 
                o.created_at as "createdAt",
                o.status,
                o.total,
                (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as "productsCount"
            FROM orders o 
            WHERE user_id = $1 
            ORDER BY created_at DESC
        `, [req.session.user.id]);
        
        const statusMap = {
            'pending': 'Новый',
            'processing': 'В обработке',
            'completed': 'Завершен',
            'cancelled': 'Отменен'
        };
        
        const orders = rows.map(order => ({
            ...order,
            status: statusMap[order.status] || order.status,
            total: Number(order.total)
        }));
        
        res.render('order/orders', {
            orders,
            title: 'Мои заказы'
        });
    } catch (err) {
        console.error('Ошибка загрузки заказов:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке заказов',
            status: 500
        });
    }
});

// Детали заказа
router.get('/order/:id', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    
    try {
        const orderResult = await pool.query(`
            SELECT * 
            FROM orders 
            WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.session.user.id]);
        
        if (!orderResult.rows.length) {
            return res.status(404).render('error', {
                message: 'Заказ не найден',
                status: 404
            });
        }
        
        const order = {
            ...orderResult.rows[0],
            total: Number(orderResult.rows[0].total)
        };
        
        const itemsResult = await pool.query(`
            SELECT 
                oi.*, 
                p.name as product_name,
                p.image,
                p.price::numeric as product_price
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = $1
        `, [req.params.id]);
        
        const items = itemsResult.rows.map(item => ({
            ...item,
            price: Number(item.price)
        }));
        
        res.render('order/details', {
            title: `Заказ #${order.id}`,
            order,
            items
        });
    } catch (err) {
        console.error('Ошибка загрузки заказа:', err);
        res.status(500).render('error', {
            message: 'Ошибка при загрузке заказа',
            status: 500
        });
    }
});

module.exports = router;