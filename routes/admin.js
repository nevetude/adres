const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');

// Конфигурация Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/images')),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        mimetype && extname ? cb(null, true) : cb(new Error('Разрешены только изображения (jpeg, jpg, png, gif)'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

const isAdmin = (req, res, next) => {
    if (req.session.user?.role === 'admin') {
        return next();
    }
    res.redirect('/');
};


// Dashboard
router.get('/', isAdmin, async (req, res) => {
    try {
        const [productsResult, ordersCountResult] = await Promise.all([
            pool.query("SELECT * FROM products ORDER BY created_at DESC LIMIT 5"),
            pool.query("SELECT COUNT(*) as count FROM orders")
        ]);
        
        res.render('admin/dashboard', {
            title: 'Админ панель',
            products: productsResult.rows,
            ordersCount: ordersCountResult.rows[0]?.count || 0
        });
    } catch (err) {
        console.error('Error loading dashboard:', err);
        res.render('error/error', { message: 'Ошибка загрузки панели' });
    }
});

// Управление товарами
router.get('/products', isAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT 
                id, 
                name, 
                description, 
                price::numeric, 
                old_price::numeric, 
                category, 
                gender, 
                image, 
                quantity, 
                created_at
            FROM products 
            ORDER BY created_at DESC
        `);
        res.render('admin/products', { 
            title: 'Управление товарами', 
            products: rows.map(product => ({
                ...product,
                price: Number(product.price),
                old_price: product.old_price ? Number(product.old_price) : null
            }))
        });
    } catch (err) {
        console.error('Ошибка при загрузке товаров:', err);
        res.render('error/error', { message: 'Ошибка при загрузке товаров' });
    }
});

// Добавление товара
router.route('/products/add')
    .get(isAdmin, async (req, res) => {
        try {
            const { rows } = await pool.query("SELECT DISTINCT category FROM products");
            res.render('admin/add-product', { 
                title: 'Добавить товар',
                categories: rows.map(row => row.category)
            });
        } catch (err) {
            console.error('Ошибка при загрузке категорий:', err);
            res.render('error/error', { message: 'Ошибка при загрузке категорий' });
        }
    })
    .post(isAdmin, upload.single('image'), async (req, res) => {
        const { name, description, price, old_price, category, gender, quantity } = req.body;
        
        if (!name || !description || !price || !category || !gender) {
            return res.render('admin/add-product', {
                title: 'Добавить товар',
                categories: [],
                error: 'Заполните все обязательные поля',
                formData: req.body
            });
        }
        
        try {
            await pool.query(
                `INSERT INTO products (name, description, price, old_price, category, gender, image, quantity) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    name, 
                    description, 
                    parseFloat(price), 
                    old_price ? parseFloat(old_price) : null, 
                    category, 
                    gender, 
                    req.file?.filename || 'default.jpg', 
                    quantity
                ]
            );
            res.redirect('/admin/products');
        } catch (err) {
            console.error('Ошибка при добавлении товара:', err);
            res.render('admin/add-product', { 
                title: 'Добавить товар',
                categories: [],
                error: 'Ошибка при добавлении товара',
                formData: req.body
            });
        }
    });

