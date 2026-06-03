// =====================================================
//  SEARCH.JS — Умный поиск с релевантностью
// =====================================================

(function () {
  'use strict';

  const App = window.App = window.App || {};

  /**
   * Поиск с подсчётом релевантности.
   * @param {string} query - поисковый запрос
   * @param {Array} docs - массив документов
   * @returns {Array} отсортированный по релевантности массив
   */
  App.smartSearch = function (query, docs) {
    if (!query || !query.trim()) {
      return docs.map(d => Object.assign({}, d, { relevance: 0 }));
    }

    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 1);

    const results = docs.map(doc => {
      let relevance = 0;
      const searchText = (
        (doc.title || '') + ' ' +
        (doc.description || '') + ' ' +
        (doc.tags || []).join(' ') + ' ' +
        (doc.keywords || '')
      ).toLowerCase();

      // Полное совпадение фразы — высший приоритет
      if (searchText.includes(q)) relevance += 100;

      // Совпадения по словам
      for (const word of words) {
        if (searchText.includes(word)) {
          relevance += 10;
          if ((doc.keywords || '').toLowerCase().includes(word)) relevance += 20;
          if ((doc.title || '').toLowerCase().includes(word)) relevance += 15;
        }
      }

      return Object.assign({}, doc, { relevance });
    });

    let filtered = results.filter(r => r.relevance > 0);
    filtered.sort((a, b) => b.relevance - a.relevance);

    // Если ничего не нашли, ищем по фрагментам (нечёткий поиск)
    if (filtered.length === 0 && q.length > 2) {
      filtered = results.filter(r => {
        const searchText = ((r.title || '') + ' ' + (r.keywords || '')).toLowerCase();
        for (let i = 0; i <= q.length - 3; i++) {
          const fragment = q.substring(i, i + 3);
          if (searchText.includes(fragment)) return true;
        }
        return false;
      });
    }

    return filtered;
  };

  /**
   * Получить все ключевые слова из всех документов (для подсказок)
   */
  App.getAllKeywords = function (documents) {
    const allKeywords = new Set();
    documents.forEach(doc => {
      if (doc.keywords) {
        doc.keywords.split(/[,;\s]+/).forEach(k => {
          const clean = k.trim().toLowerCase();
          if (clean.length > 2) allKeywords.add(clean);
        });
      }
      if (doc.tags) {
        doc.tags.forEach(t => allKeywords.add(t.toLowerCase()));
      }
    });
    return Array.from(allKeywords).slice(0, 20);
  };

  console.log('[search.js] loaded');
})();
