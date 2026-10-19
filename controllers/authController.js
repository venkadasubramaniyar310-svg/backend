const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Helper to generate JWT token
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            department_id: user.department_id,
            semester: user.semester || null
        },
        process.env.JWT_SECRET || 'academic_resource_hub_super_secret_jwt_key_2026',
        {
            expiresIn: process.env.JWT_EXPIRES_IN || '7d'
        }
    );
};

// Email format validator
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Register a new user
 * POST /api/auth/register
 * Body: { name, email, password, role?, department_id? }
 */
const register = async (req, res) => {
    try {
        const { name, email, password, role = 'STUDENT', department_id = null, semester = null } = req.body;

        // Field validations
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Name is required.' });
        }

        if (!email || typeof email !== 'string' || !isValidEmail(email.trim())) {
            return res.status(400).json({ error: 'A valid email address is required.' });
        }

        if (!password || typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
        }

        // Validate role
        const normalizedRole = role.toUpperCase();
        const allowedRoles = ['STUDENT', 'STAFF', 'ADMIN'];
        if (!allowedRoles.includes(normalizedRole)) {
            return res.status(400).json({
                error: `Invalid role specified. Must be one of: ${allowedRoles.join(', ')}`
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user email already exists
        const [existingUsers] = await db.query(
            'SELECT id FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                error: 'An account with this email address already exists.'
            });
        }

        // Validate department_id if provided
        if (department_id) {
            const [departments] = await db.query(
                'SELECT id FROM departments WHERE id = ?',
                [department_id]
            );

            if (departments.length === 0) {
                return res.status(400).json({
                    error: `Department ID ${department_id} does not exist.`
                });
            }
        }

        // Hash password
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // Semester is only applicable for students
        const userSemester = normalizedRole === 'STUDENT' ? (semester || null) : null;

        // Insert new user
        const [result] = await db.query(
            'INSERT INTO users (name, email, password_hash, role, department_id, semester) VALUES (?, ?, ?, ?, ?, ?)',
            [name.trim(), normalizedEmail, password_hash, normalizedRole, department_id || null, userSemester]
        );

        const newUser = {
            id: result.insertId,
            name: name.trim(),
            email: normalizedEmail,
            role: normalizedRole,
            department_id: department_id || null,
            semester: userSemester
        };

        // Issue JWT token
        const token = generateToken(newUser);

        return res.status(201).json({
            message: 'User registered successfully',
            token,
            user: newUser
        });
    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({
            error: 'An internal server error occurred while registering the user.'
        });
    }
};

/**
 * Log in an existing user
 * POST /api/auth/login
 * Body: { email, password }
 */
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                error: 'Email and password are required.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Fetch user with department name and semester
        const [rows] = await db.query(
            `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.department_id,
                    u.semester, d.name AS department_name, u.created_at
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE u.email = ?`,
            [normalizedEmail]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid email or password.'
            });
        }

        const user = rows[0];

        // Compare password hash
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        if (!isPasswordValid) {
            return res.status(401).json({
                error: 'Invalid email or password.'
            });
        }

        const userPayload = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            department_id: user.department_id,
            semester: user.semester || null,
            department_name: user.department_name,
            created_at: user.created_at
        };

        // Issue JWT token
        const token = generateToken(userPayload);

        return res.status(200).json({
            message: 'Login successful',
            token,
            user: userPayload
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            error: 'An internal server error occurred during login.'
        });
    }
};

/**
 * Get current authenticated user profile
 * GET /api/auth/me
 */
const getProfile = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.id, u.name, u.email, u.role, u.department_id,
                    u.semester, d.name AS department_name, u.created_at
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE u.id = ?`,
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        return res.status(200).json({
            user: rows[0]
        });
    } catch (error) {
        console.error('Get profile error:', error);
        return res.status(500).json({
            error: 'An internal server error occurred while fetching user profile.'
        });
    }
};

module.exports = {
    register,
    login,
    getProfile
};
