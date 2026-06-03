// =====================================================
//  APP.JS — Главный рендер UI
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  // ============ СОСТОЯНИЕ ============

  App.activeTab = 'home';
  App.currentTheme = 'light';
  App.themeListener = null;

  // ============ УВЕДОМЛЕНИЯ ============

  App.showMessage = function (text) {
    const notif = document.getElementById('notification');
    if (!notif) return;
    notif.textContent = text;
    notif.style.opacity = '1';
    clearTimeout(App._msgTimeout);
    App._msgTimeout = setTimeout(() => {
      notif.style.opacity = '0';
    }, 2500);
  };

  App.showError = function (text) {
    alert('❌ ' + text);
  };

  // ============ КОПИРОВАНИЕ В БУФЕР ============

  App.copyToClipboard = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => App.showMessage('✅ Ссылка скопирована!'))
        .catch(() => App._fallbackCopy(text));
    } else {
      App._fallbackCopy(text);
    }
  };

  App._fallbackCopy = function (text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      App.showMessage('✅ Ссылка скопирована!');
    } catch (e) {
      App.showError('Не удалось скопировать');
    }
    document.body.removeChild(textarea);
  };

  // ============ СКАЧИВАНИЕ / ОТКРЫТИЕ ============

  App.openFile = function (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
    App.showMessage('🔗 Открываем файл...');
  };

  // ============ ТЕМА ОФОРМЛЕНИЯ ============

  App.applyTheme = function (theme) {
    document.body.classList.remove('light', 'dark', 'business');
    document.body.classList.add(theme);
    App.currentTheme = theme;
    if (App.currentUser) {
      // Сохраняем в профиле
      App.db.collection('users').doc(App.currentUser.uid).update({
        theme: theme
      }).catch(err => console.warn('Не удалось сохранить тему:', err));
    }
  };

  App.subscribeTheme = function () {
    if (!App.currentUser) return;
    App.db.collection('users').doc(App.currentUser.uid).onSnapshot(snap => {
      const data = snap.data();
      if (data && data.theme && data.theme !== App.currentTheme) {
        document.body.classList.remove('light', 'dark', 'business');
        document.body.classList.add(data.theme);
        App.currentTheme = data.theme;
      }
    });
  };

  // ============ РЕНДЕР ГЛАВНОГО ЭКРАНА ============

  App.renderApp = function () {
    const container = document.getElementById('app');
    if (!container) return;

    // Если не залогинен — показываем экран входа
    if (!App.currentUser || !App.currentUserProfile) {
      App._renderLoginScreen();
      return;
    }

    const profile = App.currentUserProfile;
    const isAdminOrOwner = App.isAdminOrOwner();

    // Применяем тему пользователя
    if (profile.theme) {
      document.body.classList.remove('light', 'dark', 'business');
      document.body.classList.add(profile.theme);
      App.currentTheme = profile.theme;
    }

    container.innerHTML = `
      <div class="top-bar">
        <div class="top-bar-left">
          <div class="brand-label">FMlogistic</div>
          <h1>📘 База знаний <span class="subtitle">⚡ с умным поиском</span></h1>
        </div>
        <div class="user-badge">
          👤 <strong>${App.escapeHtml(profile.username)}</strong>
          <span class="role-badge role-${profile.role}">${App._roleLabel(profile.role)}</span>
        </div>
      </div>

      <div class="tabs">
        <button class="tab-btn ${App.activeTab === 'home' ? 'active' : ''}" data-tab="home">🏠 Главная</button>
        <button class="tab-btn ${App.activeTab === 'add' ? 'active' : ''}" data-tab="add">➕ Добавить</button>
        ${isAdminOrOwner ? `<button class="tab-btn ${App.activeTab === 'users' ? 'active' : ''}" data-tab="users">👥 Пользователи</button>` : ''}
        <button class="tab-btn ${App.activeTab === 'profile' ? 'active' : ''}" data-tab="profile">👤 Профиль</button>
      </div>

      <div id="tabHome" class="tab-pane ${App.activeTab === 'home' ? 'active-pane' : ''}"></div>
      <div id="tabAdd" class="tab-pane ${App.activeTab === 'add' ? 'active-pane' : ''}"></div>
      ${isAdminOrOwner ? `<div id="tabUsers" class="tab-pane ${App.activeTab === 'users' ? 'active-pane' : ''}"></div>` : ''}
      <div id="tabProfile" class="tab-pane ${App.activeTab === 'profile' ? 'active-pane' : ''}"></div>
    `;

    // Подписываемся на обновления
    App.subscribeDocuments(() => {
      if (App.activeTab === 'home') App._renderHomeTab();
    });

    if (isAdminOrOwner) {
      App.subscribeUsers(() => {
        if (App.activeTab === 'users') App._renderUsersTab();
      });
    }

    // Рендерим активную вкладку
    if (App.activeTab === 'home') App._renderHomeTab();
    if (App.activeTab === 'add') App._renderAddTab();
    if (App.activeTab === 'users' && isAdminOrOwner) App._renderUsersTab();
    if (App.activeTab === 'profile') App._renderProfileTab();

    // Обработчики табов
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.activeTab = btn.dataset.tab;
        App.renderApp();
      });
    });
  };

  App._roleLabel = function (role) {
    if (role === 'owner') return '👑 Владелец';
    if (role === 'admin') return '⚙️ Админ';
    return 'Пользователь';
  };

  // ============ ЭКРАН ВХОДА / СОЗДАНИЯ OWNER ============

  App._renderLoginScreen = async function () {
    const container = document.getElementById('app');
    if (!container) return;

    // Подписываемся на обновления — если owner появится, перезагрузим
    let needsOwner = false;
    try {
      needsOwner = !(await App.checkOwnerExists());
    } catch (e) {
      console.error('checkOwnerExists:', e);
    }

    if (needsOwner) {
      container.innerHTML = `
        <div class="login-overlay">
          <div class="login-box">
            <h2>👑 Создать владельца системы</h2>
            <p class="hint">Эта страница появится только один раз. Owner — главный аккаунт с абсолютными правами. Его нельзя удалить или заблокировать.</p>
            <input type="email" id="ownerEmail" placeholder="Email" autocomplete="email">
            <input type="password" id="ownerPass" placeholder="Пароль (12+ символов)" autocomplete="new-password">
            <input type="password" id="ownerPass2" placeholder="Повторите пароль" autocomplete="new-password">
            <div id="ownerError" class="error-msg"></div>
            <div id="passwordStrength" class="password-strength"></div>
            <button id="createOwnerBtn" class="primary">👑 Создать владельца</button>
          </div>
        </div>
      `;
      App._bindOwnerWizard();
    } else {
      container.innerHTML = `
        <div class="login-overlay">
          <div class="login-box">
            <h2>🔐 Вход в систему</h2>
            <input type="email" id="loginEmail" placeholder="Email" autocomplete="email">
            <input type="password" id="loginPass" placeholder="Пароль" autocomplete="current-password">
            <div id="loginError" class="error-msg"></div>
            <button id="doLoginBtn" class="primary">Войти</button>
            <p class="hint">Нет аккаунта? <a href="#" id="goRegisterLink">Зарегистрироваться</a></p>
          </div>
        </div>
      `;
      App._bindLogin();
    }
  };

  App._bindOwnerWizard = function () {
    const emailInput = document.getElementById('ownerEmail');
    const passInput = document.getElementById('ownerPass');
    const pass2Input = document.getElementById('ownerPass2');
    const errorDiv = document.getElementById('ownerError');
    const strengthDiv = document.getElementById('passwordStrength');
    const btn = document.getElementById('createOwnerBtn');

    if (passInput) {
      passInput.addEventListener('input', () => {
        const s = App.passwordStrength(passInput.value);
        const labels = ['очень слабый', 'слабый', 'средний', 'хороший', 'отличный'];
        strengthDiv.className = 'password-strength strength-' + s;
        strengthDiv.textContent = passInput.value ? `Надёжность: ${labels[s]}` : '';
      });
    }

    const doCreate = async () => {
      errorDiv.textContent = '';
      const email = emailInput.value.trim();
      const pass = passInput.value;
      const pass2 = pass2Input.value;

      if (pass !== pass2) {
        errorDiv.textContent = 'Пароли не совпадают';
        return;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Создаём...';

      try {
        await App.createOwner(email, pass);
        // createOwner вызывает Firebase Auth → сработает onAuthStateChanged → renderApp
      } catch (e) {
        errorDiv.textContent = e.message;
        btn.disabled = false;
        btn.textContent = '👑 Создать владельца';
      }
    };

    btn.addEventListener('click', doCreate);
    [emailInput, passInput, pass2Input].forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
    });
  };

  App._bindLogin = function () {
    const emailInput = document.getElementById('loginEmail');
    const passInput = document.getElementById('loginPass');
    const errorDiv = document.getElementById('loginError');
    const btn = document.getElementById('doLoginBtn');
    const registerLink = document.getElementById('goRegisterLink');

    const doLogin = async () => {
      errorDiv.textContent = '';
      btn.disabled = true;
      btn.textContent = '⏳ Входим...';

      try {
        await App.login(emailInput.value.trim(), passInput.value);
        // onAuthStateChanged → renderApp
      } catch (e) {
        errorDiv.textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'Войти';
      }
    };

    btn.addEventListener('click', doLogin);
    [emailInput, passInput].forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    });

    if (registerLink) {
      registerLink.addEventListener('click', (e) => {
        e.preventDefault();
        App._renderRegisterScreen();
      });
    }
  };

  // ============ ЭКРАН РЕГИСТРАЦИИ ============

  App._renderRegisterScreen = function () {
    const container = document.getElementById('app');
    if (!container) return;

    container.innerHTML = `
      <div class="login-overlay">
        <div class="login-box">
          <h2>📝 Регистрация</h2>
          <p class="hint">Создайте аккаунт, чтобы получить доступ к базе знаний.</p>
          <input type="email" id="regEmail" placeholder="Email" autocomplete="email">
          <input type="password" id="regPass" placeholder="Пароль (12+ символов)" autocomplete="new-password">
          <input type="password" id="regPass2" placeholder="Повторите пароль" autocomplete="new-password">
          <div id="regError" class="error-msg"></div>
          <div id="regPasswordStrength" class="password-strength"></div>
          <button id="doRegisterBtn" class="primary">Зарегистрироваться</button>
          <p class="hint">Уже есть аккаунт? <a href="#" id="goLoginLink">Войти</a></p>
        </div>
      </div>
    `;
    App._bindRegister();
  };

  App._bindRegister = function () {
    const emailInput = document.getElementById('regEmail');
    const passInput = document.getElementById('regPass');
    const pass2Input = document.getElementById('regPass2');
    const errorDiv = document.getElementById('regError');
    const strengthDiv = document.getElementById('regPasswordStrength');
    const btn = document.getElementById('doRegisterBtn');
    const loginLink = document.getElementById('goLoginLink');

    if (passInput) {
      passInput.addEventListener('input', () => {
        const s = App.passwordStrength(passInput.value);
        const labels = ['очень слабый', 'слабый', 'средний', 'хороший', 'отличный'];
        strengthDiv.className = 'password-strength strength-' + s;
        strengthDiv.textContent = passInput.value ? `Надёжность: ${labels[s]}` : '';
      });
    }

    const doRegister = async () => {
      errorDiv.textContent = '';
      btn.disabled = true;
      btn.textContent = '⏳ Создаём...';

      try {
        await App.register(
          emailInput.value.trim(),
          passInput.value,
          pass2Input.value
        );
        // onAuthStateChanged → renderApp
      } catch (e) {
        errorDiv.textContent = e.message;
        btn.disabled = false;
        btn.textContent = 'Зарегистрироваться';
      }
    };

    btn.addEventListener('click', doRegister);
    [emailInput, passInput, pass2Input].forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
    });

    if (loginLink) {
      loginLink.addEventListener('click', (e) => {
        e.preventDefault();
        App._renderLoginScreen();
      });
    }
  };

  // ============ ВКЛАДКА: ГЛАВНАЯ ============

  App._renderHomeTab = function () {
    const tab = document.getElementById('tabHome');
    if (!tab) return;

    const documents = App.getDocuments();
    const allKeywords = App.getAllKeywords(documents);

    tab.innerHTML = `
      <div class="search-bar">
        <input type="text" id="globalSearch" class="search-input" placeholder="🔍 Продвинутый поиск... Например: 'налоговая декларация' или 'как сбросить пароль'" autocomplete="off">
        <div id="suggestionsBox"></div>
      </div>

      <div class="card hint-card">
        <span>💡 <strong>Совет:</strong> поиск работает по названию, тегам, описанию и ключевым словам. Чем больше совпадений — тем выше в результатах.</span>
      </div>

      <div id="docsGrid" class="docs-grid"></div>
    `;

    const searchInput = document.getElementById('globalSearch');
    const suggestionsDiv = document.getElementById('suggestionsBox');
    const docsGrid = document.getElementById('docsGrid');

    const renderDocs = (query) => {
      const results = App.smartSearch(query, documents);

      if (results.length === 0 && query.trim() !== '') {
        docsGrid.innerHTML = `<div class="empty-msg">📭 Ничего не найдено. Попробуйте:<br>• другие ключевые слова<br>• скопировать фразу из документа<br>• проверить, есть ли документ в базе</div>`;
        suggestionsDiv.innerHTML = `<div class="suggestions">💡 Попробуйте: ${allKeywords.slice(0, 8).map(k => `<span class="suggestion-tag">${App.escapeHtml(k)}</span>`).join('')}</div>`;
        App._bindSuggestions(searchInput);
      } else if (results.length > 0) {
        docsGrid.innerHTML = results.map(doc => {
          const showDelete = App.canDeleteDocument(doc);
          return `
            <div class="doc-card">
              <div>
                <div class="doc-title">
                  📄 ${App.escapeHtml(doc.title)}
                  ${doc.relevance > 50 ? '<span class="relevance-badge">⭐ Точное</span>' : ''}
                  <span class="format-badge">${App.escapeHtml(doc.format || 'файл')}</span>
                </div>
                <div class="doc-desc">${App.escapeHtml(doc.description)}</div>
                <div class="doc-tags">${(doc.tags || []).map(t => `<span class="tag">${App.escapeHtml(t)}</span>`).join('')}</div>
                ${doc.keywords ? `<div class="doc-keywords">🔑 ${App.escapeHtml(doc.keywords.substring(0, 100))}${doc.keywords.length > 100 ? '…' : ''}</div>` : ''}
                <div class="owner-info">👤 Добавил: <strong>${App.escapeHtml(doc.ownerUsername || doc.ownerUid)}</strong></div>
              </div>
              <div class="button-group">
                <button class="open-btn success" data-url="${App.escapeHtml(doc.url)}">⬇️ Скачать</button>
                <button class="open-btn primary" data-url="${App.escapeHtml(doc.url)}">🔗 Открыть</button>
                <button class="copy-btn secondary" data-url="${App.escapeHtml(doc.url)}">📋 Копировать</button>
                ${showDelete ? `<button class="delete-doc danger" data-id="${App.escapeHtml(doc.id)}">🗑️ Удалить</button>` : ''}
              </div>
            </div>
          `;
        }).join('');

        document.querySelectorAll('.open-btn').forEach(btn => {
          btn.addEventListener('click', () => App.openFile(btn.dataset.url));
        });
        document.querySelectorAll('.copy-btn').forEach(btn => {
          btn.addEventListener('click', () => App.copyToClipboard(btn.dataset.url));
        });
        document.querySelectorAll('.delete-doc').forEach(btn => {
          btn.addEventListener('click', () => App._handleDeleteDoc(btn.dataset.id));
        });

        suggestionsDiv.innerHTML = `<div class="suggestions">🔍 Популярные запросы: ${allKeywords.slice(0, 8).map(k => `<span class="suggestion-tag">${App.escapeHtml(k)}</span>`).join('')}</div>`;
        App._bindSuggestions(searchInput);
      } else {
        docsGrid.innerHTML = `<div class="empty-msg">📚 В базе пока нет документов.${App.isAdminOrOwner() || true ? ' Нажмите «➕ Добавить», чтобы загрузить первый.' : ''}</div>`;
        suggestionsDiv.innerHTML = '';
      }
    };

    if (searchInput) {
      searchInput.addEventListener('input', (e) => renderDocs(e.target.value));
      renderDocs('');
    }
  };

  App._bindSuggestions = function (searchInput) {
    if (!searchInput) return;
    document.querySelectorAll('.suggestion-tag').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.innerText;
        searchInput.dispatchEvent(new Event('input'));
      });
    });
  };

  App._handleDeleteDoc = async function (docId) {
    if (!confirm('Удалить документ?')) return;
    try {
      await App.deleteDocument(docId);
      App.showMessage('🗑️ Документ удалён');
    } catch (e) {
      App.showError(e.message);
    }
  };

  // ============ ВКЛАДКА: ДОБАВИТЬ ============

  App._renderAddTab = function () {
    const tab = document.getElementById('tabAdd');
    if (!tab) return;

    tab.innerHTML = `
      <div class="add-card">
        <h3>📤 Загрузить новый документ</h3>
        <div id="formatBtns">
          <span class="format-btn active" data-format="pdf">PDF</span>
          <span class="format-btn" data-format="word">Word</span>
          <span class="format-btn" data-format="powerpoint">PowerPoint</span>
          <span class="format-btn" data-format="other">Другое</span>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Название</label>
            <input type="text" id="docTitle" placeholder="Название документа">
          </div>
          <div class="form-group">
            <label>Ссылка (Google Диск, Яндекс и др.)</label>
            <input type="text" id="docUrl" placeholder="https://...">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Описание</label>
            <textarea id="docDesc" rows="2" placeholder="Опишите, какую проблему решает документ"></textarea>
          </div>
          <div class="form-group">
            <label>Теги (через запятую)</label>
            <input type="text" id="docTags" placeholder="налоги, отчётность, 1С">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>📌 Ключевые слова из файла</label>
            <textarea id="docKeywords" rows="3" placeholder="Скопируйте сюда важные фразы из документа&#10;Например: налоговая декларация, сроки сдачи, штрафы, ФНС, ответственный"></textarea>
          </div>
        </div>
        <button id="addDocBtn" class="primary">✅ Выгрузить документ</button>
      </div>
    `;

    document.querySelectorAll('.format-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
      });
    });

    document.getElementById('addDocBtn').addEventListener('click', async () => {
      const title = document.getElementById('docTitle').value;
      const url = document.getElementById('docUrl').value;
      const desc = document.getElementById('docDesc').value;
      const tags = document.getElementById('docTags').value;
      const keywords = document.getElementById('docKeywords').value;
      const format = document.querySelector('.format-btn.active')?.dataset.format || 'other';

      try {
        await App.addDocument(title, url, desc, tags, keywords, format);
        document.getElementById('docTitle').value = '';
        document.getElementById('docUrl').value = '';
        document.getElementById('docDesc').value = '';
        document.getElementById('docTags').value = '';
        document.getElementById('docKeywords').value = '';
        App.showMessage('✅ Документ добавлен!');
        App.activeTab = 'home';
        App.renderApp();
      } catch (e) {
        App.showError(e.message);
      }
    });
  };

  // ============ ВКЛАДКА: ПОЛЬЗОВАТЕЛИ ============

  App._renderUsersTab = function () {
    const tab = document.getElementById('tabUsers');
    if (!tab) return;

    const users = App.getUsers();
    const active = users.filter(u => !u.blocked && u.role !== 'owner');
    const blocked = users.filter(u => u.blocked);

    tab.innerHTML = `
      <div class="admin-panel">
        <h3>⚙️ Управление пользователями</h3>

        <div class="add-user-form">
          <h4>➕ Новый сотрудник</h4>
          <input type="email" id="newUserEmail" placeholder="Email">
          <input type="password" id="newUserPass" placeholder="Пароль (12+ символов)">
          <select id="newUserRole">
            <option value="user">Пользователь</option>
            <option value="admin">Админ</option>
          </select>
          <button id="addNewUserBtn" class="success">Добавить</button>
          <div id="addUserError" class="error-msg"></div>
        </div>

        <h4>✅ Активные (${active.length})</h4>
        <div class="user-list" id="activeUsers"></div>

        ${blocked.length > 0 ? `
          <h4 style="margin-top:20px">🚫 Заблокированные (${blocked.length})</h4>
          <div class="user-list" id="blockedUsers"></div>
        ` : ''}

        <div class="owner-info-card">
          <h4>👑 Владелец системы (защищён)</h4>
          <p>Владелец отображается в вашем профиле. Его нельзя удалить, заблокировать или понизить.</p>
        </div>
      </div>
    `;

    document.getElementById('activeUsers').innerHTML = active.map(u => `
      <div class="user-item">
        <div>
          <strong>${App.escapeHtml(u.username)}</strong>
          <span class="badge">${u.role === 'admin' ? '⚙️ Админ' : 'Пользователь'}</span>
          <small>${App.escapeHtml(u.email || '')}</small>
        </div>
        <div class="user-actions">
          <button data-userid="${u.id}" class="warning toggle-block">🔒 Заблокировать</button>
          <button data-delid="${u.id}" class="danger remove-user">🗑️ Удалить</button>
        </div>
      </div>
    `).join('');

    const blockedDiv = document.getElementById('blockedUsers');
    if (blockedDiv) {
      blockedDiv.innerHTML = blocked.map(u => `
        <div class="user-item">
          <div>
            <strong>${App.escapeHtml(u.username)}</strong>
            <span class="badge badge-blocked">заблокирован</span>
            <small>${App.escapeHtml(u.email || '')}</small>
          </div>
          <div class="user-actions">
            <button data-userid="${u.id}" class="success toggle-block">🔓 Разблокировать</button>
            <button data-delid="${u.id}" class="danger remove-user">🗑️ Удалить</button>
          </div>
        </div>
      `).join('');
    }

    // Обработчики
    document.querySelectorAll('.toggle-block').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await App.toggleBlockUser(btn.dataset.userid);
          App.showMessage('✅ Статус изменён');
        } catch (e) {
          App.showError(e.message);
        }
      });
    });

    document.querySelectorAll('.remove-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить пользователя?')) return;
        try {
          await App.removeUser(btn.dataset.delid);
          App.showMessage('🗑️ Пользователь удалён');
        } catch (e) {
          App.showError(e.message);
        }
      });
    });

    document.getElementById('addNewUserBtn').addEventListener('click', async () => {
      const errDiv = document.getElementById('addUserError');
      errDiv.textContent = '';
      const email = document.getElementById('newUserEmail').value.trim();
      const pass = document.getElementById('newUserPass').value;
      const role = document.getElementById('newUserRole').value;

      try {
        await App.createUser(email, pass, role);
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPass').value = '';
        App.showMessage('✅ Пользователь создан');
      } catch (e) {
        errDiv.textContent = e.message;
      }
    });
  };

  // ============ ВКЛАДКА: ПРОФИЛЬ ============

  App._renderProfileTab = function () {
    const tab = document.getElementById('tabProfile');
    if (!tab) return;

    const profile = App.currentUserProfile;
    const isOwner = App.isOwner();

    tab.innerHTML = `
      <div class="card">
        <h3>👤 Мой профиль</h3>
        <p><strong>Логин:</strong> ${App.escapeHtml(profile.username)}</p>
        <p><strong>Email:</strong> ${App.escapeHtml(App.currentUser.email || '')}</p>
        <p><strong>Роль:</strong> <span class="role-badge role-${profile.role}">${App._roleLabel(profile.role)}</span></p>
        <p><strong>Права:</strong> ${isOwner ? 'Абсолютные (нельзя удалить/заблокировать/понизить)' : App.isAdmin() ? 'Управление пользователями, удаление любых документов' : 'Удаление только своих документов'}</p>
        ${profile.createdAt ? `<p><strong>Создан:</strong> ${App._formatDate(profile.createdAt)}</p>` : ''}
        ${profile.lastLogin ? `<p><strong>Последний вход:</strong> ${App._formatDate(profile.lastLogin)}</p>` : ''}
      </div>

      <div class="card">
        <h3>🎨 Тема оформления</h3>
        <div class="theme-buttons">
          <button data-theme="light" class="${App.currentTheme === 'light' ? 'active' : ''}">🌞 Светлая</button>
          <button data-theme="dark" class="${App.currentTheme === 'dark' ? 'active' : ''}">🌙 Тёмная</button>
          <button data-theme="business" class="${App.currentTheme === 'business' ? 'active' : ''}">🏛️ Деловой</button>
        </div>
      </div>

      <div class="card">
        <h3>🔑 Сменить пароль</h3>
        <div class="form-group">
          <label>Текущий пароль</label>
          <input type="password" id="oldPassword">
        </div>
        <div class="form-group">
          <label>Новый пароль (12+ символов)</label>
          <input type="password" id="newPassword">
        </div>
        <div id="passwordStrength" class="password-strength"></div>
        <div class="form-group">
          <label>Подтверждение</label>
          <input type="password" id="newPassword2">
        </div>
        <div id="changePassError" class="error-msg"></div>
        <button id="changePassBtn" class="primary">Сменить пароль</button>
      </div>

      <div class="card">
        <button id="logoutBtn" class="warning full-width">🚪 Выйти из системы</button>
      </div>
    `;

    // Тема
    document.querySelectorAll('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        App.applyTheme(btn.dataset.theme);
        App.renderApp();
      });
    });

    // Слайдер для нового пароля
    const newPassInput = document.getElementById('newPassword');
    const strengthDiv = document.getElementById('passwordStrength');
    if (newPassInput) {
      newPassInput.addEventListener('input', () => {
        const s = App.passwordStrength(newPassInput.value);
        const labels = ['очень слабый', 'слабый', 'средний', 'хороший', 'отличный'];
        strengthDiv.className = 'password-strength strength-' + s;
        strengthDiv.textContent = newPassInput.value ? `Надёжность: ${labels[s]}` : '';
      });
    }

    // Смена пароля
    document.getElementById('changePassBtn').addEventListener('click', async () => {
      const errDiv = document.getElementById('changePassError');
      errDiv.textContent = '';
      const oldP = document.getElementById('oldPassword').value;
      const newP = document.getElementById('newPassword').value;
      const newP2 = document.getElementById('newPassword2').value;

      if (newP !== newP2) {
        errDiv.textContent = 'Новые пароли не совпадают';
        return;
      }

      try {
        await App.changePassword(oldP, newP);
        document.getElementById('oldPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newPassword2').value = '';
        strengthDiv.textContent = '';
        App.showMessage('✅ Пароль изменён');
      } catch (e) {
        errDiv.textContent = e.message;
      }
    });

    // Выход
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      if (!confirm('Выйти из системы?')) return;
      await App.logout();
    });
  };

  App._formatDate = function (timestamp) {
    if (!timestamp) return '—';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleString('ru-RU');
    } catch (e) {
      return '—';
    }
  };

  // ============ ЗАПУСК ============

  App.start = function () {
    try {
      App.initFirebase();
    } catch (e) {
      document.getElementById('app').innerHTML = `
        <div class="login-overlay">
          <div class="login-box" style="max-width:500px;">
            <h2>⚠️ Firebase не настроен</h2>
            <p>${App.escapeHtml(e.message)}</p>
            <p class="hint">Открой файл <code>README.md</code> и следуй инструкции.</p>
          </div>
        </div>
      `;
      return;
    }

    // Подписываемся на изменения auth
    App.onAuthStateChanged((data) => {
      if (data) {
        // Запускаем таймаут сессии
        App.startSessionTimeout(() => {
          App.logout();
          App.showMessage('⏱️ Сессия истекла (30 мин бездействия)');
        });
      } else {
        App.stopSessionTimeout();
      }
      App.renderApp();
    });
  };

  console.log('[app.js] loaded');
})();
