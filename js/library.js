// =====================================================
//  LIBRARY.JS — CRUD документов (через Firestore)
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  // Кэш документов в памяти
  App.documentsCache = [];
  App.documentsListener = null;

  /**
   * Подписка на изменения коллекции документов (real-time updates)
   */
  App.subscribeDocuments = function (callback) {
    if (App.documentsListener) {
      App.documentsListener();
      App.documentsListener = null;
    }

    App.documentsListener = App.db.collection('documents')
      .orderBy('createdAt', 'desc')
      .onSnapshot(snap => {
        App.documentsCache = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        if (callback) callback(App.documentsCache);
      }, err => {
        console.error('subscribeDocuments error:', err);
        if (callback) callback([]);
      });
  };

  App.unsubscribeDocuments = function () {
    if (App.documentsListener) {
      App.documentsListener();
      App.documentsListener = null;
    }
  };

  App.getDocuments = function () {
    return App.documentsCache;
  };

  /**
   * Добавить документ
   */
  App.addDocument = async function (title, url, desc, tagsStr, keywordsStr, format) {
    if (!title || !url) throw new Error('Название и ссылка обязательны');

    if (!App.currentUser) throw new Error('Не залогинены');

    const urlCheck = App.validateUrl(url);
    if (!urlCheck.ok) throw new Error(urlCheck.error);

    const tags = (tagsStr || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t);

    const doc = {
      title: title.trim(),
      url: url.trim(),
      description: (desc || '').trim() || '—',
      tags: tags,
      keywords: (keywordsStr || '').trim(),
      format: format || 'other',
      ownerUid: App.currentUser.uid,
      ownerUsername: App.currentUserProfile.username,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };

    await App.db.collection('documents').add(doc);
  };

  /**
   * Удалить документ
   */
  App.deleteDocument = async function (docId) {
    if (!App.currentUserProfile) throw new Error('Не залогинены');

    const doc = App.documentsCache.find(d => d.id === docId);
    if (!doc) throw new Error('Документ не найден');

    const canDelete = App.isAdminOrOwner() || doc.ownerUid === App.currentUser.uid;
    if (!canDelete) {
      throw new Error('Вы можете удалять только свои документы');
    }

    await App.db.collection('documents').doc(docId).delete();
  };

  /**
   * Может ли текущий юзер удалить документ (синхронная проверка)
   */
  App.canDeleteDocument = function (doc) {
    if (!App.currentUserProfile) return false;
    if (App.isAdminOrOwner()) return true;
    return doc.ownerUid === App.currentUser.uid;
  };

  /**
   * Проверка URL
   */
  App.validateUrl = function (url) {
    if (!url || typeof url !== 'string') {
      return { ok: false, error: 'Ссылка не указана' };
    }
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        return { ok: false, error: 'Только http(s) ссылки' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Некорректный URL' };
    }
  };

  console.log('[library.js] loaded');
})();
