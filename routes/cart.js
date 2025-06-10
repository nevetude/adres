const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const pdf = require('html-pdf');
const path = require('path');

// Страница корзины
router.get('/', async (req, res) => {
    const cart = req.session.cart || [];
    res.render('partials/cart', {  // Указываем правильный путь к шаблону
        title: 'Корзина',
        cart,
        total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
});

router.post('/add', async (req, res) => {
    const { id, quantity, size } = req.body;
    try {
        const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'Product not found' });
        }
        const product = rows[0];
        const cart = req.session.cart || [];
        const existing = cart.find(item => item.id === id && item.size === size);
        
        if (existing) {
            existing.quantity += Number(quantity);
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: Number(product.price), // Преобразуем здесь
                image: product.image,
                size: size || 'N/A',
                quantity: Number(quantity)
            });
        }
        req.session.cart = cart;
        res.json({ success: true, cart });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка добавления в корзину' });
    }
});

// Удаление товара из корзины
router.post('/remove', (req, res) => {
    const { id, size } = req.body;
    let cart = req.session.cart || [];
    cart = cart.filter(item => !(item.id == id && item.size === size));
    req.session.cart = cart;
    res.json({ success: true, cart });
});

// Обновление количества товара
router.post('/update', (req, res) => {
    const { id, quantity, size } = req.body;
    let cart = req.session.cart || [];
    const item = cart.find(item => item.id == id && item.size === size);
    if (item) {
        item.quantity = Number(quantity);
    }
    req.session.cart = cart;
    res.json({ success: true, cart });
});

// Избранное: добавить
router.post('/favorite/add', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    const { productId } = req.body;
    try {
        await pool.query('INSERT INTO favorites (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.session.user.id, productId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка добавления в избранное' });
    }
});

// Избранное: удалить
router.post('/favorite/remove', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    const { productId } = req.body;
    try {
        await pool.query('DELETE FROM favorites WHERE user_id = $1 AND product_id = $2', [req.session.user.id, productId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка удаления из избранного' });
    }
});

/*
// Избранное: получить список
router.get('/favorite/list', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }
    try {
        const { rows } = await pool.query(
            `SELECT p.* FROM favorites f JOIN products p ON f.product_id = p.id WHERE f.user_id = $1`,
            [req.session.user.id]
        );
        res.json({ success: true, favorites: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Ошибка получения избранного' });
    }
});
*/

// Избранное: количество
router.get('/favorite/count', async (req, res) => {
    if (!req.session.user) {
        return res.json({ count: 0 });
    }
    try {
        const { rows } = await pool.query('SELECT COUNT(*) FROM favorites WHERE user_id = $1', [req.session.user.id]);
        res.json({ count: Number(rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

// Страница оформления заказа
router.get('/checkout', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/auth/login?redirect=/cart/checkout');
    }
    const cart = req.session.cart || [];
    if (cart.length === 0) {
        return res.redirect('/cart');
    }
    let total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('cart/checkout', {
        title: 'Оформление заказа',
        cart,
        total
    });
});

// Оформление заказа
router.post('/checkout', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Для оформления заказа требуется авторизация' });
    }
    const { lastName, firstName, middleName = '', phone, postalCode, region, city, street, buildingNumber, apartmentNumber = '', comment = '' } = req.body;
    const cart = req.session.cart || [];
    if (!lastName || !firstName || !phone || !postalCode || !region || !city || !street || !buildingNumber) {
        return res.status(400).json({ success: false, error: 'Заполните все обязательные поля' });
    }
    if (cart.length === 0) {
        return res.status(400).json({ success: false, error: 'Невозможно оформить пустую корзину' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Проверка наличия товаров
        for (const item of cart) {
            const { rows } = await client.query('SELECT id, name, quantity FROM products WHERE id = $1 AND quantity >= $2 FOR UPDATE', [item.id, item.quantity]);
            if (!rows.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, error: `Товар "${item.name}" недоступен в нужном количестве`, productId: item.id });
            }
        }
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const orderResult = await client.query(
            `INSERT INTO orders (user_id, last_name, first_name, middle_name, phone, postal_code, region, city, street, building_number, apartment_number, comment, total, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'processing') RETURNING id`,
            [req.session.user.id, lastName.trim(), firstName.trim(), middleName.trim(), phone.trim(), postalCode.trim(), region.trim(), city.trim(), street.trim(), buildingNumber.trim(), apartmentNumber.trim(), comment.trim(), total]
        );
        const orderId = orderResult.rows[0].id;
        // Сохранение позиций заказа
        for (const item of cart) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price, size) VALUES ($1, $2, $3, $4, $5)`,
                [orderId, item.id, item.quantity, item.price, item.size || 'N/A']
            );
            await client.query(
                `UPDATE products SET quantity = quantity - $1 WHERE id = $2`,
                [item.quantity, item.id]
            );
        }
        await client.query('COMMIT');
        req.session.cart = [];
        res.json({ success: true, orderId, redirectUrl: `/cart/order/success/${orderId}`, message: 'Заказ успешно оформлен' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: 'Произошла ошибка при оформлении заказа', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    } finally {
        client.release();
    }
});

// Страница успешного заказа
router.get('/order/success/:id', async (req, res) => {
    try {
        const orderId = req.params.id;
        const { rows: orderRows } = await pool.query(
            `SELECT o.*, u.email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = $1`,
            [orderId]
        );
        if (!orderRows.length) {
            return res.status(404).render('error', { message: 'Заказ не найден' });
        }
        const order = orderRows[0];
        const { rows: items } = await pool.query(
            `SELECT oi.*, p.name as product_name, p.image FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1`,
            [orderId]
        );
        const receiptData = {
            order,
            items,
            date: new Date(order.created_at).toLocaleString('ru-RU'),
            total: order.total.toFixed(2)
        };
        res.render('order/success', receiptData);
        generateReceiptPDF(receiptData, orderId);
    } catch (error) {
        res.status(500).render('error', { message: 'Ошибка при загрузке заказа' });
    }
});

function generateReceiptPDF(data, orderId) {
    const receiptHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Чек заказа #${orderId}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #333; font-size: 24px; }
                .header { margin-bottom: 20px; }
                .info { margin-bottom: 15px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .total { font-weight: bold; font-size: 18px; margin-top: 10px; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Чек заказа #${orderId}</h1>
                <div class="info">Дата: ${data.date}</div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Товар</th>
                        <th>Цена</th>
                        <th>Кол-во</th>
                        <th>Сумма</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.items.map(item => `
                        <tr>
                            <td>${item.product_name}</td>
                            <td>${item.price.toFixed(2)} ₽</td>
                            <td>${item.quantity}</td>
                            <td>${(item.price * item.quantity).toFixed(2)} ₽</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="total">Итого: ${data.total} ₽</div>
            <div class="footer">
                Спасибо за покупку!<br>
                Телефон поддержки: +7 (123) 456-78-90
            </div>
        </body>
        </html>
    `;

    const options = { 
        format: 'A4',
        border: {
            top: '10mm',
            right: '10mm',
            bottom: '10mm',
            left: '10mm'
        }
    };

    const pdfPath = path.join(__dirname, '../public/receipts', `receipt_${orderId}.pdf`);
    pdf.create(receiptHtml, options).toFile(pdfPath, (err) => {
        if (err) console.error('Ошибка генерации PDF:', err);
    });
}


module.exports = router;