const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

router.get('/login', (req, res) => {
    res.render('login', {
        title: 'Вход',
        error: null,
        email: ''
    });
});

router.get('/register', (req, res) => {
    res.render('register', {
        title: 'Регистрация',
        error: null,
        formData: { email: '', name: '' }
    });
});

router.post('/register', async (req, res) => {
    const { email, name, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.render('register', {
            title: 'Регистрация',
            error: 'Пароли не совпадают',
            formData: { email, name }
        });
    }
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (userResult.rows.length > 0) {
            return res.render('register', {
                title: 'Регистрация',
                error: 'Пользователь с таким email уже существует',
                formData: { email, name }
            });
        }
        const hashedPassword = bcrypt.hashSync(password, 10);
        const insertResult = await pool.query(
            "INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id, email, name, role",
            [email, name, hashedPassword]
        );
        req.session.user = insertResult.rows[0];
        res.redirect('/');
    } catch (err) {
        return res.render('register', {
            title: 'Регистрация',
            error: 'Ошибка при создании пользователя',
            formData: { email, name }
        });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        const user = userResult.rows[0];
        if (!user) {
            return res.render('login', {
                title: 'Вход',
                error: 'Неверный email или пароль',
                email
            });
        }
        if (!bcrypt.compareSync(password, user.password)) {
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
        res.redirect('/');
    } catch (err) {
        return res.render('login', {
            title: 'Вход',
            error: 'Ошибка базы данных',
            email
        });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Ошибка при выходе:', err);
            return res.status(500).send('Ошибка при выходе');
        }
        res.clearCookie('app.sid', {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        });
        res.redirect('/');
    });
});

module.exports = router;