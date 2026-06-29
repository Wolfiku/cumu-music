const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB, getConfig, setConfig } = require('../db');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// POST /auth/setup — first-time setup
router.post('/setup', async (req, res) => {
  const cfg = getConfig();
  if (cfg.setupDone) return res.status(400).json({ error: 'Already set up' });

  const { username, password, port, host, musicPath, maxStorageGb } = req.body;
  if (!username || !password || !musicPath) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const db = getDB();
  const hashed = await bcrypt.hash(password, 12);
  const userId = uuidv4();

  db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(userId, username, hashed, 'admin');

  const resolvedPath = path.resolve(musicPath);
  if (!fs.existsSync(resolvedPath)) {
    try { fs.mkdirSync(resolvedPath, { recursive: true }); } catch (e) {}
  }

  setConfig('setupDone', true);
  setConfig('port', parseInt(port) || 3000);
  setConfig('host', host || '0.0.0.0');
  setConfig('musicPath', resolvedPath);
  setConfig('maxStorageGb', parseFloat(maxStorageGb) || 50);
  setConfig('sessionSecret', require('crypto').randomBytes(32).toString('hex'));

  req.session.userId = userId;
  req.session.role = 'admin';
  req.session.username = username;

  res.json({ success: true, redirect: '/' });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.username = user.username;

  res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /auth/me
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = getDB();
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

module.exports = router;
