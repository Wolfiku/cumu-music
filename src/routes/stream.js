const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDB, getConfig } = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /stream/:songId — audio streaming with range support
router.get('/:songId', requireAuth, (req, res) => {
  const db = getDB();
  const cfg = getConfig();
  const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');

  const song = db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.songId);
  if (!song) return res.status(404).json({ error: 'Not found' });

  const filePath = path.join(musicPath, song.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(song.filename).toLowerCase();
  const mimeTypes = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  const contentType = mimeTypes[ext] || 'audio/mpeg';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// GET /stream/cover/:filename — serve cover art
router.get('/cover/:filename', (req, res) => {
  const cfg = getConfig();
  const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');
  const filePath = path.join(musicPath, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

module.exports = router;
