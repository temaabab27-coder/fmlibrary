// =====================================================
//  ADMIN.JS — Управление пользователями
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  // Кэш пользователей
  App.usersCache = [];
  App.usersListener = null;

  /**
   * Подписка на изменения пользователей (только для admin/owner)
   */
  App.subscribeUsers = function (callback) {
    if (App.usersListener) {
      App.usersListener();
      App.usersListener = null;
    }

    App.usersListener = App.db.collection('users')
      .onSnapshot(snap => {
        App.usersCache = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        if (callback) callback(App.usersCache);
      }, err => {
        console.error('subscribeUsers error:', err);
        if (callback) callback([]);
      });
  };

  App.unsubscribeUsers = function () {
    if (App.usersListener) {
      App.usersListener();
      App.usersListener = null;
    }
  };

  App.getUsers = function () {
    return App.usersCache;
  };

  /**
   * Заблокировать/разблокировать пользователя
   */
  App.toggleBlockUser = async function (userId) {
    if (!App.isAdminOrOwner()) throw new Error('Недостаточно прав');

    const user = App.usersCache.find(u => u.id === userId);
    if (!user) throw new Error('Пользователь не найден');

    // Нельзя блокировать owner
    if (user.role === 'owner') {
      throw new Error('Нельзя заблокировать владельца системы');
    }

    await App.db.collection('users').doc(userId).update({
      blocked: !user.blocked
    });
  };

  /**
   * Удалить пользователя
   */
  App.removeUser = async function (userId) {
    if (!App.isAdminOrOwner()) throw new Error('Недостаточно прав');

    const user = App.usersCache.find(u => u.id === userId);
    if (!user) throw new Error('Пользователь не найден');

    if (user.role === 'owner') {
      throw new Error('Нельзя удалить владельца системы');
    }

    if (user.role === 'admin' && !App.isOwner()) {
      throw new Error('Только владелец системы может удалять администраторов');
    }

    // Удаляем запись в Firestore
    await App.db.collection('users').doc(userId).delete();
    // Удаление из Firebase Auth — нужны Cloud Functions.
    // Без них: запись в Firestore удалена, но аккаунт Auth остаётся.
    // Он не сможет войти, так как профиля нет.
  };

  /**
   * Создать нового пользователя (вызывается из admin.js → auth.js)
   */
  App.createUser = async function (email, password, role) {
    return await App.createUserByAdmin(email, password, role);
  };

  console.log('[admin.js] loaded');
})();
