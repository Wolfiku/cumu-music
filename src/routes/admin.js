const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const mm = require('music-metadata');
const { getDB, getConfig } = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!['admin', 'creator'].includes(req.session.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const cfg = getConfig();
    const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');
    if (!fs.existsSync(musicPath)) fs.mkdirSync(musicPath, { recursive: true });
    cb(null, musicPath);
  },
  filename: (req, file, cb) => {
    const unique = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.m4a', '.flac', '.ogg', '.wav', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

async function extractMeta(filePath) {
  try {
    const meta = await mm.parseFile(filePath, { duration: true });
    const common = meta.common || {};
    return {
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artist || common.albumartist || null,
      album: common.album || null,
      year: common.year || null,
      genre: Array.isArray(common.genre) ? common.genre[0] : common.genre || null,
      track: common.track?.no || null,
      duration: Math.round(meta.format.duration || 0),
      picture: common.picture && common.picture.length > 0 ? common.picture[0] : null
    };
  } catch (e) {
    return { title: path.basename(filePath, path.extname(filePath)), artist: null, album: null, year: null, genre: null, track: null, duration: 0, picture: null };
  }
}

function getOrCreateArtist(db, name) {
  if (!name) return null;
  let artist = db.prepare('SELECT * FROM artists WHERE name = ?').get(name);
  if (!artist) {
    const id = uuidv4();
    db.prepare('INSERT INTO artists (id, name) VALUES (?, ?)').run(id, name);
    artist = { id };
  }
  return artist.id;
}

function getOrCreateAlbum(db, title, artistId, meta) {
  if (!title) return null;
  let album = db.prepare('SELECT * FROM albums WHERE title = ? AND artist_id = ?').get(title, artistId);
  if (!album) {
    const id = uuidv4();
    db.prepare('INSERT INTO albums (id, title, artist_id, year, genre) VALUES (?, ?, ?, ?, ?)').run(id, title, artistId, meta.year || null, meta.genre || null);
    album = { id };
  }
  return album.id;
}

// POST /admin/upload — single or multiple songs
router.post('/upload', requireAdmin, upload.fields([{ name: 'files', maxCount: 100 }, { name: 'cover', maxCount: 1 }]), async (req, res) => {
  const db = getDB();
  const cfg = getConfig();
  const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');
  const coverFile = req.files?.cover?.[0];
  const songFiles = req.files?.files || [];

  if (songFiles.length === 0) return res.status(400).json({ error: 'No audio files uploaded' });

  const results = [];
  for (const file of songFiles) {
    const filePath = file.path;
    const meta = await extractMeta(filePath);

    const artistName = req.body.artist || meta.artist;
    const albumTitle = req.body.album || meta.album;
    const songTitle = req.body.title || meta.title;
    const isAudiobook = req.body.isAudiobook === 'true' || req.body.isAudiobook === true ? 1 : 0;

    const artistId = getOrCreateArtist(db, artistName);
    const albumId = getOrCreateAlbum(db, albumTitle, artistId, meta);

    let coverFilename = null;
    if (coverFile) {
      coverFilename = coverFile.filename;
      // Update album cover
      if (albumId) db.prepare('UPDATE albums SET cover=? WHERE id=?').run(coverFilename, albumId);
    } else if (meta.picture) {
      // Save embedded artwork
      const artExt = meta.picture.format?.split('/')?.[1] || 'jpg';
      coverFilename = `${uuidv4()}.${artExt}`;
      const artPath = path.join(musicPath, coverFilename);
      fs.writeFileSync(artPath, meta.picture.data);
      if (albumId) db.prepare('UPDATE albums SET cover=? WHERE id=?').run(coverFilename, albumId);
    }

    const songId = uuidv4();
    const fileSize = fs.statSync(filePath).size;
    db.prepare('INSERT INTO songs (id, title, artist_id, album_id, filename, duration, track_number, genre, year, is_audiobook, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      songId, songTitle, artistId, albumId, file.filename,
      meta.duration, meta.track, meta.genre, meta.year, isAudiobook, fileSize
    );

    results.push({ id: songId, title: songTitle, artist: artistName, album: albumTitle });
  }

  res.json({ success: true, uploaded: results.length, songs: results });
});

// PUT /admin/songs/:id — edit song metadata
router.put('/songs/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const { title, genre, year, track_number, is_audiobook } = req.body;
  db.prepare('UPDATE songs SET title=COALESCE(?,title), genre=COALESCE(?,genre), year=COALESCE(?,year), track_number=COALESCE(?,track_number), is_audiobook=COALESCE(?,is_audiobook) WHERE id=?').run(
    title||null, genre||null, year||null, track_number||null, is_audiobook != null ? (is_audiobook?1:0) : null, req.params.id
  );
  const song = db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);
  res.json(song);
});

// DELETE /admin/songs/:id
router.delete('/songs/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const cfg = getConfig();
  const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');
  const song = db.prepare('SELECT * FROM songs WHERE id=?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(path.join(musicPath, song.filename)); } catch {}
  db.prepare('DELETE FROM play_history WHERE song_id=?').run(req.params.id);
  db.prepare('DELETE FROM playlist_songs WHERE song_id=?').run(req.params.id);
  db.prepare('DELETE FROM library WHERE song_id=?').run(req.params.id);
  db.prepare('DELETE FROM songs WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// DELETE /admin/albums/:id
router.delete('/albums/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const cfg = getConfig();
  const musicPath = cfg.musicPath || path.join(process.cwd(), 'music');
  const songs = db.prepare('SELECT * FROM songs WHERE album_id=?').all(req.params.id);
  for (const s of songs) {
    try { fs.unlinkSync(path.join(musicPath, s.filename)); } catch {}
    db.prepare('DELETE FROM play_history WHERE song_id=?').run(s.id);
    db.prepare('DELETE FROM playlist_songs WHERE song_id=?').run(s.id);
    db.prepare('DELETE FROM library WHERE song_id=?').run(s.id);
    db.prepare('DELETE FROM songs WHERE id=?').run(s.id);
  }
  db.prepare('DELETE FROM albums WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
