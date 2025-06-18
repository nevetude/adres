const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

// Вход
router.route('/login')
    .get((req, res) => {
        res.render('login', { title: 'Вход', error: null, email: '' });
    })
        // Вход
    .post(async (req, res) => {
        const { email, password } = req.body;
        
        try {
            const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
            const user = rows[0];
            
            if (!user || !bcrypt.compareSync(password, user.password)) {
                return res.render('login', {
                    title: 'Вход',
                    error: 'Неверный email или пароль',
                    email
                });
            }
            
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            };
            
            req.session.save(err => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.render('login', {
                        title: 'Вход',
                        error: 'Ошибка входа',
                        email
                    });
                }
                // Редирект на /admin/products для админа, на главную для остальных
                const redirectUrl = user.role === 'admin' ? '/admin/products' : '/';
                res.redirect(redirectUrl);
            });
        } catch (err) {
            console.error('Login error:', err);
            res.render('login', {
                title: 'Вход',
                error: 'Ошибка базы данных',
                email
            });
        }
    });
    
// Регистрация
router.route('/register')
    .get((req, res) => {
        res.render('register', { title: 'Регистрация', error: null, formData: { email: '', name: '' } });
    })
    .post(async (req, res) => {
        const { email, name, password, confirmPassword } = req.body;
        
        if (password !== confirmPassword) {
            return res.render('register', {
                title: 'Регистрация',
                error: 'Пароли не совпадают',
                formData: { email, name }
            });
        }
        
        try {
            const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
            if (rows.length > 0) {
                return res.render('register', {
                    title: 'Регистрация',
                    error: 'Пользователь с таким email уже существует',
                    formData: { email, name }
                });
            }
            
            const hashedPassword = bcrypt.hashSync(password, 10);
            const { rows: [newUser] } = await pool.query(
                "INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id, email, name, role",
                [email, name, hashedPassword]
            );
            
            req.session.user = newUser;
            
            // Сохраняем сессию перед редиректом
            req.session.save(err => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.render('register', {
                        title: 'Регистрация',
                        error: 'Ошибка при создании пользователя',
                        formData: { email, name }
                    });
                }
                res.redirect('/');
            });
        } catch (err) {
            res.render('register', {
                title: 'Регистрация',
                error: 'Ошибка при создании пользователя',
                formData: { email, name }
            });
        }
    });

// Выход
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('app.sid', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        res.redirect('/');
    });
});

module.exports = router;