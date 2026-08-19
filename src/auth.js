'use strict';

/**
 * src/auth.js — Authentication using Excel user file
 *
 * Users stored in: AR/data/User_Details.xlsx
 * Columns: username (email), password (plain text)
 *
 * POST /api/auth/login           { username, password }
 * POST /api/auth/forgot-password { email }
 * POST /api/auth/reset-password  { token, password }
 * GET  /api/auth/me
 * GET  /api/auth/users           (admin only)
 * POST /api/auth/users           (admin only — add user to Excel)
 * PUT  /api/auth/users/:username (admin only — update user)
 * DELETE /api/auth/users/:username (admin only)
 */

const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const XLSX       = require('xlsx');
const { query }  = require('./db');
const QUERIES    = require('./queries');

const router     = express.Router();
const DATA_DIR   = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'User_Details.xlsx');
const JWT_SECRET = process.env.JWT_SECRET || 'ar-dashboard-secret-change-me';
const JWT_EXPIRY = '8h';
const resetTokens = {};

// ── Excel helpers ─────────────────────────────────────────────────────────────

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const wb   = XLSX.readFile(USERS_FILE);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    return rows.map(r => ({
      username: String(r.username || '').trim(),
      password: String(r.password || '').trim(),
      role:     String(r.role     || 'user').trim(),
      active:   r.active === false ? false : true,
    })).filter(r => r.username);
  } catch (e) {
    console.error('[auth] Error reading users Excel:', e.message);
    return [];
  }
}

function writeUsers(users) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const ws = XLSX.utils.json_to_sheet(users.map(u => ({
    username: u.username,
    password: u.password,
    role:     u.role || 'user',
    active:   u.active !== false ? true : false,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Users');
  XLSX.writeFile(wb, USERS_FILE);
}

// ── JWT middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const users = readUsers();
  const user  = users.find(u =>
    u.username.toLowerCase() === username.toLowerCase().trim()
  );

  if (!user || user.active === false)
    return res.status(401).json({ error: 'Invalid username or password.' });

  // Plain text password comparison (matching PA Dashboard approach)
  if (user.password !== password.trim())
    return res.status(401).json({ error: 'Invalid username or password.' });

  // Resolve allowed org_ids from Oracle EBS
  let orgIds = [];
  try {
    const rows = await query(QUERIES.userAccessByUsername, { username: user.username });
    orgIds = rows.map(r => String(r.org_id)).filter(Boolean);
    console.log(`[auth] ${user.username} — Oracle orgs: ${orgIds.length > 0 ? orgIds.join(', ') : 'ALL'}`);
  } catch (e) {
    console.error('[auth] Oracle access lookup failed:', e.message);
    // On Oracle failure allow admin users to still login
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Could not verify access permissions. Please try again.' });
    }
  }

  const payload = {
    id:       user.username,
    name:     user.username.split('@')[0],
    email:    user.username,
    username: user.username,
    role:     user.role || 'user',
    bgIds:    [],
    orgIds:   orgIds,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ token, user: payload });
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const users = readUsers();
  const user  = users.find(u => u.username.toLowerCase() === email.toLowerCase().trim());

  if (!user) return res.json({ message: 'If that email is registered, a reset link has been sent.' });

  const token   = crypto.randomBytes(32).toString('hex');
  resetTokens[token] = { username: user.username, expires: Date.now() + 3600000 };

  const baseUrl  = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 6001}`;
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      to:      user.username,
      subject: 'AR Dashboard — Password Reset',
      html: `<p>Hello,</p><p>Click to reset your password (expires in 1 hour):</p>
             <p><a href="${resetUrl}" style="background:#00897B;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a></p>
             <p>If you did not request this, ignore this email.</p>`,
    });
  } catch (e) {
    console.error('[auth] Email failed:', e.message);
    return res.status(500).json({ error: 'Failed to send reset email. Contact your administrator.' });
  }

  res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────

router.post('/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Token and password are required.' });

  const record = resetTokens[token];
  if (!record || Date.now() > record.expires) {
    delete resetTokens[token];
    return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
  }

  const users = readUsers();
  const idx   = users.findIndex(u => u.username === record.username);
  if (idx === -1) return res.status(400).json({ error: 'User not found.' });

  users[idx].password = password;
  writeUsers(users);
  delete resetTokens[token];

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// ── GET /api/auth/users — list all users (admin only) ────────────────────────

router.get('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });
  const users = readUsers().map(u => ({ ...u, password: undefined }));
  res.json(users);
});

// ── POST /api/auth/users — add user ──────────────────────────────────────────

router.post('/users', requireAuth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });

  const { username, password, role } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()))
    return res.status(400).json({ error: 'User already exists.' });

  const newUser = { username: username.toLowerCase().trim(), password, role: role || 'user', active: true };
  users.push(newUser);
  writeUsers(users);
  res.json({ ...newUser, password: undefined });
});

// ── PUT /api/auth/users/:username — update user ───────────────────────────────

router.put('/users/:username', requireAuth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });

  const users = readUsers();
  const idx   = users.findIndex(u => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'User not found.' });

  const { password, role, active } = req.body || {};
  if (password) users[idx].password = password;
  if (role)     users[idx].role     = role;
  if (active !== undefined) users[idx].active = !!active;

  writeUsers(users);
  res.json({ ...users[idx], password: undefined });
});

// ── DELETE /api/auth/users/:username ─────────────────────────────────────────

router.delete('/users/:username', requireAuth, (req, res) => {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required.' });

  const users = readUsers().filter(u => u.username !== req.params.username);
  writeUsers(users);
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
