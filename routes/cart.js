const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const path = require('path');

// Корзина
router.get('/', (req, res) => {
    const cart = req.session.cart || [];
    res.render('partials/cart', {
        title: 'Корзина',
        cart,
        total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
});

// Добавление в корзину
router.post('/add', async (req, res) => {
    const { id, quantity, size } = req.body;
    
    try {
        const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
        
        const product = rows[0];
        const cart = req.session.cart || [];
        const existing = cart.find(item => item.id === id && item.size === size);
        
        if (existing) {
            existing.quantity += Number(quantity);
        } else {
            cart.push({
                id: product.id,
                name: product.name,
                price: Number(product.price),
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

// Удаление из корзины
router.post('/remove', (req, res) => {
    const { id, size } = req.body;
    const cart = (req.session.cart || []).filter(item => !(item.id == id && item.size === size));
    req.session.cart = cart;
    res.json({ success: true, cart });
});

// Обновление количества
router.post('/update', (req, res) => {
    const { id, quantity, size } = req.body;
    const cart = req.session.cart || [];
    const item = cart.find(item => item.id == id && item.size === size);
    
    if (item) item.quantity = Number(quantity);
    req.session.cart = cart;
    res.json({ success: true, cart });
});

// Избранное
router.post('/favorite/:action', async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    
    try {
        const { productId } = req.body;
        if (req.params.action === 'add') {
            await pool.query(`
                INSERT INTO favorites (user_id, product_id) 
                VALUES ($1, $2) 
                ON CONFLICT DO NOTHING
            `, [req.session.user.id, productId]);
        } else {
            await pool.query(`
                DELETE FROM favorites 
                WHERE user_id = $1 AND product_id = $2
            `, [req.session.user.id, productId]);
        }
        
        res.json({ success: true });
    } catch (error) {
        const actionText = req.params.action === 'add' ? 'добавления в' : 'удаления из';
        res.status(500).json({ success: false, error: `Ошибка ${actionText} избранное` });
    }
});

// Количество избранного
router.get('/favorite/count', async (req, res) => {
    if (!req.session.user) return res.json({ count: 0 });
    
    try {
        const { rows } = await pool.query(`
            SELECT COUNT(*) 
            FROM favorites 
            WHERE user_id = $1
        `, [req.session.user.id]);
        res.json({ count: Number(rows[0].count) });
    } catch (error) {
        res.json({ count: 0 });
    }
});

// Оформление заказа
router.route('/checkout')
    .get((req, res) => {
        if (!req.session.user) return res.redirect('/auth/login?redirect=/cart/checkout');
        
        const cart = req.session.cart || [];
        if (cart.length === 0) return res.redirect('/cart');
        
        res.render('order/checkout', {
            title: 'Оформление заказа',
            cart,
            total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
        });
    })
    .post(async (req, res) => {
        if (!req.session.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Для оформления заказа требуется авторизация' 
            });
        }
        
        const { 
            lastName, 
            firstName, 
            middleName = '', 
            phone, 
            postalCode, 
            region, 
            city, 
            street, 
            buildingNumber, 
            apartmentNumber = '', 
            comment = '' 
        } = req.body;
        
        const cart = req.session.cart || [];
        
        // Валидация
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
                const { rows } = await client.query(`
                    SELECT id, name, quantity 
                    FROM products 
                    WHERE id = $1 AND quantity >= $2 
                    FOR UPDATE
                `, [item.id, item.quantity]);
                
                if (!rows.length) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false, 
                        error: `Товар "${item.name}" недоступен в нужном количестве`, 
                        productId: item.id 
                    });
                }
            }
            
            const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            
            // Создание заказа
            const { rows: [order] } = await client.query(`
                INSERT INTO orders (
                    user_id, last_name, first_name, middle_name, phone, postal_code, 
                    region, city, street, building_number, apartment_number, 
                    comment, total, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'processing') 
                RETURNING id
            `, [
                req.session.user.id, 
                lastName.trim(), 
                firstName.trim(), 
                middleName.trim(), 
                phone.trim(), 
                postalCode.trim(), 
                region.trim(), 
                city.trim(), 
                street.trim(), 
                buildingNumber.trim(), 
                apartmentNumber.trim(), 
                comment.trim(), 
                total
            ]);
            
            // Сохранение позиций заказа
            for (const item of cart) {
                await client.query(`
                    INSERT INTO order_items (
                        order_id, product_id, quantity, price, size
                    ) VALUES ($1, $2, $3, $4, $5)
                `, [order.id, item.id, item.quantity, item.price, item.size || 'N/A']);
                
                await client.query(`
                    UPDATE products 
                    SET quantity = quantity - $1 
                    WHERE id = $2
                `, [item.quantity, item.id]);
            }
            
            await client.query('COMMIT');
            req.session.cart = [];
            
            res.json({ 
                success: true, 
                orderId: order.id, 
                redirectUrl: `/cart/order/payment/${order.id}`,
                message: 'Заказ успешно оформлен' 
            });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(500).json({ 
                success: false, 
                error: 'Произошла ошибка при оформлении заказа', 
                details: process.env.NODE_ENV === 'development' ? error.message : undefined 
            });
        } finally {
            client.release();
        }
    });

