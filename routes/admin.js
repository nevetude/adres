const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/images'));
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Разрешены только изображения (jpeg, jpg, png, gif)'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

const isAdmin = (req, res, next) => {
    if (req.session.user?.role === 'admin') return next();
    res.redirect('/');
};

router.get('/', isAdmin, async (req, res) => {
    try {
        const productsResult = await pool.query("SELECT * FROM products ORDER BY created_at DESC LIMIT 5");
        const ordersCountResult = await pool.query("SELECT COUNT(*) as count FROM orders");
        res.render('admin/dashboard', {
            title: 'Админ панель',
            products: productsResult.rows || [],
            ordersCount: ordersCountResult.rows[0]?.count || 0
        });
    } catch (err) {
        console.error('Error loading dashboard:', err);
        res.render('error/error', { message: 'Ошибка загрузки панели' });
    }
});

router.get('/products', isAdmin, async (req, res) => {
    try {
        const productsResult = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
        res.render('admin/products', {
            title: 'Управление товарами',
            products: productsResult.rows || []
        });
    } catch (err) {
        console.error('Ошибка при загрузке товаров:', err);
        res.render('error/error', { message: 'Ошибка при загрузке товаров' });
    }
});

router.get('/products/add', isAdmin, async (req, res) => {
    try {
        const categoriesResult = await pool.query("SELECT DISTINCT category FROM products");
        res.render('admin/add-product', { 
            title: 'Добавить товар',
            categories: categoriesResult.rows.map(row => row.category) || []
        });
    } catch (err) {
        console.error('Ошибка при загрузке категорий:', err);
        res.render('error/error', { message: 'Ошибка при загрузке категорий' });
    }
});

router.post('/products/add', isAdmin, upload.single('image'), async (req, res) => {
    const { name, description, price, old_price, category, gender, quantity } = req.body;
    if (!name || !description || !price || !category || !gender) {
        return res.render('admin/add-product', {
            title: 'Добавить товар',
            categories: [],
            error: 'Заполните все обязательные поля',
            formData: req.body
        });
    }
    const image = req.file ? req.file.filename : 'default.jpg';
    try {
        await pool.query(
            `INSERT INTO products (name, description, price, old_price, category, gender, image, quantity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [name, description, parseFloat(price), old_price ? parseFloat(old_price) : null, category, gender, image, quantity]
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

router.get('/products/edit/:id', isAdmin, async (req, res) => {
    try {
        const productResult = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
        const product = productResult.rows[0];
        if (!product) {
            return res.redirect('/admin/products');
        }
        const categoriesResult = await pool.query("SELECT DISTINCT category FROM products");
        res.render('admin/edit-product', { 
            title: 'Редактировать товар',
            product,
            categories: categoriesResult.rows.map(row => row.category) || []
        });
    } catch (err) {
        console.error('Ошибка при загрузке товара или категорий:', err);
        res.redirect('/admin/products');
    }
});

router.post('/products/edit/:id', isAdmin, upload.single('image'), async (req, res) => {
    const { name, description, price, old_price, category, gender, existing_image, quantity } = req.body;
    if (!name || !description || !price || !category || !gender || quantity === undefined) {
        return res.render('admin/edit-product', {
            title: 'Редактировать товар',
            product: req.body,
            categories: [],
            error: 'Заполните все обязательные поля'
        });
    }
    let image = existing_image || 'default.jpg';
    if (req.file) {
        image = req.file.filename;
    }
    try {
        await pool.query(
            `UPDATE products SET name = $1, description = $2, price = $3, old_price = $4, category = $5, gender = $6, image = $7, quantity = $8 WHERE id = $9`,
            [name, description, parseFloat(price), old_price ? parseFloat(old_price) : null, category, gender, image, parseInt(quantity), req.params.id]
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

router.post('/products/delete/:id', isAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    } catch (err) {
        console.error('Ошибка при удалении товара:', err);
    }
    res.redirect('/admin/products');
});

router.get('/orders', isAdmin, async (req, res) => {
    try {
        const { search } = req.query;
        let query = "SELECT * FROM orders";
        const params = [];
        if (search) {
            query += " WHERE id = $1";
            params.push(search);
        }
        query += " ORDER BY created_at DESC";
        const ordersResult = await pool.query(query, params);
        res.render('admin/orders', {
            title: 'Управление заказами',
            orders: ordersResult.rows || [],
            search: search || ''
        });
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).render('error/error', {
            message: 'Ошибка при загрузке заказов'
        });
    }
});

router.post('/orders/update-status', isAdmin, async (req, res) => {
    const { orderId, status } = req.body;
    try {
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, orderId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating order status:', err);
        res.status(500).json({ success: false, error: 'Ошибка обновления статуса' });
    }
});

router.get('/orders/:id', isAdmin, async (req, res) => {
    try {
        const orderResult = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
        const order = orderResult.rows[0];
        if (!order) {
            return res.status(404).render('error/error', {
                message: 'Заказ не найден'
            });
        }
        const itemsResult = await pool.query(
            `SELECT oi.*, p.name as product_name, p.image 
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [req.params.id]
        );
        res.render('admin/order-details', {
            title: `Заказ #${order.id}`,
            order,
            items: itemsResult.rows
        });
    } catch (err) {
        console.error('Error fetching order details:', err);
        res.status(500).render('error/error', {
            message: 'Ошибка при загрузке заказа'
        });
    }
});

module.exports = router;