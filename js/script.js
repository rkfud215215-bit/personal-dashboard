(() => {
  'use strict';

  // ---------- Supabase config ----------
  // The URL + publishable ("anon") key are meant to ship in client-side code —
  // real data protection comes from the email/password login gate + Row Level
  // Security policies (see supabase/schema.sql), not from hiding these values.
  const SUPABASE_URL = 'https://hssifqqzfxwmjvdgdtsc.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_GaiDq9NdnkOITfvy50OGbg_yt6606qC';
  const MEDIA_BUCKET = 'dashboard-media';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // TMDB v3 API key — embedded client-side is TMDB's supported usage pattern for browser apps.
  const TMDB_API_KEY = '975c807f73d5af29d71e50a5264da6c8';
  const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w300';

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const todayStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const escapeHtml = (str) =>
    String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function addDaysToDateStr(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }
  function formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return { date: `${MONTHS_EN[m - 1]} ${d}`, weekday: WEEKDAYS_EN[dt.getDay()] };
  }

  const state = {
    profile: { name: '', photo: '', zoom: 100, offsetX: 0, offsetY: 0 },
    background: { type: 'default', value: '' },
    todos: [],
    habits: [],
    archive: { movies: [], series: [] },
    diary: []
  };

  // ---------- Media (Supabase Storage) helpers ----------
  // DB rows store either a Storage *path* (uploaded photos) or a plain
  // external URL (pasted image links, TMDB posters). isExternalUrl tells
  // them apart; mediaUrl() resolves a path to a usable <img src>.
  const isExternalUrl = (v) => /^https?:\/\//.test(v) || v.startsWith('data:');
  const mediaUrlCache = new Map();
  function mediaUrl(path) {
    if (!path) return '';
    if (isExternalUrl(path)) return path;
    return mediaUrlCache.get(path) || '';
  }
  async function resolveMediaUrls(paths) {
    const targets = [...new Set(paths.filter((p) => p && !isExternalUrl(p) && !mediaUrlCache.has(p)))];
    if (!targets.length) return;
    const { data, error } = await supabaseClient.storage.from(MEDIA_BUCKET).createSignedUrls(targets, 3600);
    if (error) { console.error(error); return; }
    data.forEach((d, i) => { if (d && d.signedUrl) mediaUrlCache.set(targets[i], d.signedUrl); });
  }
  async function uploadMedia(blob, folder) {
    const path = `${currentUser.id}/${folder}/${uid()}.jpg`;
    const { error } = await supabaseClient.storage.from(MEDIA_BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false
    });
    if (error) throw error;
    await resolveMediaUrls([path]);
    return path;
  }

  // ---------- Image resize helper (keeps uploads small) ----------
  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not load the image.'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round(height * (maxDim / width));
              width = maxDim;
            } else {
              width = Math.round(width * (maxDim / height));
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob); else reject(new Error('Could not encode the image.'));
          }, 'image/jpeg', quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Navigation ----------
  const menuItems = document.querySelectorAll('.menu-item');
  const panels = document.querySelectorAll('.panel');

  menuItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;
      menuItems.forEach((b) => b.classList.toggle('active', b === btn));
      panels.forEach((p) => p.classList.toggle('active', p.id === `section-${target}`));
    });
  });

  // ================= PROFILE / SIDEBAR =================
  const avatarWrap = document.getElementById('avatarWrap');
  const avatarImg = document.getElementById('avatarImg');
  const profileNameEl = document.getElementById('profileName');

  // Computes how a natural-size image should be scaled + translated to cover a
  // (square) box, given a zoom factor and a normalized (box-size-independent) offset.
  function computeAvatarLayout(natW, natH, boxW, boxH, zoom, offX, offY) {
    const coverScale = Math.max(boxW / natW, boxH / natH);
    const scale = coverScale * zoom;
    const renderedW = natW * scale;
    const renderedH = natH * scale;
    const baseX = (boxW - renderedW) / 2;
    const baseY = (boxH - renderedH) / 2;
    const halfRangeX = Math.max(0, (renderedW - boxW) / 2);
    const halfRangeY = Math.max(0, (renderedH - boxH) / 2);
    const offXpx = clamp(offX * boxW, -halfRangeX, halfRangeX);
    const offYpx = clamp(offY * boxH, -halfRangeY, halfRangeY);
    return {
      scale,
      tx: baseX + offXpx,
      ty: baseY + offYpx,
      clampedOffX: boxW ? offXpx / boxW : 0,
      clampedOffY: boxH ? offYpx / boxH : 0
    };
  }

  function applyAvatarLayout(imgEl, boxW, boxH) {
    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    if (!natW || !natH || !boxW || !boxH) return;
    const zoom = (state.profile.zoom || 100) / 100;
    const offX = state.profile.offsetX || 0;
    const offY = state.profile.offsetY || 0;
    const layout = computeAvatarLayout(natW, natH, boxW, boxH, zoom, offX, offY);
    imgEl.style.width = `${natW}px`;
    imgEl.style.height = `${natH}px`;
    imgEl.style.transform = `translate(${layout.tx}px, ${layout.ty}px) scale(${layout.scale})`;
    return layout;
  }

  function layoutAllAvatars() {
    if (avatarImg.complete && avatarImg.naturalWidth) {
      applyAvatarLayout(avatarImg, avatarWrap.clientWidth, avatarWrap.clientHeight);
    }
    if (avatarPreviewImg.complete && avatarPreviewImg.naturalWidth) {
      applyAvatarLayout(avatarPreviewImg, avatarPreviewFrame.clientWidth, avatarPreviewFrame.clientHeight);
    }
  }

  function renderProfile() {
    profileNameEl.textContent = state.profile.name.trim() || 'Set your name';
    const src = mediaUrl(state.profile.photo);
    if (src) {
      if (avatarImg.getAttribute('src') !== src) avatarImg.src = src;
      avatarWrap.classList.add('has-photo');
    } else {
      avatarImg.removeAttribute('src');
      avatarWrap.classList.remove('has-photo');
    }
    layoutAllAvatars();
  }

  avatarImg.addEventListener('load', layoutAllAvatars);
  window.addEventListener('resize', layoutAllAvatars);

  // ================= BACKGROUND =================
  const bgLayer = document.getElementById('bgLayer');
  function renderBackground() {
    const src = state.background.type === 'custom' ? mediaUrl(state.background.value) : '';
    if (src) {
      bgLayer.classList.remove('default-bg');
      bgLayer.style.backgroundImage = `url("${src}")`;
    } else {
      bgLayer.classList.add('default-bg');
      bgLayer.style.backgroundImage = '';
    }
  }

  // ================= TODO =================
  const todoForm = document.getElementById('todoForm');
  const todoInput = document.getElementById('todoInput');
  const todoDateInput = document.getElementById('todoDate');
  const todoDays = document.getElementById('todoDays');
  const todoPrev = document.getElementById('todoPrev');
  const todoNext = document.getElementById('todoNext');
  const todoToday = document.getElementById('todoToday');

  todoDateInput.value = todayStr();
  let todoWindowStart = todayStr();

  function renderTodos() {
    todoDays.innerHTML = '';
    const today = todayStr();
    for (let i = 0; i < 3; i++) {
      const dateStr = addDaysToDateStr(todoWindowStart, i);
      const { date: dateLabel, weekday } = formatDateLabel(dateStr);
      const dayTodos = state.todos
        .filter((t) => t.date === dateStr)
        .sort((a, b) => b.createdAt - a.createdAt);

      const dayEl = document.createElement('div');
      dayEl.className = 'todo-day glass-card' + (dateStr === today ? ' is-today' : '');
      dayEl.dataset.date = dateStr;
      dayEl.innerHTML = `
        <div class="todo-day-header">
          <span class="todo-day-date">${dateLabel}${dateStr === today ? ' · Today' : ''}</span>
          <span class="todo-day-weekday">${weekday}</span>
        </div>
        <ul class="todo-list"></ul>
        <p class="empty-msg" style="display:${dayTodos.length ? 'none' : 'block'}">No tasks.</p>
      `;
      const listEl = dayEl.querySelector('.todo-list');
      dayTodos.forEach((t) => {
        const li = document.createElement('li');
        li.className = 'todo-item' + (t.done ? ' done' : '');
        li.dataset.id = t.id;
        li.innerHTML = `
          <button class="todo-check" title="Toggle done">${t.done ? '✓' : ''}</button>
          <span class="todo-text"></span>
          <button class="btn-icon todo-delete" title="Delete">✕</button>
        `;
        li.querySelector('.todo-text').textContent = t.text;
        listEl.appendChild(li);
      });
      todoDays.appendChild(dayEl);
    }
  }

  todoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    const date = todoDateInput.value || todayStr();
    const { data, error } = await supabaseClient.from('todos')
      .insert({ user_id: currentUser.id, text, date, done: false })
      .select().single();
    if (error) { alert('Could not add task: ' + error.message); return; }
    state.todos.unshift({ id: data.id, text: data.text, date: data.date, done: data.done, createdAt: new Date(data.created_at).getTime() });
    todoInput.value = '';
    renderTodos();
  });

  todoDays.addEventListener('click', async (e) => {
    const li = e.target.closest('.todo-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.todo-check')) {
      const t = state.todos.find((x) => x.id === id);
      if (!t) return;
      const done = !t.done;
      const { error } = await supabaseClient.from('todos').update({ done }).eq('id', id);
      if (error) { alert('Could not update task: ' + error.message); return; }
      t.done = done;
      renderTodos();
    } else if (e.target.closest('.todo-delete')) {
      if (!confirm('Delete this task?')) return;
      const { error } = await supabaseClient.from('todos').delete().eq('id', id);
      if (error) { alert('Could not delete task: ' + error.message); return; }
      state.todos = state.todos.filter((x) => x.id !== id);
      renderTodos();
    }
  });

  todoPrev.addEventListener('click', () => {
    todoWindowStart = addDaysToDateStr(todoWindowStart, -3);
    renderTodos();
  });
  todoNext.addEventListener('click', () => {
    todoWindowStart = addDaysToDateStr(todoWindowStart, 3);
    renderTodos();
  });
  todoToday.addEventListener('click', () => {
    todoWindowStart = todayStr();
    renderTodos();
  });

  // ================= HABIT TRACKER =================
  const habitForm = document.getElementById('habitForm');
  const habitName = document.getElementById('habitName');
  const habitGoal = document.getElementById('habitGoal');
  const habitList = document.getElementById('habitList');
  const habitEmpty = document.getElementById('habitEmpty');

  function plantStage(pct) {
    if (pct >= 100) return '✨🌻✨';
    if (pct >= 75) return '🌸';
    if (pct >= 50) return '🌷';
    if (pct >= 25) return '🌿';
    return '🌱';
  }

  function renderHabits() {
    habitList.innerHTML = '';
    habitEmpty.style.display = state.habits.length ? 'none' : 'block';
    const today = todayStr();
    state.habits.forEach((h) => {
      const successDays = Object.keys(h.log || {}).length;
      const pct = Math.min(100, Math.round((successDays / h.goalDays) * 100));
      const checkedToday = !!(h.log && h.log[today]);

      const card = document.createElement('div');
      card.className = 'habit-card';
      card.dataset.id = h.id;
      card.innerHTML = `
        <div class="habit-top">
          <div class="habit-plant">${plantStage(pct)}</div>
          <div style="flex:1; min-width:0;">
            <div class="habit-name-row">
              <div class="habit-name"></div>
              <button class="btn-icon habit-delete" title="Delete">✕</button>
            </div>
          </div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="habit-meta"><span>${successDays} / ${h.goalDays} days</span><span>${pct}%</span></div>
        <div class="habit-actions">
          <button class="btn-check${checkedToday ? ' checked' : ''}">${checkedToday ? 'Done Today ✓' : 'Mark Today Done'}</button>
        </div>
      `;
      card.querySelector('.habit-name').textContent = h.name;
      habitList.appendChild(card);
    });
  }

  habitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = habitName.value.trim();
    const goal = parseInt(habitGoal.value, 10);
    if (!name || !goal || goal < 1) return;
    const { data, error } = await supabaseClient.from('habits')
      .insert({ user_id: currentUser.id, name, goal_days: goal, log: {} })
      .select().single();
    if (error) { alert('Could not add habit: ' + error.message); return; }
    state.habits.unshift({ id: data.id, name: data.name, goalDays: data.goal_days, log: data.log || {}, createdAt: new Date(data.created_at).getTime() });
    habitName.value = '';
    habitGoal.value = '';
    renderHabits();
  });

  habitList.addEventListener('click', async (e) => {
    const card = e.target.closest('.habit-card');
    if (!card) return;
    const id = card.dataset.id;
    const h = state.habits.find((x) => x.id === id);
    if (!h) return;

    if (e.target.closest('.habit-delete')) {
      if (!confirm(`Delete habit '${h.name}'? All progress will be lost too.`)) return;
      const { error } = await supabaseClient.from('habits').delete().eq('id', id);
      if (error) { alert('Could not delete habit: ' + error.message); return; }
      state.habits = state.habits.filter((x) => x.id !== id);
      renderHabits();
      return;
    }

    if (e.target.closest('.btn-check')) {
      const today = todayStr();
      const newLog = { ...(h.log || {}) };
      if (newLog[today]) delete newLog[today]; else newLog[today] = true;
      const { error } = await supabaseClient.from('habits').update({ log: newLog }).eq('id', id);
      if (error) { alert('Could not update habit: ' + error.message); return; }
      h.log = newLog;
      renderHabits();
    }
  });

  // ================= ARCHIVE =================
  const archiveTabs = document.querySelectorAll('.tab-btn');
  const archiveForm = document.getElementById('archiveForm');
  const archiveSearch = document.getElementById('archiveSearch');
  const archiveStatus = document.getElementById('archiveStatus');
  const archiveRating = document.getElementById('archiveRating');
  const archiveMemo = document.getElementById('archiveMemo');
  const archiveResults = document.getElementById('archiveResults');
  const archiveSearchStatus = document.getElementById('archiveSearchStatus');
  const archiveSelectedChip = document.getElementById('archiveSelectedChip');
  const archiveSelectedPoster = document.getElementById('archiveSelectedPoster');
  const archiveSelectedLabel = document.getElementById('archiveSelectedLabel');
  const archiveSelectedClear = document.getElementById('archiveSelectedClear');
  const archiveList = document.getElementById('archiveList');
  const archiveEmpty = document.getElementById('archiveEmpty');

  let currentArchiveTab = 'movies';
  let archiveSelection = null;
  let archiveSearchTimer = null;
  let archiveSearchSeq = 0;

  archiveTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentArchiveTab = btn.dataset.tab;
      archiveTabs.forEach((b) => b.classList.toggle('active', b === btn));
      clearArchiveSelection();
      archiveResults.innerHTML = '';
      archiveSearchStatus.textContent = '';
      renderArchive();
    });
  });

  const statusLabel = { planned: 'Plan to Watch', watching: 'Watching', completed: 'Completed' };
  const tmdbType = () => (currentArchiveTab === 'movies' ? 'movie' : 'tv');

  function clearArchiveSelection() {
    archiveSelection = null;
    archiveSelectedChip.classList.remove('show');
    archiveSelectedPoster.src = '';
  }

  function selectArchiveResult(result) {
    const isMovie = tmdbType() === 'movie';
    const title = isMovie ? result.title : result.name;
    const dateStr = isMovie ? result.release_date : result.first_air_date;
    const year = dateStr ? dateStr.slice(0, 4) : '';
    archiveSelection = {
      tmdbId: result.id,
      title,
      year,
      poster: result.poster_path ? (TMDB_IMG_BASE + result.poster_path) : ''
    };
    archiveSearch.value = title;
    archiveSelectedLabel.textContent = year ? (title + ' (' + year + ')') : title;
    archiveSelectedPoster.src = archiveSelection.poster;
    archiveSelectedChip.classList.toggle('show', !!archiveSelection.poster);
    archiveResults.innerHTML = '';
  }

  function renderArchiveResults(results) {
    const isMovie = tmdbType() === 'movie';
    archiveResults.innerHTML = '';
    results.forEach((r) => {
      const title = isMovie ? r.title : r.name;
      const dateStr = isMovie ? r.release_date : r.first_air_date;
      const year = dateStr ? dateStr.slice(0, 4) : '';
      const card = document.createElement('div');
      card.className = 'archive-result-card';
      const posterHtml = r.poster_path
        ? '<img class="archive-result-poster" src="' + TMDB_IMG_BASE + r.poster_path + '" alt="">'
        : '<div class="archive-result-poster" style="display:flex;align-items:center;justify-content:center;font-size:22px;">🎬</div>';
      card.innerHTML = posterHtml
        + '<div class="archive-result-title"></div>'
        + '<div class="archive-result-year"></div>';
      card.querySelector('.archive-result-title').textContent = title;
      card.querySelector('.archive-result-year').textContent = year;
      card.addEventListener('click', () => selectArchiveResult(r));
      archiveResults.appendChild(card);
    });
  }

  function requestArchiveSearch(query) {
    const seq = ++archiveSearchSeq;
    archiveSearchStatus.textContent = 'Searching…';
    const endpoint = 'https://api.themoviedb.org/3/search/' + tmdbType();
    const url = endpoint + '?api_key=' + TMDB_API_KEY + '&language=en-US&query=' + encodeURIComponent(query);
    fetch(url)
      .then((res) => {
        if (seq !== archiveSearchSeq) return null;
        if (!res.ok) throw new Error('Request failed');
        return res.json();
      })
      .then((data) => {
        if (!data || seq !== archiveSearchSeq) return;
        const results = (data.results || []).slice(0, 10);
        archiveSearchStatus.textContent = results.length ? '' : "No results found. You can still add it by typing the title manually.";
        renderArchiveResults(results);
      })
      .catch(() => {
        if (seq !== archiveSearchSeq) return;
        archiveSearchStatus.textContent = 'TMDB search failed. You can still add it by typing the title manually.';
        archiveResults.innerHTML = '';
      });
  }

  archiveSearch.addEventListener('input', () => {
    if (archiveSelection && archiveSearch.value.trim() !== archiveSelection.title) {
      clearArchiveSelection();
    }
    clearTimeout(archiveSearchTimer);
    const query = archiveSearch.value.trim();
    if (!query) {
      archiveSearchSeq++;
      archiveResults.innerHTML = '';
      archiveSearchStatus.textContent = '';
      return;
    }
    archiveSearchTimer = setTimeout(() => requestArchiveSearch(query), 400);
  });

  archiveSelectedClear.addEventListener('click', () => {
    clearArchiveSelection();
    archiveSearch.value = '';
    archiveSearch.focus();
  });

  function renderArchive() {
    const items = state.archive[currentArchiveTab] || [];
    archiveList.innerHTML = '';
    archiveEmpty.textContent = currentArchiveTab === 'movies'
      ? 'No movies added yet.'
      : 'No series added yet.';
    archiveEmpty.style.display = items.length ? 'none' : 'block';

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'archive-card' + (item.poster ? ' has-poster' : '');
      card.dataset.id = item.id;
      const stars = item.rating > 0 ? '★'.repeat(item.rating) + '☆'.repeat(5 - item.rating) : '';
      const posterHtml = item.poster ? '<img class="archive-poster" src="' + item.poster + '" alt="">' : '';
      const yearHtml = item.year ? '<div class="archive-year"></div>' : '';
      card.innerHTML = `
        ${posterHtml}
        <div class="archive-card-body">
          <div class="archive-card-top">
            <div>
              <div class="archive-title"></div>
              ${yearHtml}
            </div>
            <button class="btn-icon archive-delete" title="Delete">✕</button>
          </div>
          <span class="archive-badge">${statusLabel[item.status] || item.status}</span>
          ${stars ? `<div class="archive-rating">${stars}</div>` : ''}
          ${item.memo ? `<div class="archive-memo"></div>` : ''}
        </div>
      `;
      card.querySelector('.archive-title').textContent = item.title;
      if (item.year) card.querySelector('.archive-year').textContent = item.year;
      if (item.memo) card.querySelector('.archive-memo').textContent = item.memo;
      archiveList.appendChild(card);
    });
  }

  archiveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = archiveSearch.value.trim();
    if (!title) return;
    const matched = archiveSelection && archiveSelection.title === title ? archiveSelection : null;
    const payload = {
      user_id: currentUser.id,
      category: currentArchiveTab,
      title,
      year: matched ? matched.year : '',
      poster: matched ? matched.poster : '',
      tmdb_id: matched ? matched.tmdbId : null,
      status: archiveStatus.value,
      rating: parseInt(archiveRating.value, 10) || 0,
      memo: archiveMemo.value.trim()
    };
    const { data, error } = await supabaseClient.from('archive_items').insert(payload).select().single();
    if (error) { alert('Could not add item: ' + error.message); return; }
    state.archive[currentArchiveTab].unshift({
      id: data.id, title: data.title, year: data.year, poster: data.poster, tmdbId: data.tmdb_id,
      status: data.status, rating: data.rating, memo: data.memo, createdAt: new Date(data.created_at).getTime()
    });
    archiveSearch.value = '';
    archiveMemo.value = '';
    archiveStatus.value = 'planned';
    archiveRating.value = '0';
    clearArchiveSelection();
    archiveResults.innerHTML = '';
    archiveSearchStatus.textContent = '';
    renderArchive();
  });

  archiveList.addEventListener('click', async (e) => {
    const card = e.target.closest('.archive-card');
    if (!card || !e.target.closest('.archive-delete')) return;
    const id = card.dataset.id;
    if (!confirm('Delete this item?')) return;
    const { error } = await supabaseClient.from('archive_items').delete().eq('id', id);
    if (error) { alert('Could not delete item: ' + error.message); return; }
    state.archive[currentArchiveTab] = state.archive[currentArchiveTab].filter((x) => x.id !== id);
    renderArchive();
  });

  // ================= DIARY =================
  const diaryForm = document.getElementById('diaryForm');
  const diaryFile = document.getElementById('diaryFile');
  const diaryUrl = document.getElementById('diaryUrl');
  const diaryDate = document.getElementById('diaryDate');
  const diaryText = document.getElementById('diaryText');
  const diaryGrid = document.getElementById('diaryGrid');
  const diaryEmpty = document.getElementById('diaryEmpty');
  const diarySubmitBtn = diaryForm.querySelector('button[type="submit"]');

  diaryDate.value = todayStr();

  function renderDiary() {
    diaryGrid.innerHTML = '';
    diaryEmpty.style.display = state.diary.length ? 'none' : 'block';
    const sorted = [...state.diary].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    sorted.forEach((entry) => {
      const photoUrls = (entry.photos || []).map(mediaUrl).filter(Boolean);
      const card = document.createElement('div');
      card.className = 'diary-card';
      card.dataset.id = entry.id;
      let photosHtml = '';
      if (photoUrls.length === 1) {
        photosHtml = `<img class="diary-card-img" src="${photoUrls[0]}" alt="Diary photo">`;
      } else if (photoUrls.length > 1) {
        photosHtml = '<div class="diary-photo-grid">'
          + photoUrls.map((p) => `<img src="${p}" alt="Diary photo">`).join('')
          + '</div>';
      }
      card.innerHTML = `
        ${photosHtml}
        <div class="diary-card-body">
          <div class="diary-date">${escapeHtml(entry.date)}</div>
          <div class="diary-text"></div>
          <div class="diary-card-footer">
            <button class="btn-icon diary-delete" title="Delete">✕</button>
          </div>
        </div>
      `;
      card.querySelector('.diary-text').textContent = entry.text;
      diaryGrid.appendChild(card);
    });
  }

  diaryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = diaryText.value.trim();
    if (!text) return;

    diarySubmitBtn.disabled = true;
    diarySubmitBtn.textContent = 'Uploading…';
    try {
      const photos = [];
      if (diaryFile.files && diaryFile.files.length) {
        const blobs = await Promise.all(Array.from(diaryFile.files).map((f) => resizeImageFile(f, 1000, 0.8)));
        const paths = await Promise.all(blobs.map((b) => uploadMedia(b, 'diary')));
        photos.push(...paths);
      }
      if (diaryUrl.value.trim()) photos.push(diaryUrl.value.trim());

      const { data, error } = await supabaseClient.from('diary_entries')
        .insert({ user_id: currentUser.id, photos, text, date: diaryDate.value || todayStr() })
        .select().single();
      if (error) throw error;

      state.diary.push({ id: data.id, photos: data.photos || [], text: data.text, date: data.date, createdAt: new Date(data.created_at).getTime() });

      diaryFile.value = '';
      diaryUrl.value = '';
      diaryText.value = '';
      diaryDate.value = todayStr();
      renderDiary();
    } catch (err) {
      alert('Could not add entry: ' + err.message);
    } finally {
      diarySubmitBtn.disabled = false;
      diarySubmitBtn.textContent = 'Add Entry';
    }
  });

  diaryGrid.addEventListener('click', async (e) => {
    const card = e.target.closest('.diary-card');
    if (!card || !e.target.closest('.diary-delete')) return;
    const id = card.dataset.id;
    if (!confirm('Delete this entry?')) return;
    const entry = state.diary.find((x) => x.id === id);
    const { error } = await supabaseClient.from('diary_entries').delete().eq('id', id);
    if (error) { alert('Could not delete entry: ' + error.message); return; }
    if (entry) {
      const storagePaths = (entry.photos || []).filter((p) => !isExternalUrl(p));
      if (storagePaths.length) supabaseClient.storage.from(MEDIA_BUCKET).remove(storagePaths).catch(() => {});
    }
    state.diary = state.diary.filter((x) => x.id !== id);
    renderDiary();
  });

  // ================= SETTINGS =================
  const settingName = document.getElementById('settingName');
  const settingBgFile = document.getElementById('settingBgFile');
  const settingBgUrl = document.getElementById('settingBgUrl');
  const settingBgReset = document.getElementById('settingBgReset');
  const settingAvatarFile = document.getElementById('settingAvatarFile');
  const avatarEditorWrap = document.getElementById('avatarEditorWrap');
  const avatarPreviewFrame = document.getElementById('avatarPreviewFrame');
  const avatarPreviewImg = document.getElementById('avatarPreviewImg');
  const avatarZoom = document.getElementById('avatarZoom');
  const avatarPosReset = document.getElementById('avatarPosReset');

  avatarPreviewImg.addEventListener('load', layoutAllAvatars);

  async function persistProfile() {
    const { error } = await supabaseClient.from('profiles').upsert({
      user_id: currentUser.id,
      name: state.profile.name || '',
      photo_path: state.profile.photo || '',
      avatar_zoom: state.profile.zoom || 100,
      avatar_offset_x: state.profile.offsetX || 0,
      avatar_offset_y: state.profile.offsetY || 0,
      background_type: state.background.type || 'default',
      background_value: state.background.value || '',
      updated_at: new Date().toISOString()
    });
    if (error) { console.error(error); alert('Could not save settings: ' + error.message); }
  }
  const persistProfileDebounced = debounce(persistProfile, 500);

  function initSettingsUI() {
    settingName.value = state.profile.name || '';
    settingBgUrl.value = (state.background.type === 'custom' && isExternalUrl(state.background.value))
      ? state.background.value : '';
    const src = mediaUrl(state.profile.photo);
    if (src) {
      if (avatarPreviewImg.getAttribute('src') !== src) avatarPreviewImg.src = src;
      avatarEditorWrap.classList.add('show');
    } else {
      avatarEditorWrap.classList.remove('show');
    }
    avatarZoom.value = state.profile.zoom || 100;
  }

  settingName.addEventListener('input', () => {
    state.profile.name = settingName.value;
    renderProfile();
    persistProfileDebounced();
  });

  settingBgFile.addEventListener('change', async () => {
    const file = settingBgFile.files && settingBgFile.files[0];
    if (!file) return;
    try {
      const blob = await resizeImageFile(file, 1800, 0.82);
      const path = await uploadMedia(blob, 'background');
      state.background = { type: 'custom', value: path };
      settingBgUrl.value = '';
      renderBackground();
      await persistProfile();
    } catch (err) {
      alert('Could not process the background photo: ' + err.message);
    }
  });

  settingBgUrl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const url = settingBgUrl.value.trim();
    if (!url) return;
    state.background = { type: 'custom', value: url };
    settingBgFile.value = '';
    renderBackground();
    await persistProfile();
  });

  settingBgReset.addEventListener('click', async () => {
    state.background = { type: 'default', value: '' };
    settingBgUrl.value = '';
    settingBgFile.value = '';
    renderBackground();
    await persistProfile();
  });

  settingAvatarFile.addEventListener('change', async () => {
    const file = settingAvatarFile.files && settingAvatarFile.files[0];
    if (!file) return;
    try {
      const blob = await resizeImageFile(file, 600, 0.85);
      const path = await uploadMedia(blob, 'avatar');
      state.profile.photo = path;
      state.profile.zoom = 100;
      state.profile.offsetX = 0;
      state.profile.offsetY = 0;
      avatarZoom.value = 100;
      avatarEditorWrap.classList.add('show');
      renderProfile();
      await persistProfile();
    } catch (err) {
      alert('Could not process the profile photo: ' + err.message);
    }
  });

  avatarZoom.addEventListener('input', () => {
    state.profile.zoom = parseInt(avatarZoom.value, 10);
    const natW = avatarPreviewImg.naturalWidth;
    const natH = avatarPreviewImg.naturalHeight;
    const boxW = avatarPreviewFrame.clientWidth;
    const boxH = avatarPreviewFrame.clientHeight;
    if (natW && natH && boxW && boxH) {
      const zoom = state.profile.zoom / 100;
      const layout = computeAvatarLayout(natW, natH, boxW, boxH, zoom, state.profile.offsetX || 0, state.profile.offsetY || 0);
      state.profile.offsetX = layout.clampedOffX;
      state.profile.offsetY = layout.clampedOffY;
    }
    renderProfile();
    persistProfileDebounced();
  });

  avatarPosReset.addEventListener('click', () => {
    state.profile.offsetX = 0;
    state.profile.offsetY = 0;
    renderProfile();
    persistProfile();
  });

  // ---- Drag-to-reposition on the avatar preview ----
  let avatarDrag = null;
  avatarPreviewFrame.addEventListener('pointerdown', (e) => {
    if (!state.profile.photo) return;
    avatarDrag = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: state.profile.offsetX || 0,
      startOffY: state.profile.offsetY || 0
    };
    avatarPreviewFrame.setPointerCapture(e.pointerId);
    avatarPreviewFrame.classList.add('dragging');
  });
  avatarPreviewFrame.addEventListener('pointermove', (e) => {
    if (!avatarDrag) return;
    const boxW = avatarPreviewFrame.clientWidth;
    const boxH = avatarPreviewFrame.clientHeight;
    const dx = e.clientX - avatarDrag.startX;
    const dy = e.clientY - avatarDrag.startY;
    const rawOffX = avatarDrag.startOffX + dx / boxW;
    const rawOffY = avatarDrag.startOffY + dy / boxH;
    const natW = avatarPreviewImg.naturalWidth;
    const natH = avatarPreviewImg.naturalHeight;
    if (!natW || !natH) return;
    const zoom = (state.profile.zoom || 100) / 100;
    const layout = computeAvatarLayout(natW, natH, boxW, boxH, zoom, rawOffX, rawOffY);
    state.profile.offsetX = layout.clampedOffX;
    state.profile.offsetY = layout.clampedOffY;
    renderProfile();
  });
  function endAvatarDrag() {
    if (!avatarDrag) return;
    avatarDrag = null;
    avatarPreviewFrame.classList.remove('dragging');
    persistProfile();
  }
  avatarPreviewFrame.addEventListener('pointerup', endAvatarDrag);
  avatarPreviewFrame.addEventListener('pointercancel', endAvatarDrag);

  // ================= DATA LOADING =================
  function mapTodoRow(r) { return { id: r.id, text: r.text, date: r.date, done: r.done, createdAt: new Date(r.created_at).getTime() }; }
  function mapHabitRow(r) { return { id: r.id, name: r.name, goalDays: r.goal_days, log: r.log || {}, createdAt: new Date(r.created_at).getTime() }; }
  function mapArchiveRow(r) { return { id: r.id, title: r.title, year: r.year, poster: r.poster, tmdbId: r.tmdb_id, status: r.status, rating: r.rating, memo: r.memo, createdAt: new Date(r.created_at).getTime() }; }
  function mapDiaryRow(r) { return { id: r.id, photos: r.photos || [], text: r.text, date: r.date, createdAt: new Date(r.created_at).getTime() }; }

  async function loadAllData() {
    let { data: profileRow, error: profileErr } = await supabaseClient
      .from('profiles').select('*').eq('user_id', currentUser.id).maybeSingle();
    if (profileErr) throw profileErr;
    if (!profileRow) {
      const { data: created, error: createErr } = await supabaseClient
        .from('profiles').insert({ user_id: currentUser.id }).select().single();
      if (createErr) throw createErr;
      profileRow = created;
    }
    state.profile = {
      name: profileRow.name || '',
      photo: profileRow.photo_path || '',
      zoom: profileRow.avatar_zoom || 100,
      offsetX: profileRow.avatar_offset_x || 0,
      offsetY: profileRow.avatar_offset_y || 0
    };
    state.background = {
      type: profileRow.background_type || 'default',
      value: profileRow.background_value || ''
    };

    const [todosRes, habitsRes, archiveRes, diaryRes] = await Promise.all([
      supabaseClient.from('todos').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('habits').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('archive_items').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('diary_entries').select('*').order('created_at', { ascending: false })
    ]);
    if (todosRes.error) throw todosRes.error;
    if (habitsRes.error) throw habitsRes.error;
    if (archiveRes.error) throw archiveRes.error;
    if (diaryRes.error) throw diaryRes.error;

    state.todos = (todosRes.data || []).map(mapTodoRow);
    state.habits = (habitsRes.data || []).map(mapHabitRow);
    state.archive = { movies: [], series: [] };
    (archiveRes.data || []).forEach((r) => {
      if (state.archive[r.category]) state.archive[r.category].push(mapArchiveRow(r));
    });
    state.diary = (diaryRes.data || []).map(mapDiaryRow);

    const paths = [];
    if (state.profile.photo) paths.push(state.profile.photo);
    if (state.background.type === 'custom' && state.background.value) paths.push(state.background.value);
    state.diary.forEach((d) => (d.photos || []).forEach((p) => paths.push(p)));
    await resolveMediaUrls(paths);
  }

  function renderAll() {
    renderProfile();
    renderBackground();
    renderTodos();
    renderHabits();
    renderArchive();
    renderDiary();
    initSettingsUI();
  }

  // ================= AUTH =================
  const authGate = document.getElementById('authGate');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const appRoot = document.getElementById('appRoot');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginSubmit = document.getElementById('loginSubmit');
  const logoutBtn = document.getElementById('logoutBtn');

  let currentUser = null;

  function showAuthGate(message) {
    authGate.classList.add('show');
    loadingOverlay.classList.remove('show');
    appRoot.style.display = 'none';
    loginError.textContent = message || '';
  }
  function showLoading() {
    loadingOverlay.classList.add('show');
    authGate.classList.remove('show');
  }
  function showApp() {
    loadingOverlay.classList.remove('show');
    authGate.classList.remove('show');
    appRoot.style.display = 'flex';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginSubmit.disabled = true;
    loginSubmit.textContent = 'Signing in…';
    const { error } = await supabaseClient.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });
    loginSubmit.disabled = false;
    loginSubmit.textContent = 'Sign In';
    if (error) {
      loginError.textContent = error.message;
    } else {
      loginPassword.value = '';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      currentUser = null;
      showAuthGate();
      return;
    }
    const isNewSignIn = !currentUser || currentUser.id !== session.user.id;
    currentUser = session.user;
    if (!isNewSignIn) return; // token refresh etc. — no need to reload data

    showLoading();
    loadAllData()
      .then(() => { renderAll(); showApp(); })
      .catch((err) => {
        console.error(err);
        showAuthGate('Failed to load your data: ' + err.message);
      });
  });
})();