// Редактирование товара
router.route('/products/edit/:id')
    .get(isAdmin, async (req, res) => {
        try {
            const [productResult, categoriesResult] = await Promise.all([
                pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]),
                pool.query("SELECT DISTINCT category FROM products")
            ]);
            
            if (!productResult.rows[0]) return res.redirect('/admin/products');
            
            res.render('admin/edit-product', { 
                title: 'Редактировать товар',
                product: productResult.rows[0],
                categories: categoriesResult.rows.map(row => row.category)
            });
        } catch (err) {
            console.error('Ошибка при загрузке товара или категорий:', err);
            res.redirect('/admin/products');
        }
    })
    .post(isAdmin, upload.single('image'), async (req, res) => {
        const { name, description, price, old_price, category, gender, existing_image, quantity } = req.body;
        
        if (!name || !description || !price || !category || !gender || quantity === undefined) {
            return res.render('admin/edit-product', {
                title: 'Редактировать товар',
                product: req.body,
                categories: [],
                error: 'Заполните все обязательные поля'
            });
        }
        
        try {
            await pool.query(
                `UPDATE products 
                 SET name = $1, description = $2, price = $3, old_price = $4, category = $5, 
                     gender = $6, image = $7, quantity = $8 
                 WHERE id = $9`,
                [
                    name, 
                    description, 
                    parseFloat(price), 
                    old_price ? parseFloat(old_price) : null, 
                    category, 
                    gender, 
                    req.file?.filename || existing_image || 'default.jpg', 
                    parseInt(quantity), 
                    req.params.id
                ]
            );
            res.redirect('/admin/products');
        } catch (err) {
            console.error('Ошибка при обновлении товара:', err);
            res.render('admin/edit-product', { 
                title: 'Редактировать товар',
                product: req.body,
                categories: [],
                error: 'Ошибка при обновлении товара'
            });
        }
    });

// Удаление товара
router.post('/products/delete/:id', isAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // First delete related order items
        await client.query("DELETE FROM order_items WHERE product_id = $1", [req.params.id]);
        
        // Then delete the product
        await client.query("DELETE FROM products WHERE id = $1", [req.params.id]);
        
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка при удалении товара:', err);
        return res.status(500).json({ error: 'Ошибка при удалении товара' });
    } finally {
        client.release();
    }
    res.redirect('/admin/products');
});

router.get('/orders', isAdmin, async (req, res) => {
    try {
        const { search } = req.query;
        let query = `
            SELECT 
                id, 
                created_at, 
                first_name, 
                last_name,
                phone, 
                postal_code,
                region,
                city,
                street,
                building_number,
                apartment_number,
                total::numeric, 
                status 
            FROM orders`;
        const params = [];
        
        if (search) {
            query += " WHERE id = $1";
            params.push(search);
        }
        
        query += " ORDER BY created_at DESC";
        const { rows } = await pool.query(query, params);
        
        res.render('admin/orders', {
            title: 'Управление заказами',
            orders: rows.map(order => ({ 
                ...order, 
                total: Number(order.total),
                address: `${order.city}, ${order.street}, ${order.building_number}${order.apartment_number ? ', кв. ' + order.apartment_number : ''}`
            })),
            search: search || ''
        });
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).render('error/error', { message: 'Ошибка при загрузке заказов' });
    }
});

// Обновление статуса заказа
router.post('/orders/update-status', isAdmin, async (req, res) => {
    try {
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [req.body.status, req.body.orderId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating order status:', err);
        res.status(500).json({ success: false, error: 'Ошибка обновления статуса' });
    }
});

// Детали заказа
router.get('/orders/:id', isAdmin, async (req, res) => {
    try {
        const orderResult = await pool.query(`
            SELECT 
                o.*, 
                CONCAT(o.city, ', ', o.street, ', ', o.building_number, 
                       CASE WHEN o.apartment_number IS NOT NULL THEN ', кв. ' || o.apartment_number ELSE '' END) as address,
                u.email
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.id = $1`, 
            [req.params.id]);
        
        const order = orderResult.rows[0];
        if (!order) {
            return res.status(404).render('error/error', {
                message: 'Заказ не найден'
            });
        }
        
        order.total = Number(order.total);
        
        const itemsResult = await pool.query(
            `SELECT oi.*, p.name as product_name, p.image 
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [req.params.id]
        );
        
        const items = itemsResult.rows.map(item => {
            item.price = Number(item.price);
            return item;
        });
        
        res.render('admin/order-details', {
            title: `Заказ #${order.id}`,
            order,
            items
        });
    } catch (err) {
        console.error('Error fetching order details:', err);
        res.status(500).render('error/error', {
            message: 'Ошибка при загрузке заказа'
        });
    }
});

module.exports = router;