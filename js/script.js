(() => {
  'use strict';

  const STORAGE_KEY = 'personalDashboard.state.v1';

  const defaultState = {
    profile: { name: '', photo: '', zoom: 100, posX: 50, posY: 50 },
    background: { type: 'default', value: '' },
    todos: [],
    habits: [],
    archive: { movies: [], series: [] },
    diary: []
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneState(defaultState);
      const parsed = JSON.parse(raw);
      return {
        profile: { ...defaultState.profile, ...(parsed.profile || {}) },
        background: { ...defaultState.background, ...(parsed.background || {}) },
        todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        habits: Array.isArray(parsed.habits) ? parsed.habits : [],
        archive: {
          movies: Array.isArray(parsed.archive?.movies) ? parsed.archive.movies : [],
          series: Array.isArray(parsed.archive?.series) ? parsed.archive.series : []
        },
        diary: Array.isArray(parsed.diary) ? parsed.diary : []
      };
    } catch (e) {
      console.warn('저장된 데이터를 불러오지 못했어요. 기본값으로 시작합니다.', e);
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
        alert('저장 공간이 가득 찼어요. 사진 크기를 줄이거나 오래된 기록을 삭제해주세요.');
      } else {
        console.error(e);
      }
    }
  }

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

  // ---------- Image resize helper (keeps localStorage usage sane) ----------
  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('파일을 읽지 못했어요.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('이미지를 불러오지 못했어요.'));
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

  function renderProfile() {
    profileNameEl.textContent = state.profile.name.trim() || '이름을 설정해주세요';
    if (state.profile.photo) {
      avatarImg.src = state.profile.photo;
      avatarWrap.classList.add('has-photo');
    } else {
      avatarImg.removeAttribute('src');
      avatarWrap.classList.remove('has-photo');
    }
    const zoom = (state.profile.zoom || 100) / 100;
    document.documentElement.style.setProperty('--avatar-zoom', zoom);
    document.documentElement.style.setProperty('--avatar-x', `${state.profile.posX ?? 50}%`);
    document.documentElement.style.setProperty('--avatar-y', `${state.profile.posY ?? 50}%`);
  }

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
  const todoList = document.getElementById('todoList');
  const todoEmpty = document.getElementById('todoEmpty');

  function renderTodos() {
    todoList.innerHTML = '';
    todoEmpty.style.display = state.todos.length ? 'none' : 'block';
    state.todos.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (t.done ? ' done' : '');
      li.dataset.id = t.id;
      li.innerHTML = `
        <button class="todo-check" title="완료 토글">${t.done ? '✓' : ''}</button>
        <span class="todo-text"></span>
        <button class="btn-icon todo-delete" title="삭제">✕</button>
      `;
      li.querySelector('.todo-text').textContent = t.text;
      todoList.appendChild(li);
    });
  }

  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    state.todos.unshift({ id: uid(), text, done: false, createdAt: Date.now() });
    todoInput.value = '';
    save();
    renderTodos();
  });

  todoList.addEventListener('click', (e) => {
    const li = e.target.closest('.todo-item');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.todo-check')) {
      const t = state.todos.find((x) => x.id === id);
      if (t) { t.done = !t.done; save(); renderTodos(); }
    } else if (e.target.closest('.todo-delete')) {
      if (!confirm('이 할 일을 삭제할까요?')) return;
      state.todos = state.todos.filter((x) => x.id !== id);
      save(); renderTodos();
    }
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
              <button class="btn-icon habit-delete" title="삭제">✕</button>
            </div>
          </div>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="habit-meta"><span>${successDays} / ${h.goalDays}일</span><span>${pct}%</span></div>
        <div class="habit-actions">
          <button class="btn-check${checkedToday ? ' checked' : ''}">${checkedToday ? '오늘 완료 ✓' : '오늘 완료하기'}</button>
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
      if (!confirm(`'${h.name}' 습관을 삭제할까요? 지금까지의 기록도 함께 사라져요.`)) return;
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
  const archiveTitle = document.getElementById('archiveTitle');
  const archiveStatus = document.getElementById('archiveStatus');
  const archiveRating = document.getElementById('archiveRating');
  const archiveMemo = document.getElementById('archiveMemo');
  const archiveList = document.getElementById('archiveList');
  const archiveEmpty = document.getElementById('archiveEmpty');

  let currentArchiveTab = 'movies';

  archiveTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      currentArchiveTab = btn.dataset.tab;
      archiveTabs.forEach((b) => b.classList.toggle('active', b === btn));
      renderArchive();
    });
  });

  const statusLabel = { '예정': '볼 예정', '시청중': '시청 중', '완료': '완료' };

  function renderArchive() {
    const items = state.archive[currentArchiveTab] || [];
    archiveList.innerHTML = '';
    archiveEmpty.textContent = currentArchiveTab === 'movies'
      ? '등록된 영화가 없어요.'
      : '등록된 시리즈가 없어요.';
    archiveEmpty.style.display = items.length ? 'none' : 'block';

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'archive-card';
      card.dataset.id = item.id;
      const stars = item.rating > 0 ? '★'.repeat(item.rating) + '☆'.repeat(5 - item.rating) : '';
      card.innerHTML = `
        <div class="archive-card-top">
          <div class="archive-title"></div>
          <button class="btn-icon archive-delete" title="삭제">✕</button>
        </div>
        <span class="archive-badge">${statusLabel[item.status] || item.status}</span>
        ${stars ? `<div class="archive-rating">${stars}</div>` : ''}
        ${item.memo ? `<div class="archive-memo"></div>` : ''}
      `;
      card.querySelector('.archive-title').textContent = item.title;
      if (item.memo) card.querySelector('.archive-memo').textContent = item.memo;
      archiveList.appendChild(card);
    });
  }

  archiveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = archiveTitle.value.trim();
    if (!title) return;
    state.archive[currentArchiveTab].unshift({
      id: uid(),
      title,
      status: archiveStatus.value,
      rating: parseInt(archiveRating.value, 10) || 0,
      memo: archiveMemo.value.trim(),
      createdAt: Date.now()
    });
    archiveTitle.value = '';
    archiveMemo.value = '';
    archiveStatus.value = '예정';
    archiveRating.value = '0';
    save();
    renderArchive();
  });

  archiveList.addEventListener('click', (e) => {
    const card = e.target.closest('.archive-card');
    if (!card || !e.target.closest('.archive-delete')) return;
    const id = card.dataset.id;
    if (!confirm('이 항목을 삭제할까요?')) return;
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
        ${entry.photo ? `<img class="diary-card-img" src="${entry.photo}" alt="다이어리 사진">` : ''}
        <div class="diary-card-body">
          <div class="diary-date">${escapeHtml(entry.date)}</div>
          <div class="diary-text"></div>
          <div class="diary-card-footer">
            <button class="btn-icon diary-delete" title="삭제">✕</button>
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
        alert('사진을 처리하지 못했어요: ' + err.message);
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
    if (!confirm('이 기록을 삭제할까요?')) return;
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
  const avatarPreviewImg = document.getElementById('avatarPreviewImg');
  const avatarZoom = document.getElementById('avatarZoom');
  const avatarPosX = document.getElementById('avatarPosX');
  const avatarPosY = document.getElementById('avatarPosY');

  function initSettingsUI() {
    settingName.value = state.profile.name || '';
    if (state.background.type === 'custom' && state.background.value && !state.background.value.startsWith('data:')) {
      settingBgUrl.value = state.background.value;
    }
    if (state.profile.photo) {
      avatarPreviewImg.src = state.profile.photo;
      avatarEditorWrap.classList.add('show');
    }
    avatarZoom.value = state.profile.zoom || 100;
    avatarPosX.value = state.profile.posX ?? 50;
    avatarPosY.value = state.profile.posY ?? 50;
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
      alert('배경 사진을 처리하지 못했어요: ' + err.message);
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
      state.profile.posX = 50;
      state.profile.posY = 50;
      avatarZoom.value = 100;
      avatarPosX.value = 50;
      avatarPosY.value = 50;
      avatarPreviewImg.src = dataUrl;
      avatarEditorWrap.classList.add('show');
      save();
      renderProfile();
    } catch (err) {
      alert('프로필 사진을 처리하지 못했어요: ' + err.message);
    }
  });

  function updateAvatarAdjust() {
    state.profile.zoom = parseInt(avatarZoom.value, 10);
    state.profile.posX = parseInt(avatarPosX.value, 10);
    state.profile.posY = parseInt(avatarPosY.value, 10);
    save();
    renderProfile();
  }
  [avatarZoom, avatarPosX, avatarPosY].forEach((el) => {
    el.addEventListener('input', updateAvatarAdjust);
  });

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
