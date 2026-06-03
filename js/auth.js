// =====================================================
//  AUTH.JS — Вход, выход, регистрация, Owner wizard
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  // Текущий пользователь (Firebase User + Firestore profile)
  App.currentUser = null;
  App.currentUserProfile = null;

  // Инициализация Firebase (вызывается из app.js)
  App.initFirebase = function () {
    if (!window.firebaseConfig) {
      throw new Error('firebaseConfig не найден. Заполни js/firebase-config.js');
    }
    if (window.firebaseConfig.apiKey === 'ВСТАВЬ_СЮДА_API_KEY') {
      throw new Error('firebase-config.js не заполнен! См. README.md');
    }

    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(window.firebaseConfig);
    }

    App.auth = window.firebase.auth();
    App.db = window.firebase.firestore();

    // Персистентность сессии
    App.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
  };

  // ============ ПРОВЕРКА: СУЩЕСТВУЕТ ЛИ OWNER ============

  App.checkOwnerExists = async function () {
    try {
      const doc = await App.db.collection('config').doc('owner').get();
      return doc.exists;
    } catch (e) {
      console.error('checkOwnerExists:', e);
      return false;
    }
  };

  // ============ СОЗДАНИЕ ВЛАДЕЛЬЦА (одноразово) ============

  App.createOwner = async function (email, password) {
    // Валидация
    const emailCheck = App.validateEmail(email);
    if (!emailCheck.ok) {
      throw new Error(emailCheck.error);
    }
    const passCheck = App.validatePassword(password);
    if (!passCheck.ok) {
      throw new Error('Слабый пароль:\n• ' + passCheck.errors.join('\n• '));
    }

    // Проверяем что owner ещё не создан
    const exists = await App.checkOwnerExists();
    if (exists) {
      throw new Error('Владелец уже существует. Эта функция доступна только при первом запуске.');
    }

    // 1. Создаём Firebase Auth пользователя
    const userCredential = await App.auth.createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;

    try {
      // 2. Создаём профиль в Firestore
      const username = email.split('@')[0];
      await App.db.collection('users').doc(user.uid).set({
        username: username,
        email: email,
        role: 'owner',
        blocked: false,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: window.firebase.firestore.FieldValue.serverTimestamp()
      });

      // 3. Записываем config/owner
      await App.db.collection('config').doc('owner').set({
        ownerUid: user.uid,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });

      return user;
    } catch (e) {
      // Откат: удаляем Auth-юзера если Firestore не сработал
      try { await user.delete(); } catch (_) {}
      throw e;
    }
  };

  // ============ ПУБЛИЧНАЯ РЕГИСТРАЦИЯ ============
  // Самостоятельная регистрация нового пользователя (роль 'user').
  // Требует подтверждения пароля.

  App.register = async function (email, password, passwordConfirm) {
    // Валидация email
    const emailCheck = App.validateEmail(email);
    if (!emailCheck.ok) {
      throw new Error(emailCheck.error);
    }

    if (!password) throw new Error('Введите пароль');

    if (password !== passwordConfirm) {
      throw new Error('Пароли не совпадают');
    }

    // Валидация пароля
    const passCheck = App.validatePassword(password);
    if (!passCheck.ok) {
      throw new Error('Слабый пароль:\n• ' + passCheck.errors.join('\n• '));
    }

    try {
      // 1. Создаём Firebase Auth пользователя
      const userCredential = await App.auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      try {
        // 2. Создаём профиль в Firestore с ролью 'user'
        const username = email.split('@')[0];
        await App.db.collection('users').doc(user.uid).set({
          username: username,
          email: email,
          role: 'user',
          blocked: false,
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          lastLogin: window.firebase.firestore.FieldValue.serverTimestamp()
        });

        // onAuthStateChanged → renderApp отрисует главный экран
        return user;
      } catch (e) {
        // Откат: удаляем Auth-юзера если Firestore не сработал
        try { await user.delete(); } catch (_) {}
        throw e;
      }
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        throw new Error('Пользователь с таким email уже существует');
      }
      throw e;
    }
  };

  // ============ ВХОД ============

  App.login = async function (email, password) {
    const emailCheck = App.validateEmail(email);
    if (!emailCheck.ok) throw new Error(emailCheck.error);

    if (!password) throw new Error('Введите пароль');

    // 1. Проверка блокировки
    const blockCheck = await App.loginAttempts.check(email);
    if (blockCheck.blocked) {
      const wait = App.loginAttempts.formatRetryAfter(blockCheck.retryAfter);
      throw new Error(`Слишком много неудачных попыток. Попробуйте через ${wait}.`);
    }

    try {
      // 2. Firebase Auth вход
      const userCredential = await App.auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      // 3. Получаем профиль из Firestore
      const profileSnap = await App.db.collection('users').doc(user.uid).get();

      if (!profileSnap.exists) {
        await App.auth.signOut();
        throw new Error('Профиль пользователя не найден. Обратитесь к администратору.');
      }

      const profile = profileSnap.data();

      // 4. Проверка блокировки
      if (profile.blocked) {
        await App.auth.signOut();
        throw new Error('Ваш аккаунт заблокирован. Обратитесь к администратору.');
      }

      // 5. Обновляем lastLogin
      await App.db.collection('users').doc(user.uid).update({
        lastLogin: window.firebase.firestore.FieldValue.serverTimestamp()
      });

      // 6. Сбрасываем счётчик неудачных попыток
      await App.loginAttempts.reset(email);

      // 7. Сохраняем
      App.currentUser = user;
      App.currentUserProfile = profile;

      return { user, profile };
    } catch (e) {
      // Записываем неудачную попытку
      if (e.code === 'auth/wrong-password' ||
          e.code === 'auth/user-not-found' ||
          e.code === 'auth/invalid-credential' ||
          e.code === 'auth/invalid-email') {
        const nowBlocked = await App.loginAttempts.recordFailure(email);
        if (nowBlocked) {
          throw new Error('Слишком много неудачных попыток. Вход заблокирован на 15 минут.');
        }
        throw new Error('Неверный email или пароль');
      }
      throw e;
    }
  };

  // ============ ВЫХОД ============

  App.logout = async function () {
    App.stopSessionTimeout();
    App.currentUser = null;
    App.currentUserProfile = null;
    await App.auth.signOut();
  };

  // ============ СМЕНА ПАРОЛЯ ============

  App.changePassword = async function (oldPassword, newPassword) {
    if (!App.currentUser) throw new Error('Вы не залогинены');

    const passCheck = App.validatePassword(newPassword);
    if (!passCheck.ok) {
      throw new Error('Слабый пароль:\n• ' + passCheck.errors.join('\n• '));
    }

    // 1. Реавторизация (Firebase требует)
    const credential = window.firebase.auth.EmailAuthProvider.credential(
      App.currentUser.email,
      oldPassword
    );

    try {
      await App.currentUser.reauthenticateWithCredential(credential);
    } catch (e) {
      if (e.code === 'auth/wrong-password') {
        throw new Error('Неверный текущий пароль');
      }
      throw e;
    }

    // 2. Меняем пароль
    await App.currentUser.updatePassword(newPassword);
  };

  // ============ СОЗДАНИЕ ПОЛЬЗОВАТЕЛЯ (админом/владельцем) ============
  // Используем второй экземпляр Firebase-приложения, чтобы не сбрасывать сессию админа.
  // Это документированный workaround: https://firebase.google.com/docs/auth/web/account-creation

  let _secondaryAuth = null;

  function getSecondaryAuth() {
    if (_secondaryAuth) return _secondaryAuth;
    const secondaryApp = window.firebase.initializeApp(window.firebaseConfig, 'Secondary_' + Date.now());
    _secondaryAuth = secondaryApp.auth();
    return _secondaryAuth;
  }

  App.createUserByAdmin = async function (email, password, role) {
    if (!App.currentUserProfile) throw new Error('Не залогинены');
    if (App.currentUserProfile.role !== 'admin' && App.currentUserProfile.role !== 'owner') {
      throw new Error('Недостаточно прав');
    }

    const emailCheck = App.validateEmail(email);
    if (!emailCheck.ok) throw new Error(emailCheck.error);

    const passCheck = App.validatePassword(password);
    if (!passCheck.ok) {
      throw new Error('Слабый пароль:\n• ' + passCheck.errors.join('\n• '));
    }

    if (role !== 'admin' && role !== 'user') {
      throw new Error('Некорректная роль. Допустимо: admin или user');
    }

    try {
      // 1. Создаём нового пользователя через ВТОРИЧНЫЙ инстанс Firebase
      //    Это не сбрасывает сессию текущего админа.
      const secondaryAuth = getSecondaryAuth();
      const userCredential = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      const newUser = userCredential.user;

      // 2. Сразу выходим из вторичного инстанса
      await secondaryAuth.signOut();

      // 3. Создаём профиль в Firestore через основной инстанс
      const username = email.split('@')[0];
      await App.db.collection('users').doc(newUser.uid).set({
        username: username,
        email: email,
        role: role,
        blocked: false,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: App.currentUserProfile.username
      });

      return { uid: newUser.uid, email, role };
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        throw new Error('Пользователь с таким email уже существует');
      }
      throw e;
    }
  };

  // ============ ПРОВЕРКА РОЛИ (helpers) ============

  App.isOwner = function () {
    return App.currentUserProfile && App.currentUserProfile.role === 'owner';
  };

  App.isAdmin = function () {
    return App.currentUserProfile && App.currentUserProfile.role === 'admin';
  };

  App.isAdminOrOwner = function () {
    return App.isOwner() || App.isAdmin();
  };

  // ============ ПОДПИСКА НА ИЗМЕНЕНИЯ AUTH ============

  App.onAuthStateChanged = function (callback) {
    return App.auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const profileSnap = await App.db.collection('users').doc(user.uid).get();
          if (profileSnap.exists) {
            const profile = profileSnap.data();
            if (!profile.blocked) {
              App.currentUser = user;
              App.currentUserProfile = profile;
              callback({ user, profile });
              return;
            }
          }
        } catch (e) {
          console.error('onAuthStateChanged:', e);
        }
        // Если что-то не так — выходим
        await App.auth.signOut();
        App.currentUser = null;
        App.currentUserProfile = null;
        callback(null);
      } else {
        App.currentUser = null;
        App.currentUserProfile = null;
        callback(null);
      }
    });
  };

  console.log('[auth.js] loaded');
})();
