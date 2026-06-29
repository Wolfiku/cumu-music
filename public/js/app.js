// cumu — Main SPA
(function() {
  'use strict';

  // State
  let currentUser = null;
  let currentPage = 'home';
  let queue = [];
  let queueIndex = 0;
  let audiobook = false;
  let audio = new Audio();
  let currentSong = null;
  let isPlaying = false;
  let playlists = [];

  // DOM
  const main = document.getElementById('mainContent');
  const loginModal = document.getElementById('loginModal');
  const npBar = document.getElementById('nowPlayingBar');
  const npInfo = document.getElementById('npInfo');
  const npControls = document.getElementById('npControls');
  const npSeek = document.getElementById('npSeek');
  const npCurrentTime = document.getElementById('npCurrentTime');
  const npDuration = document.getElementById('npDuration');
  const contextMenu = document.getElementById('contextMenu');

  // Init
  async function init() {
    try {
      const res = await fetch('/auth/me');
      if (res.ok) {
        currentUser = await res.json();
        onLogin();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  function showLogin() {
    loginModal.style.display = 'flex';
  }
  function hideLogin() {
    loginModal.style.display = 'none';
  }

  function onLogin() {
    hideLogin();
    document.getElementById('navUser').textContent = `[${currentUser.username}]`;
    if (currentUser.role === 'admin' || currentUser.role === 'creator') {
      document.getElementById('adminBtn').style.display = 'inline-flex';
    }
    loadPlaylists();
    navigate('home');
  }

  // Login form
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const json = await res.json();
    if (json.success) {
      currentUser = json.user;
      onLogin();
    } else {
      errEl.textContent = json.error || 'Login failed';
      errEl.style.display = 'block';
    }
  });

  window.logout = async function() {
    await fetch('/auth/logout', { method: 'POST' });
    currentUser = null;
    stopAudio();
    showLogin();
  };

  async function loadPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      if (res.ok) playlists = await res.json();
    } catch {}
  }

  // Navigation
  window.navigate = function(page, params) {
    currentPage = page;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
    if (page === 'home') renderHome();
    else if (page === 'search') renderSearch();
    else if (page === 'library') renderLibrary();
    else if (page === 'admin') renderAdmin();
    else if (page === 'album') renderAlbum(params);
    else if (page === 'artist') renderArtist(params);
    else if (page === 'playlist') renderPlaylist(params);
    else if (page === 'song') renderSong(params);
    window.scrollTo(0, 0);
  };

  // ---- HOME ----
  async function renderHome() {
    main.innerHTML = '<div class="page-section"><div class="spinner"></div></div>';
    const data = await apiFetch('/api/home');
    let html = '';
    if (data.recentlyPlayed?.length) {
      html += `<div class="page-section"><div class="section-header"><span class="section-label">[+] recently played</span></div>${renderSongList(data.recentlyPlayed, 'recent')}</div>`;
    }
    if (data.mostPlayed?.length) {
      html += `<div class="page-section"><div class="section-header"><span class="section-label">[+] most played</span></div>${renderSongList(data.mostPlayed, 'popular')}</div>`;
    }
    if (data.newSongs?.length) {
      html += `<div class="page-section"><div class="section-header"><span class="section-label">[+] new additions</span></div>${renderSongList(data.newSongs, 'new')}</div>`;
    }
    if (!html) html = `<div class="page-section"><div class="empty-state"><div class="big">[~]</div><p>your library is empty<br>go to the admin panel to upload music</p></div></div>`;
    main.innerHTML = html;
    bindSongRows();
  }

  // ---- SEARCH ----
  let searchTimeout;
  function renderSearch() {
    main.innerHTML = `
      <div class="page-section">
        <div class="search-bar"><input type="search" id="searchInput" placeholder="search songs, albums, artists..." autofocus /></div>
        <div id="searchResults"></div>
      </div>`;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => doSearch(e.target.value), 300);
    });
  }

  async function doSearch(q) {
    const el = document.getElementById('searchResults');
    if (!el) return;
    if (!q) { el.innerHTML = ''; return; }
    const data = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    let html = '';
    if (data.songs?.length) {
      html += `<div class="section-header"><span class="section-label">songs</span></div>${renderSongList(data.songs, 'search')}`;
    }
    if (data.albums?.length) {
      html += `<div class="section-header" style="margin-top:16px"><span class="section-label">albums</span></div><div class="card-scroll">${data.albums.map(a => renderAlbumCard(a)).join('')}</div>`;
    }
    if (data.artists?.length) {
      html += `<div class="section-header" style="margin-top:16px"><span class="section-label">artists</span></div><ul class="song-list">${data.artists.map(a => `<li class="song-row" onclick="navigate('artist','${a.id}')"><div class="song-cover">[A]</div><div class="song-meta"><div class="song-title">${esc(a.name)}</div><div class="song-sub">${a.song_count||0} songs</div></div></li>`).join('')}</ul>`;
    }
    if (data.playlists?.length) {
      html += `<div class="section-header" style="margin-top:16px"><span class="section-label">playlists</span></div><ul class="song-list">${data.playlists.map(p => `<li class="song-row" onclick="navigate('playlist','${p.id}')"><div class="song-cover">[=]</div><div class="song-meta"><div class="song-title">${esc(p.name)}</div></div></li>`).join('')}</ul>`;
    }
    if (!html) html = '<div class="empty-state"><p>no results for &ldquo;' + esc(q) + '&rdquo;</p></div>';
    el.innerHTML = html;
    bindSongRows();
    el.querySelectorAll('.album-card').forEach(c => c.addEventListener('click', () => navigate('album', c.dataset.id)));
  }

  // ---- LIBRARY ----
  async function renderLibrary() {
    main.innerHTML = '<div class="page-section"><div class="spinner"></div></div>';
    const data = await apiFetch('/api/library');
    await loadPlaylists();
    let html = '<div class="page-section">';
    html += `<div class="section-header"><span class="section-label">[=] my library</span><button class="btn-primary" onclick="showCreatePlaylist()">[+] playlist</button></div>`;

    // Playlists
    if (playlists.length) {
      html += `<div style="margin-bottom:24px"><h3 style="margin-bottom:12px">playlists</h3>`;
      html += playlists.map(p => `<div class="playlist-item" onclick="navigate('playlist','${p.id}')">
        <div class="playlist-cover">[=]</div>
        <div class="song-meta"><div class="song-title">${esc(p.name)}</div><div class="song-sub">${p.description||'playlist'}</div></div>
      </div>`).join('');
      html += '</div>';
    }

    // Liked Songs
    if (data.songs?.length) {
      html += `<h3 style="margin-bottom:12px">saved songs</h3>${renderSongList(data.songs, 'library')}`;
    } else {
      html += '<div class="empty-state"><div class="big">[=]</div><p>no saved songs yet</p></div>';
    }

    html += '</div>';
    main.innerHTML = html;
    bindSongRows();
  }

  window.showCreatePlaylist = async function() {
    const name = prompt('playlist name:');
    if (!name) return;
    const desc = prompt('description (optional):') || '';
    await apiFetch('/api/playlists', 'POST', { name, description: desc });
    await loadPlaylists();
    navigate('library');
  };

  // ---- ALBUM PAGE ----
  async function renderAlbum(albumId) {
    main.innerHTML = '<div class="page-section"><div class="spinner"></div></div>';
    const album = await apiFetch(`/api/albums/${albumId}`);
    const coverSrc = album.cover ? `/stream/cover/${album.cover}` : null;
    let html = `
      <div class="artist-hero">
        ${coverSrc ? `<img src="${coverSrc}" style="width:100px;height:100px;border-radius:4px;object-fit:cover;margin-bottom:12px">` : '<div style="font-size:60px;margin-bottom:12px">[&#9834;]</div>'}
        <h1>${esc(album.title)}</h1>
        <p class="caption">${esc(album.artist_name||'unknown')} ${album.year ? '&middot; '+album.year : ''} ${album.is_audiobook ? '<span class="badge audiobook">h&ouml;rspiel</span>' : ''}</p>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn-primary" onclick="playAlbum('${album.id}')">[&#9654;] play all</button>
          ${currentUser?.role==='admin'||currentUser?.role==='creator' ? `<button class="btn-secondary" onclick="navigate('song','edit:${album.id}')">edit album</button>` : ''}
        </div>
      </div>
      <div class="page-section">
        <div class="section-header"><span class="section-label">[+] tracklist (${album.songs?.length||0})</span></div>
        ${renderSongList(album.songs||[], 'album_'+albumId)}
      </div>`;
    main.innerHTML = html;
    bindSongRows();
    window.playAlbum = (id) => { if (album.songs?.length) playQueue(album.songs, 0, album.is_audiobook); };
  }

  // ---- ARTIST PAGE ----
  async function renderArtist(artistId) {
    main.innerHTML = '<div class="page-section"><div class="spinner"></div></div>';
    const artist = await apiFetch(`/api/artists/${artistId}`);
    let html = `
      <div class="artist-hero">
        <div style="font-size:60px;margin-bottom:12px">[A]</div>
        <h1>${esc(artist.name)}</h1>
        <p class="caption">${artist.albums?.length||0} albums &middot; ${artist.songs?.length||0} songs</p>
      </div>
      <div class="page-section">`;
    if (artist.albums?.length) {
      html += `<div class="section-header"><span class="section-label">[+] albums</span></div><div class="card-scroll">${artist.albums.map(a=>renderAlbumCard(a)).join('')}</div>`;
    }
    if (artist.songs?.length) {
      html += `<div class="section-header" style="margin-top:24px"><span class="section-label">[+] all songs</span></div>${renderSongList(artist.songs, 'artist')}`;
    }
    html += '</div>';
    main.innerHTML = html;
    bindSongRows();
    main.querySelectorAll('.album-card').forEach(c => c.addEventListener('click', () => navigate('album', c.dataset.id)));
  }

  // ---- PLAYLIST PAGE ----
  async function renderPlaylist(playlistId) {
    main.innerHTML = '<div class="page-section"><div class="spinner"></div></div>';
    const playlist = await apiFetch(`/api/playlists/${playlistId}`);
    let html = `
      <div class="artist-hero">
        <div style="font-size:60px;margin-bottom:12px">[=]</div>
        <h1>${esc(playlist.name)}</h1>
        <p class="caption">${playlist.songs?.length||0} songs</p>
        <div style="margin-top:16px">
          <button class="btn-primary" onclick="playQueue([...document.querySelectorAll('[data-song-id]')].map(el=>JSON.parse(el.dataset.songData||'{}')).filter(s=>s.id), 0, false)">[&#9654;] play</button>
          <button class="btn-danger" style="margin-left:8px" onclick="deletePlaylist('${playlistId}')">[x] delete</button>
        </div>
      </div>
      <div class="page-section">
        ${renderSongList(playlist.songs||[], 'pl_'+playlistId)}
      </div>`;
    main.innerHTML = html;
    bindSongRows();
    window.deletePlaylist = async (id) => {
      if (!confirm('delete playlist?')) return;
      await apiFetch(`/api/playlists/${id}`, 'DELETE');
      await loadPlaylists();
      navigate('library');
    };
  }

  // ---- SONG INFO PAGE ----
  async function renderSong(songParam) {
    if (songParam?.startsWith('edit:')) { renderSongEdit(songParam.slice(5)); return; }
    const song = await apiFetch(`/api/songs/${songParam}`);
    const coverSrc = song.cover ? `/stream/cover/${song.cover}` : null;
    const html = `
      <div class="artist-hero">
        ${coverSrc ? `<img src="${coverSrc}" style="width:120px;height:120px;border-radius:4px;object-fit:cover;margin-bottom:12px">` : '<div style="font-size:64px;margin-bottom:12px">&#9834;</div>'}
        <h1>${esc(song.title)}</h1>
        <p class="caption">
          ${song.artist_name ? `<a href="#" onclick="navigate('artist','${song.artist_id}');return false">${esc(song.artist_name)}</a>` : 'unknown artist'}
          ${song.album_title ? ` &middot; <a href="#" onclick="navigate('album','${song.album_id}');return false">${esc(song.album_title)}</a>` : ''}
          ${song.is_audiobook ? '<span class="badge audiobook">h&ouml;rspiel</span>' : ''}
        </p>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-primary" onclick="playSong(currentSongData)">[&#9654;] play</button>
          <button class="btn-secondary" onclick="addToLibrary('${song.id}')">[+] library</button>
          ${currentUser?.role==='admin'||currentUser?.role==='creator' ? `<button class="btn-secondary" onclick="navigate('song','edit:${song.id}')">edit</button>` : ''}
        </div>
      </div>
      <div class="page-section">
        <div class="section-header"><span class="section-label">song info</span></div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${renderInfoRow('title', song.title)}
          ${renderInfoRow('artist', song.artist_name)}
          ${renderInfoRow('album', song.album_title)}
          ${renderInfoRow('genre', song.genre)}
          ${renderInfoRow('year', song.year)}
          ${renderInfoRow('duration', formatTime(song.duration))}
          ${renderInfoRow('plays', song.play_count)}
          ${renderInfoRow('type', song.is_audiobook ? 'h&ouml;rspiel' : 'song')}
        </table>
      </div>`;
    main.innerHTML = html;
    window.currentSongData = song;
    window.addToLibrary = async (id) => {
      await apiFetch('/api/library/song', 'POST', { songId: id });
      alert('[+] added to library');
    };
  }

  function renderInfoRow(label, value) {
    if (!value) return '';
    return `<tr><td style="padding:8px 0;color:var(--mute);width:120px">${label}</td><td style="padding:8px 0">${value}</td></tr>`;
  }

  // ---- SONG EDIT PAGE ----
  async function renderSongEdit(id) {
    if (!currentUser || !['admin','creator'].includes(currentUser.role)) { navigate('home'); return; }
    const song = await apiFetch(`/api/songs/${id}`);
    const html = `
      <div class="page-section">
        <div class="section-header"><span class="section-label">[+] edit song</span></div>
        <form id="editSongForm">
          <div class="form-row"><label>title</label><input name="title" value="${esc(song.title)}" /></div>
          <div class="form-row"><label>genre</label><input name="genre" value="${esc(song.genre||'')}" /></div>
          <div class="form-row"><label>year</label><input name="year" type="number" value="${song.year||''}" /></div>
          <div class="form-row"><label>track #</label><input name="track_number" type="number" value="${song.track_number||''}" /></div>
          <div class="checkbox-row"><input type="checkbox" name="is_audiobook" id="isAb" ${song.is_audiobook?'checked':''}><label for="isAb">h&ouml;rspiel / audiobook</label></div>
          <div id="editErr" class="error-msg" style="display:none"></div>
          <div style="margin-top:16px;display:flex;gap:8px">
            <button type="submit" class="btn-primary">save changes</button>
            <button type="button" class="btn-secondary" onclick="history.back()">cancel</button>
          </div>
        </form>
      </div>`;
    main.innerHTML = html;
    document.getElementById('editSongForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      fd.is_audiobook = !!fd.is_audiobook;
      const res = await fetch(`/admin/songs/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(fd) });
      if (res.ok) navigate('song', id);
      else { document.getElementById('editErr').textContent = 'save failed'; document.getElementById('editErr').style.display='block'; }
    });
  }

  // ---- ADMIN PANEL ----
  function renderAdmin() {
    if (!currentUser || !['admin','creator'].includes(currentUser.role)) { navigate('home'); return; }
    main.innerHTML = `
      <div class="admin-grid">
        <div class="admin-sidebar">
          <button class="admin-sidebar-item active" data-tab="upload" onclick="adminTab(this,'upload')">[+] upload</button>
          <button class="admin-sidebar-item" data-tab="songs" onclick="adminTab(this,'songs')">[=] songs</button>
          <button class="admin-sidebar-item" data-tab="albums" onclick="adminTab(this,'albums')">[&#9834;] albums</button>
          ${currentUser.role==='admin'?`<button class="admin-sidebar-item" data-tab="users" onclick="adminTab(this,'users')">[u] users</button>`:''}          
          <button class="admin-sidebar-item" data-tab="stats" onclick="adminTab(this,'stats')">[%] stats</button>
        </div>
        <div class="admin-main" id="adminMain"></div>
      </div>`;
    adminTab(document.querySelector('[data-tab="upload"]'), 'upload');
  }

  window.adminTab = function(el, tab) {
    document.querySelectorAll('.admin-sidebar-item').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
    const m = document.getElementById('adminMain');
    if (tab === 'upload') renderAdminUpload(m);
    else if (tab === 'songs') renderAdminSongs(m);
    else if (tab === 'albums') renderAdminAlbums(m);
    else if (tab === 'users') renderAdminUsers(m);
    else if (tab === 'stats') renderAdminStats(m);
  };

  function renderAdminUpload(container) {
    container.innerHTML = `
      <h2 style="margin-bottom:24px">[+] upload music</h2>
      <form id="uploadForm" enctype="multipart/form-data">
        <div class="upload-zone" id="uploadZone">
          <input type="file" id="fileInput" name="files" multiple accept=".mp3,.m4a,.flac,.ogg,.wav" style="display:none">
          <div class="upload-label">[+] click or drag files here</div>
          <div class="upload-sub">mp3, m4a, flac, ogg, wav &mdash; max 200 MB each</div>
          <button type="button" class="btn-secondary" style="margin-top:12px" onclick="document.getElementById('fileInput').click()">choose files</button>
        </div>
        <div id="fileList" style="margin-bottom:16px"></div>
        <div class="form-section">
          <div class="section-label" style="margin-bottom:12px">[+] metadata override (optional)</div>
          <div class="form-row"><label>artist (overrides extracted)</label><input name="artist" placeholder="auto from tags" /></div>
          <div class="form-row"><label>album title</label><input name="album" placeholder="auto from tags" /></div>
          <div class="form-row"><label>song title (single upload only)</label><input name="title" placeholder="auto from tags" /></div>
          <div class="form-row"><label>album cover image</label><input type="file" name="cover" accept="image/*" id="coverInput" /></div>
          <div class="checkbox-row"><input type="checkbox" name="isAudiobook" id="isAbUpload"><label for="isAbUpload">mark as h&ouml;rspiel / audiobook</label></div>
        </div>
        <div id="uploadProgress"></div>
        <button type="submit" class="btn-primary">[&#9650;] upload</button>
      </form>`;
    // Drag & drop
    const zone = document.getElementById('uploadZone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); document.getElementById('fileInput').files = e.dataTransfer.files; updateFileList(); });
    document.getElementById('fileInput').addEventListener('change', updateFileList);
    document.getElementById('uploadForm').addEventListener('submit', doUpload);
  }

  function updateFileList() {
    const files = document.getElementById('fileInput').files;
    const el = document.getElementById('fileList');
    if (!files.length) { el.innerHTML = ''; return; }
    el.innerHTML = Array.from(files).map(f => `<div class="upload-progress">[+] ${esc(f.name)} (${(f.size/1024/1024).toFixed(1)} MB)</div>`).join('');
  }

  async function doUpload(e) {
    e.preventDefault();
    const form = e.target;
    const progressEl = document.getElementById('uploadProgress');
    progressEl.innerHTML = '<div class="spinner"></div> uploading...';
    const fd = new FormData(form);
    try {
      const res = await fetch('/admin/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.success) {
        progressEl.innerHTML = `<div class="badge success">[+] ${json.uploaded} file(s) uploaded successfully</div>`;
        form.reset();
        document.getElementById('fileList').innerHTML = '';
      } else {
        progressEl.innerHTML = `<div class="error-msg">${json.error || 'upload failed'}</div>`;
      }
    } catch (err) {
      progressEl.innerHTML = `<div class="error-msg">upload failed: ${err.message}</div>`;
    }
  }

  async function renderAdminSongs(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const songs = await apiFetch('/api/songs');
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h2>[=] songs (${songs.length})</h2>
      </div>
      <ul class="song-list">${songs.map(s => `
        <li class="song-row" data-song-id="${s.id}">
          <div class="song-cover">${s.cover ? `<img src="/stream/cover/${s.cover}">` : '&#9834;'}</div>
          <div class="song-meta">
            <div class="song-title">${esc(s.title)} ${s.is_audiobook?'<span class="badge audiobook">h&ouml;rspiel</span>':''}</div>
            <div class="song-sub">${esc(s.artist_name||'')} &middot; ${esc(s.album_title||'')} &middot; ${formatTime(s.duration)}</div>
          </div>
          <button class="btn-icon" onclick="navigate('song','edit:${s.id}')">edit</button>
          <button class="btn-danger" onclick="adminDeleteSong('${s.id}')">del</button>
        </li>`).join('')}
      </ul>`;
    window.adminDeleteSong = async (id) => {
      if (!confirm('delete this song?')) return;
      await fetch(`/admin/songs/${id}`, { method: 'DELETE' });
      renderAdminSongs(container);
    };
  }

  async function renderAdminAlbums(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const albums = await apiFetch('/api/albums');
    container.innerHTML = `
      <h2 style="margin-bottom:16px">[&#9834;] albums (${albums.length})</h2>
      <div class="card-scroll">${albums.map(a => `
        <div class="album-card">
          <div class="album-cover" onclick="navigate('album','${a.id}')">${a.cover ? `<img src="/stream/cover/${a.cover}">` : '[&#9834;]'}</div>
          <div class="album-card-title">${esc(a.title)}</div>
          <div class="album-card-sub">${esc(a.artist_name||'')}</div>
          <button class="btn-danger" style="margin-top:4px;width:100%;font-size:11px" onclick="adminDeleteAlbum('${a.id}')">delete album</button>
        </div>`).join('')}
      </div>`;
    window.adminDeleteAlbum = async (id) => {
      if (!confirm('delete album and all songs?')) return;
      await fetch(`/admin/albums/${id}`, { method: 'DELETE' });
      renderAdminAlbums(container);
    };
  }

  async function renderAdminUsers(container) {
    if (currentUser?.role !== 'admin') return;
    container.innerHTML = '<div class="spinner"></div>';
    const users = await apiFetch('/api/users');
    container.innerHTML = `
      <h2 style="margin-bottom:16px">[u] users</h2>
      <button class="btn-primary" style="margin-bottom:16px" onclick="adminCreateUser()">[+] new user</button>
      <ul class="song-list">${users.map(u => `
        <li class="song-row">
          <div class="song-meta">
            <div class="song-title">${esc(u.username)} <span class="badge">${u.role}</span></div>
          </div>
          ${u.id !== currentUser.id ? `<button class="btn-danger" onclick="adminDeleteUser('${u.id}')">del</button>` : '<span class="mute caption">you</span>'}
        </li>`).join('')}
      </ul>`;
    window.adminCreateUser = async () => {
      const username = prompt('username:'); if (!username) return;
      const password = prompt('password:'); if (!password) return;
      const role = prompt('role (user/creator/admin):', 'user') || 'user';
      const res = await apiFetch('/api/users', 'POST', { username, password, role });
      if (res.error) alert(res.error);
      else renderAdminUsers(container);
    };
    window.adminDeleteUser = async (id) => {
      if (!confirm('delete user?')) return;
      await apiFetch(`/api/users/${id}`, 'DELETE');
      renderAdminUsers(container);
    };
  }

  async function renderAdminStats(container) {
    container.innerHTML = '<div class="spinner"></div>';
    const stats = await apiFetch('/api/stats');
    const usedGb = (stats.storageUsedBytes / 1024 / 1024 / 1024).toFixed(2);
    const pct = Math.min(100, (usedGb / stats.maxStorageGb) * 100).toFixed(0);
    container.innerHTML = `
      <h2 style="margin-bottom:24px">[%] statistics</h2>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${stats.songs}</div><div class="stat-label">songs</div></div>
        <div class="stat-card"><div class="stat-value">${stats.albums}</div><div class="stat-label">albums</div></div>
        <div class="stat-card"><div class="stat-value">${stats.artists}</div><div class="stat-label">artists</div></div>
        <div class="stat-card"><div class="stat-value">${stats.users}</div><div class="stat-label">users</div></div>
      </div>
      <div class="stat-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between"><span class="stat-label">storage used</span><span class="stat-label">${usedGb} / ${stats.maxStorageGb} GB</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  // ---- AUDIO ENGINE ----
  function playQueue(songs, index, isAb) {
    queue = songs;
    queueIndex = index;
    audiobook = isAb || false;
    playSong(songs[index]);
  }
  window.playQueue = playQueue;

  function playSong(song) {
    if (!song?.id) return;
    currentSong = song;
    audiobook = !!song.is_audiobook;
    audio.src = `/stream/${song.id}`;
    audio.play().catch(()=>{});
    isPlaying = true;
    apiFetch(`/api/songs/${song.id}/play`, 'POST', {});
    updateNowPlaying();
  }
  window.playSong = playSong;

  function stopAudio() {
    audio.pause();
    audio.src = '';
    isPlaying = false;
    npBar.style.display = 'none';
    currentSong = null;
  }

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    npSeek.value = (audio.currentTime / audio.duration) * 100;
    npCurrentTime.textContent = formatTime(Math.floor(audio.currentTime));
  });
  audio.addEventListener('loadedmetadata', () => {
    npDuration.textContent = formatTime(Math.floor(audio.duration));
  });
  audio.addEventListener('ended', () => {
    if (!audiobook && queueIndex < queue.length - 1) {
      queueIndex++;
      playSong(queue[queueIndex]);
    } else {
      isPlaying = false;
      updateNowPlayingControls();
    }
  });
  npSeek.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (npSeek.value / 100) * audio.duration;
  });

  function updateNowPlaying() {
    if (!currentSong) return;
    npBar.style.display = 'grid';
    const coverHtml = currentSong.cover
      ? `<img src="/stream/cover/${currentSong.cover}" class="np-cover" style="object-fit:cover">`
      : `<div class="np-cover">&#9834;</div>`;
    npInfo.innerHTML = `${coverHtml}<div class="np-text"><div class="np-title">${esc(currentSong.title)}</div><div class="np-artist">${esc(currentSong.artist_name||'unknown')}</div></div>`;
    npInfo.addEventListener('click', () => { if (currentSong) navigate('song', currentSong.id); });
    updateNowPlayingControls();
  }

  function updateNowPlayingControls() {
    const ab = audiobook;
    npControls.innerHTML = ab
      ? `<button class="np-btn" onclick="seekRel(-15)">-15</button>
         <button class="np-btn" onclick="togglePlay()">${isPlaying?'[&#9646;&#9646;]':'[&#9654;]'}</button>
         <button class="np-btn" onclick="seekRel(15)">+15</button>`
      : `<button class="np-btn" onclick="prevSong()">[&#9664;&#9664;]</button>
         <button class="np-btn" onclick="togglePlay()">${isPlaying?'[&#9646;&#9646;]':'[&#9654;]'}</button>
         <button class="np-btn" onclick="nextSong()">[&#9654;&#9654;]</button>`;
  }

  window.togglePlay = function() {
    if (audio.paused) { audio.play(); isPlaying = true; }
    else { audio.pause(); isPlaying = false; }
    updateNowPlayingControls();
  };
  window.nextSong = function() {
    if (queueIndex < queue.length - 1) { queueIndex++; playSong(queue[queueIndex]); }
  };
  window.prevSong = function() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (queueIndex > 0) { queueIndex--; playSong(queue[queueIndex]); }
  };
  window.seekRel = function(secs) {
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + secs));
  };

  // ---- CONTEXT MENU ----
  function showContextMenu(x, y, song) {
    contextMenu.style.display = 'block';
    contextMenu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    contextMenu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    let html = `<button class="context-item" onclick="playSong(${JSON.stringify(song).replace(/"/g,'&quot;')});hideCtx()">[&#9654;] play</button>`;
    html += `<button class="context-item" onclick="navigate('song','${song.id}');hideCtx()">song info</button>`;
    if (song.album_id) html += `<button class="context-item" onclick="navigate('album','${song.album_id}');hideCtx()">view album</button>`;
    if (song.artist_id) html += `<button class="context-item" onclick="navigate('artist','${song.artist_id}');hideCtx()">view artist</button>`;
    html += `<button class="context-item" onclick="addSongToPlaylist('${song.id}');hideCtx()">[+] add to playlist</button>`;
    html += `<button class="context-item" onclick="addToLibraryCtx('${song.id}');hideCtx()">[+] save to library</button>`;
    if (currentUser?.role==='admin'||currentUser?.role==='creator') {
      html += `<button class="context-item danger" onclick="navigate('song','edit:${song.id}');hideCtx()">edit</button>`;
    }
    contextMenu.innerHTML = html;
    window.hideCtx = () => { contextMenu.style.display = 'none'; };
    window.addToLibraryCtx = async (id) => { await apiFetch('/api/library/song','POST',{songId:id}); };
    window.addSongToPlaylist = async (songId) => {
      if (!playlists.length) { alert('create a playlist first'); return; }
      const names = playlists.map((p,i)=>`${i+1}. ${p.name}`).join('\n');
      const idx = parseInt(prompt(`choose playlist:\n${names}`)) - 1;
      if (idx >= 0 && playlists[idx]) {
        await apiFetch(`/api/playlists/${playlists[idx].id}/songs`, 'POST', { songId });
      }
    };
  }

  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.style.display = 'none';
  });

  // ---- HELPERS ----
  function renderSongList(songs, queueKey) {
    if (!songs?.length) return '<div class="empty-state"><p>no songs</p></div>';
    return `<ul class="song-list">${songs.map((s, i) => `
      <li class="song-row" data-song-id="${s.id}" data-queue="${queueKey}" data-queue-idx="${i}" data-song-data='${JSON.stringify(s).replace(/'/g,'&apos;')}'>
        <div class="song-cover">${s.cover ? `<img src="/stream/cover/${s.cover}">` : '&#9834;'}</div>
        <div class="song-meta">
          <div class="song-title">${esc(s.title)} ${s.is_audiobook?'<span class="badge audiobook">hs</span>':''}</div>
          <div class="song-sub">${esc(s.artist_name||'')}${s.album_title?' &middot; '+esc(s.album_title):''}</div>
        </div>
        <span class="song-duration">${formatTime(s.duration)}</span>
        <button class="song-more" data-song-id="${s.id}">&hellip;</button>
      </li>`).join('')}
    </ul>`;
  }

  function renderAlbumCard(a) {
    return `<div class="album-card" data-id="${a.id}">
      <div class="album-cover">${a.cover ? `<img src="/stream/cover/${a.cover}">` : '[&#9834;]'}</div>
      <div class="album-card-title">${esc(a.title)}</div>
      <div class="album-card-sub">${esc(a.artist_name||'')}</div>
    </div>`;
  }

  function bindSongRows() {
    const queueMap = {};
    main.querySelectorAll('[data-queue]').forEach(el => {
      const key = el.dataset.queue;
      if (!queueMap[key]) queueMap[key] = [];
      try { queueMap[key].push(JSON.parse(el.dataset.songData.replace(/&apos;/g,"'")));  } catch {}
    });
    main.querySelectorAll('.song-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('song-more')) return;
        if (e.target.closest('.song-more')) return;
        const key = row.dataset.queue;
        const idx = parseInt(row.dataset.queueIdx);
        const q = queueMap[key] || [];
        if (q.length) playQueue(q, idx, q[idx]?.is_audiobook);
        else { try { playSong(JSON.parse(row.dataset.songData.replace(/&apos;/g,"'"))); } catch {} }
      });
      const moreBtn = row.querySelector('.song-more');
      if (moreBtn) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try { const s = JSON.parse(row.dataset.songData.replace(/&apos;/g,"'")); showContextMenu(e.clientX, e.clientY, s); } catch {}
        });
      }
    });
  }

  async function apiFetch(url, method = 'GET', body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch { return {}; }
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2,'0')}`;
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Start
  init();
})();
