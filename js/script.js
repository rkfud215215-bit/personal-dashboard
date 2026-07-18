(() => {
  'use strict';

  const STORAGE_KEY = 'personalDashboard.state.v1';
  // TMDB v3 API key — embedded client-side is TMDB's supported usage pattern for browser apps.
  const TMDB_API_KEY = '975c807f73d5af29d71e50a5264da6c8';
  const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w300';

  const defaultState = {
    profile: { name: '', photo: '', zoom: 100, offsetX: 0, offsetY: 0 },
    background: { type: 'default', value: '' },
    todos: [],
    habits: [],
    archive: { movies: [], series: [] },
    diary: []
  };

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

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneState(defaultState);
      const parsed = JSON.parse(raw);
      return {
        profile: { ...defaultState.profile, ...(parsed.profile || {}) },
        background: { ...defaultState.background, ...(parsed.background || {}) },
        todos: Array.isArray(parsed.todos)
          ? parsed.todos.map((t) => ({ ...t, date: t.date || todayStr() }))
          : [],
        habits: Array.isArray(parsed.habits) ? parsed.habits : [],
        archive: {
          movies: Array.isArray(parsed.archive?.movies) ? parsed.archive.movies : [],
          series: Array.isArray(parsed.archive?.series) ? parsed.archive.series : []
        },
        diary: Array.isArray(parsed.diary) ? parsed.diary : []
      };
    } catch (e) {
      console.warn('Could not load saved data. Starting with defaults.', e);
      return structuredCloneState(defaultState);
    }
  }

  function structuredCloneState(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  let state = loadState();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        alert('Storage is full. Try a smaller photo or delete some older entries.');
      } else {
        console.error(e);
      }
    }
  }

  // ---------- Image resize helper (keeps localStorage usage sane) ----------
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
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
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
      // clamped normalized offsets, so callers can re-persist a corrected value
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
    if (state.profile.photo) {
      if (avatarImg.getAttribute('src') !== state.profile.photo) {
        avatarImg.src = state.profile.photo;
      }
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
    if (state.background.type === 'custom' && state.background.value) {
      bgLayer.classList.remove('default-bg');
      bgLayer.style.backgroundImage = `url("${state.background.value}")`;
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

  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    const date = todoDateInput.value || todayStr();
    state.todos.unshift({ id: uid(), text, date, done: false, createdAt: Date.now() });
    todoInput.value = '';
    save();
    renderTodos();
  });

  todoDays.addEventListener('click', (e) => {
    const li = e.target.closest('.todo-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.todo-check')) {
      const t = state.todos.find((x) => x.id === id);
      if (t) { t.done = !t.done; save(); renderTodos(); }
    } else if (e.target.closest('.todo-delete')) {
      if (!confirm('Delete this task?')) return;
      state.todos = state.todos.filter((x) => x.id !== id);
      save(); renderTodos();
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

  habitForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = habitName.value.trim();
    const goal = parseInt(habitGoal.value, 10);
    if (!name || !goal || goal < 1) return;
    state.habits.unshift({ id: uid(), name, goalDays: goal, log: {}, createdAt: Date.now() });
    habitName.value = '';
    habitGoal.value = '';
    save();
    renderHabits();
  });

  habitList.addEventListener('click', (e) => {
    const card = e.target.closest('.habit-card');
    if (!card) return;
    const id = card.dataset.id;
    const h = state.habits.find((x) => x.id === id);
    if (!h) return;

    if (e.target.closest('.habit-delete')) {
      if (!confirm(`Delete habit '${h.name}'? All progress will be lost too.`)) return;
      state.habits = state.habits.filter((x) => x.id !== id);
      save(); renderHabits();
      return;
    }

    if (e.target.closest('.btn-check')) {
      const today = todayStr();
      h.log = h.log || {};
      if (h.log[today]) delete h.log[today];
      else h.log[today] = true;
      save(); renderHabits();
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

  archiveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = archiveSearch.value.trim();
    if (!title) return;
    const matched = archiveSelection && archiveSelection.title === title ? archiveSelection : null;
    state.archive[currentArchiveTab].unshift({
      id: uid(),
      title,
      year: matched ? matched.year : '',
      poster: matched ? matched.poster : '',
      tmdbId: matched ? matched.tmdbId : null,
      status: archiveStatus.value,
      rating: parseInt(archiveRating.value, 10) || 0,
      memo: archiveMemo.value.trim(),
      createdAt: Date.now()
    });
    archiveSearch.value = '';
    archiveMemo.value = '';
    archiveStatus.value = 'planned';
    archiveRating.value = '0';
    clearArchiveSelection();
    archiveResults.innerHTML = '';
    archiveSearchStatus.textContent = '';
    save();
    renderArchive();
  });

  archiveList.addEventListener('click', (e) => {
    const card = e.target.closest('.archive-card');
    if (!card || !e.target.closest('.archive-delete')) return;
    const id = card.dataset.id;
    if (!confirm('Delete this item?')) return;
    state.archive[currentArchiveTab] = state.archive[currentArchiveTab].filter((x) => x.id !== id);
    save();
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

  diaryDate.value = todayStr();

  function renderDiary() {
    diaryGrid.innerHTML = '';
    diaryEmpty.style.display = state.diary.length ? 'none' : 'block';
    const sorted = [...state.diary].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
    sorted.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'diary-card';
      card.dataset.id = entry.id;
      card.innerHTML = `
        ${entry.photo ? `<img class="diary-card-img" src="${entry.photo}" alt="Diary photo">` : ''}
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

    let photo = '';
    if (diaryFile.files && diaryFile.files[0]) {
      try {
        photo = await resizeImageFile(diaryFile.files[0], 1000, 0.8);
      } catch (err) {
        alert('Could not process the photo: ' + err.message);
      }
    } else if (diaryUrl.value.trim()) {
      photo = diaryUrl.value.trim();
    }

    state.diary.push({
      id: uid(),
      photo,
      text,
      date: diaryDate.value || todayStr(),
      createdAt: Date.now()
    });

    diaryFile.value = '';
    diaryUrl.value = '';
    diaryText.value = '';
    diaryDate.value = todayStr();

    save();
    renderDiary();
  });

  diaryGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.diary-card');
    if (!card || !e.target.closest('.diary-delete')) return;
    const id = card.dataset.id;
    if (!confirm('Delete this entry?')) return;
    state.diary = state.diary.filter((x) => x.id !== id);
    save();
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

  function initSettingsUI() {
    settingName.value = state.profile.name || '';
    if (state.background.type === 'custom' && state.background.value && !state.background.value.startsWith('data:')) {
      settingBgUrl.value = state.background.value;
    }
    if (state.profile.photo) {
      if (avatarPreviewImg.getAttribute('src') !== state.profile.photo) {
        avatarPreviewImg.src = state.profile.photo;
      }
      avatarEditorWrap.classList.add('show');
    }
    avatarZoom.value = state.profile.zoom || 100;
  }

  settingName.addEventListener('input', () => {
    state.profile.name = settingName.value;
    save();
    renderProfile();
  });

  settingBgFile.addEventListener('change', async () => {
    const file = settingBgFile.files && settingBgFile.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file, 1800, 0.82);
      state.background = { type: 'custom', value: dataUrl };
      settingBgUrl.value = '';
      save();
      renderBackground();
    } catch (err) {
      alert('Could not process the background photo: ' + err.message);
    }
  });

  settingBgUrl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const url = settingBgUrl.value.trim();
    if (!url) return;
    state.background = { type: 'custom', value: url };
    settingBgFile.value = '';
    save();
    renderBackground();
  });

  settingBgReset.addEventListener('click', () => {
    state.background = { type: 'default', value: '' };
    settingBgUrl.value = '';
    settingBgFile.value = '';
    save();
    renderBackground();
  });

  settingAvatarFile.addEventListener('change', async () => {
    const file = settingAvatarFile.files && settingAvatarFile.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file, 600, 0.85);
      state.profile.photo = dataUrl;
      state.profile.zoom = 100;
      state.profile.offsetX = 0;
      state.profile.offsetY = 0;
      avatarZoom.value = 100;
      avatarPreviewImg.src = dataUrl;
      avatarEditorWrap.classList.add('show');
      save();
      renderProfile();
    } catch (err) {
      alert('Could not process the profile photo: ' + err.message);
    }
  });

  avatarZoom.addEventListener('input', () => {
    state.profile.zoom = parseInt(avatarZoom.value, 10);
    // re-clamp the existing offset against the new zoom level
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
    save();
    renderProfile();
  });

  avatarPosReset.addEventListener('click', () => {
    state.profile.offsetX = 0;
    state.profile.offsetY = 0;
    save();
    renderProfile();
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
  function endAvatarDrag(e) {
    if (!avatarDrag) return;
    avatarDrag = null;
    avatarPreviewFrame.classList.remove('dragging');
    save();
  }
  avatarPreviewFrame.addEventListener('pointerup', endAvatarDrag);
  avatarPreviewFrame.addEventListener('pointercancel', endAvatarDrag);

  // ================= INIT =================
  function renderAll() {
    renderProfile();
    renderBackground();
    renderTodos();
    renderHabits();
    renderArchive();
    renderDiary();
    initSettingsUI();
  }

  renderAll();
})();
