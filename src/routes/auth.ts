import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth';

const { body, validationResult } = require('express-validator');

const router = Router();
const authService = new AuthService();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', [
  body('username')
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .withMessage('Must be a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('phone')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Must be a valid phone number'),
  body('role')
    .optional()
    .isIn(['TRADER', 'ADMIN'])
    .withMessage('Role must be either TRADER or ADMIN')
], async (req: Request, res: Response) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      detail: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, email, password, phone, role } = req.body;

  try {
    const result = await authService.register({
      username,
      email,
      password,
      phone,
      role: role || 'TRADER'
    });

    if (!result.success) {
      return res.status(400).json({ detail: result.error });
    }

    // Return user data without sensitive information
    const userResponse = {
      id: result.user!.id,
      username: result.user!.username,
      email: result.user!.email,
      phone: result.user!.phone,
      role: result.user!.role,
      createdAt: result.user!.createdAt
    };

    res.status(201).json({
      message: 'User registered successfully',
      user: userResponse,
      access_token: result.token,
      token_type: 'bearer',
      expires_in: 86400 // 24 hours
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ detail: 'Registration failed' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user login
 */
router.post('/login', [
  body('username')
    .notEmpty()
    .withMessage('Username is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req: Request, res: Response) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      detail: 'Validation failed',
      errors: errors.array()
    });
  }

  const { username, password } = req.body;

  try {
    const result = await authService.login({ username, password });

    if (!result.success) {
      return res.status(401).json({ detail: result.error });
    }

    // Return user data without sensitive information
    const userResponse = {
      id: result.user!.id,
      username: result.user!.username,
      email: result.user!.email,
      phone: result.user!.phone,
      role: result.user!.role,
      lastLoginAt: result.user!.lastLoginAt
    };

    res.json({
      message: 'Login successful',
      user: userResponse,
      access_token: result.token,
      token_type: 'bearer',
      expires_in: 86400 // 24 hours
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Login failed' });
  }
});

/**
 * GET /api/auth/profile
 * Get current user profile
 */
router.get('/profile', async (req: Request, res: Response) => {
  // This would be protected by authentication middleware
  // For now, we'll return a placeholder
  res.json({ detail: 'Profile endpoint - requires authentication' });
});

/**
 * PUT /api/auth/profile
 * Update user profile
 */
router.put('/profile', [
  body('email')
    .optional()
    .isEmail()
    .withMessage('Must be a valid email address'),
  body('phone')
    .optional()
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Must be a valid phone number')
], async (req: Request, res: Response) => {
  // This would be protected by authentication middleware
  // For now, we'll return a placeholder
  res.json({ detail: 'Profile update endpoint - requires authentication' });
});

/**
 * POST /api/auth/change-password
 * Change user password
 */
router.post('/change-password', [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
], async (req: Request, res: Response) => {
  // This would be protected by authentication middleware
  // For now, we'll return a placeholder
  res.json({ detail: 'Change password endpoint - requires authentication' });
});

export default router; 