// Страница оплаты
router.get('/order/payment/:id', async (req, res) => {
    try {
        const [orderResult, itemsResult] = await Promise.all([
            pool.query(`
                SELECT o.*, u.email, o.total::numeric as total
                FROM orders o 
                JOIN users u ON o.user_id = u.id 
                WHERE o.id = $1
            `, [req.params.id]),
            pool.query(`
                SELECT 
                    oi.*, 
                    p.name as product_name, 
                    p.image,
                    oi.price::numeric as price
                FROM order_items oi 
                JOIN products p ON oi.product_id = p.id 
                WHERE oi.order_id = $1
            `, [req.params.id])
        ]);
        
        if (!orderResult.rows.length) {
            return res.status(404).render('error/error', { 
                message: 'Заказ не найден',
                status: 404
            });
        }
        
        const order = orderResult.rows[0];
        const address = [
            order.postal_code,
            order.region,
            order.city,
            order.street,
            order.building_number,
            order.apartment_number ? `кв. ${order.apartment_number}` : ''
        ].filter(Boolean).join(', ');
        
        res.render('order/payment', {
            title: `Оплата заказа #${req.params.id}`,
            order: {
                ...order,
                address,
                total: Number(order.total)
            },
            items: itemsResult.rows.map(item => ({
                ...item,
                price: Number(item.price)
            }))
        });
    } catch (error) {
        console.error('Error loading payment page:', error);
        res.status(500).render('error/error', { 
            message: 'Ошибка при загрузке страницы оплаты',
            status: 500
        });
    }
});

router.post('/order/complete/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Требуется авторизация' });
    }

    try {
        await pool.query(`
            UPDATE orders 
            SET status = 'processing' 
            WHERE id = $1 AND user_id = $2
        `, [req.params.id, req.session.user.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error completing order:', error);
        res.status(500).json({ success: false, error: 'Ошибка при подтверждении заказа' });
    }
});
// Страница успешного оформления заказа
router.get('/order/success/:id', async (req, res) => {
    try {
        const [orderResult, itemsResult] = await Promise.all([
            pool.query(`
                SELECT o.*, u.email
                FROM orders o
                JOIN users u ON o.user_id = u.id
                WHERE o.id = $1
            `, [req.params.id]),
            pool.query(`
                SELECT 
                    oi.*, 
                    p.name as product_name, 
                    p.image,
                    oi.price::numeric as price
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = $1
            `, [req.params.id])
        ]);

        if (!orderResult.rows.length) {
            return res.status(404).render('error/error', {
                message: 'Заказ не найден',
                status: 404
            });
        }

        const order = orderResult.rows[0];
        res.render('order/success', {
            title: `Заказ #${order.id} успешно оформлен`,
            order: {
                ...order,
                total: Number(order.total)
            },
            items: itemsResult.rows.map(item => ({
                ...item,
                price: Number(item.price)
            })),
            date: new Date(order.created_at).toLocaleString('ru-RU')
        });
    } catch (error) {
        console.error('Error loading order:', error);
        res.status(500).render('error/error', {
            message: 'Ошибка при загрузке заказа',
            status: 500
        });
    }
});

module.exports = router;
