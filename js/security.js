// =====================================================
//  SECURITY.JS — Валидация пароля + Rate limiting
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  // ============ ВАЛИДАЦИЯ ПАРОЛЯ ============
  // Требования:
  // - минимум 12 символов
  // - минимум 1 строчная буква
  // - минимум 1 ЗАГЛАВНАЯ буква
  // - минимум 1 цифра
  // - минимум 1 спецсимвол
  // - без пробелов

  App.validatePassword = function (password) {
    const errors = [];

    if (!password || typeof password !== 'string') {
      return { ok: false, errors: ['Пароль не указан'] };
    }

    if (password.length < 12) {
      errors.push('Минимум 12 символов');
    }
    if (password.length > 128) {
      errors.push('Максимум 128 символов');
    }
    if (!/[a-zа-я]/.test(password)) {
      errors.push('Нужна хотя бы одна строчная буква');
    }
    if (!/[A-ZА-Я]/.test(password)) {
      errors.push('Нужна хотя бы одна ЗАГЛАВНАЯ буква');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Нужна хотя бы одна цифра');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
      errors.push('Нужен хотя бы один спецсимвол (!@#$%^&* и т.п.)');
    }
    if (/\s/.test(password)) {
      errors.push('Пробелы в пароле запрещены');
    }

    // Проверка на типичные слабые пароли
    const weak = ['password', 'qwerty', '123456', 'admin123', 'letmein', 'welcome'];
    if (weak.some(w => password.toLowerCase().includes(w))) {
      errors.push('Пароль слишком простой (содержит распространённое слово)');
    }

    return {
      ok: errors.length === 0,
      errors: errors
    };
  };

  // Сила пароля: 0-4
  App.passwordStrength = function (password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    return Math.min(4, Math.floor(score / 1.5));
  };

  // ============ ВАЛИДАЦИЯ EMAIL ============

  App.validateEmail = function (email) {
    if (!email || typeof email !== 'string') {
      return { ok: false, error: 'Email не указан' };
    }
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(email)) {
      return { ok: false, error: 'Некорректный формат email' };
    }
    if (email.length > 254) {
      return { ok: false, error: 'Email слишком длинный' };
    }
    return { ok: true };
  };

  // ============ HASH EMAIL для rate limiting ============
  // Используем SHA-256 чтобы не светить email в Firestore
  // Простая реализация через Web Crypto API

  App.hashEmail = async function (email) {
    const normalized = email.toLowerCase().trim();
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // ============ RATE LIMITING ============
  // Правила: 5 неудачных попыток → блокировка на 15 минут

  const MAX_ATTEMPTS = 5;
  const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 минут

  App.loginAttempts = {
    /**
     * Проверить, не заблокирован ли email
     * @returns {Promise<{blocked: boolean, retryAfter?: number}>}
     */
    async check(email) {
      const hash = await App.hashEmail(email);
      const ref = window.firebase.firestore().collection('loginAttempts').doc(hash);
      const snap = await ref.get();

      if (!snap.exists) {
        return { blocked: false };
      }

      const data = snap.data();
      const now = Date.now();
      const blockedUntil = data.blockedUntil?.toMillis?.() || 0;

      if (blockedUntil > now) {
        const retryAfter = Math.ceil((blockedUntil - now) / 1000);
        return { blocked: true, retryAfter };
      }

      return { blocked: false };
    },

    /**
     * Записать неудачную попытку. Возвращает true, если email теперь заблокирован.
     */
    async recordFailure(email) {
      const hash = await App.hashEmail(email);
      const ref = window.firebase.firestore().collection('loginAttempts').doc(hash);
      const now = window.firebase.firestore.FieldValue.serverTimestamp();

      const result = await window.firebase.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? snap.data() : { count: 0 };
        const newCount = (current.count || 0) + 1;

        const update = {
          count: newCount,
          lastAttempt: now
        };

        if (newCount >= MAX_ATTEMPTS) {
          const blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
          update.blockedUntil = window.firebase.firestore.Timestamp.fromDate(blockedUntil);
        }

        tx.set(ref, update, { merge: true });
        return newCount >= MAX_ATTEMPTS;
      });

      return result;
    },

    /**
     * Сбросить счётчик (после успешного входа)
     */
    async reset(email) {
      const hash = await App.hashEmail(email);
      const ref = window.firebase.firestore().collection('loginAttempts').doc(hash);
      await ref.delete();
    },

    formatRetryAfter(seconds) {
      if (seconds < 60) return `${seconds} сек`;
      const mins = Math.ceil(seconds / 60);
      return `${mins} мин`;
    }
  };

  // ============ ЭКРАНИРОВАНИЕ HTML (XSS защита) ============

  App.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, function (m) {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
      }
      return m;
    });
  };

  // ============ TIMEOUT СЕССИИ (30 мин) ============

  const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  let inactivityTimer = null;

  App.startSessionTimeout = function (onTimeout) {
    const reset = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        if (onTimeout) onTimeout();
      }, SESSION_TIMEOUT_MS);
    };

    ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(ev => {
      document.addEventListener(ev, reset, { passive: true });
    });

    reset();
  };

  App.stopSessionTimeout = function () {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  console.log('[security.js] loaded');
})();
