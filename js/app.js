'use strict';

// 1. Настройки и элементы страницы

const STORAGE_KEY = 'scinav-final-sources';
const SCORE_VERSION = 1;
const SEARCH_TIMEOUT = 18000;
const NOTICE_DURATION = 4000;

const grid = document.querySelector('.cards-grid');
const input = document.querySelector('.search-input');
const searchButton = document.querySelector('.search-btn');
const tableBody = document.querySelector('#table-body');
const tableDialog = document.querySelector('#source-table');
const accountDialog = document.querySelector('#account-info');
const exportButton = document.querySelector('#download-list');
const noticeElement = document.querySelector('#notice');
const filterButtons = document.querySelectorAll('.filter-btn');
const documentIcon = grid.querySelector('.card-icon').innerHTML;

let cards = readExampleCards();
let saved = loadSavedSources();
let activeFilter = 'Все';
let isSearching = false;
let noticeTimer;

// 2. Вспомогательные функции и локальное хранение

// Текст из внешнего каталога не должен превращаться в HTML разметку.
function escapeText(value) {
  const replacements = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  return String(value ?? '').replace(/[&<>"']/g, function (character) {
    return replacements[character];
  });
}

function safeLink(value) {
  try {
    const url = new URL(value);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Некорректную ссылку не выводим в карточке.
  }

  return '';
}

function notice(message) {
  noticeElement.textContent = message;
  clearTimeout(noticeTimer);

  noticeTimer = setTimeout(function () {
    noticeElement.textContent = '';
  }, NOTICE_DURATION);
}

function readExampleCards() {
  const exampleCards = Array.from(grid.querySelectorAll('.card'));

  return exampleCards.map(function (card, index) {
    return {
      id: 'example-' + index,
      title: card.querySelector('.card-title').textContent,
      authors: 'А. И. Иванов, М. С. Петрова',
      year: 2022,
      venue: 'Пример карточки макета',
      score: '8/10',
      url: ''
    };
  });
}

function loadSavedSources() {
  try {
    const storedText = localStorage.getItem(STORAGE_KEY) || '[]';
    const sources = JSON.parse(storedText);

    if (!Array.isArray(sources)) {
      return [];
    }

    return sources.filter(function (source) {
      return source && typeof source.id === 'string'
        && typeof source.title === 'string';
    });
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    notice('Не удалось сохранить список. Экспортируйте его перед закрытием.');
  }
}

function isSourceSaved(sourceId) {
  return saved.some(function (source) {
    return source.id === sourceId;
  });
}

// 3. Автооценка пригодности по метаданным, а не научная экспертиза

function getSearchWords(text) {
  const ignoredWords = [
    'the', 'and', 'for', 'with',
    'влияние', 'роль', 'для', 'как', 'при', 'или', 'это', 'его', 'ии'
  ];
  const lowerText = String(text || '').toLocaleLowerCase();
  const words = lowerText.match(/[\p{L}\p{N}]+/gu) || [];
  const uniqueWords = Array.from(new Set(words));

  return uniqueWords.filter(function (word) {
    return word.length > 2 && !ignoredWords.includes(word);
  });
}

function calculateRating(source, query = source.searchQuery || '') {
  if (source.id.startsWith('example-')) {
    return {
      score: '8/10',
      reason: 'Демонстрационная оценка из макета',
      version: SCORE_VERSION
    };
  }

  // Совпадение слов запроса с заголовком: до 5 баллов.
  const searchWords = getSearchWords(query);
  const title = String(source.title || '').toLocaleLowerCase();
  let overlap = null;
  let relevancePoints = null;

  if (searchWords.length > 0) {
    const matchingWords = searchWords.filter(function (word) {
      return title.includes(word);
    });

    overlap = matchingWords.length / searchWords.length;
    relevancePoints = Math.round(overlap * 5);
  }

  // Цитируемость: до 3 баллов. Логарифм сглаживает большие числа.
  let citations = null;
  let citationPoints = null;

  if (Number.isFinite(source.cited)) {
    citations = Math.max(0, source.cited);
    citationPoints = Math.min(3, Math.log10(1 + citations));
  }

  // За каждое заполненное поле даём 0,5 балла: всего до 2.
  let completenessPoints = 0;

  if (source.authors) completenessPoints += 0.5;
  if (source.year) completenessPoints += 0.5;
  if (source.venue && source.venue !== 'OpenAlex') completenessPoints += 0.5;
  if (safeLink(source.url)) completenessPoints += 0.5;

  // Если данные неизвестны, исключаем компонент из доступного максимума.
  let availablePoints = 2;
  if (relevancePoints !== null) availablePoints += 5;
  if (citationPoints !== null) availablePoints += 3;

  const totalPoints = completenessPoints
    + (relevancePoints || 0)
    + (citationPoints || 0);
  const roundedScore = Math.round(totalPoints / availablePoints * 10);
  const finalScore = Math.max(1, Math.min(10, roundedScore));

  let explanation = 'Автооценка соответствия: ' + finalScore + '/10. ';

  if (relevancePoints === null) {
    explanation += 'Тема поиска не сохранена; совпадение не учитывается. ';
  } else {
    explanation += 'Совпадение слов темы с заголовком: '
      + Math.round(overlap * 100) + '%. ';
  }

  if (citations === null) {
    explanation += 'Цитируемость неизвестна; не учитывается. ';
  } else {
    explanation += 'Цитирований: ' + citations + '. ';
  }

  explanation += 'Полнота сведений: '
    + Math.round(completenessPoints / 2 * 100) + '%. '
    + 'Эвристика по метаданным, не оценка научной достоверности.';

  return {
    score: finalScore + '/10',
    reason: explanation,
    version: SCORE_VERSION
  };
}

function rateItem(source) {
  const rating = calculateRating(source);

  return {
    ...source,
    score: rating.score,
    scoreReason: rating.reason,
    scoreVersion: rating.version
  };
}

// 4. Отображение карточек и таблицы

function ratingControl(source) {
  const rating = calculateRating(source);
  const explanation = escapeText(rating.reason);

  return `
    <span class="card-rating auto-rating" tabindex="0"
      aria-label="${explanation}" title="${explanation}">
      ${rating.score}
    </span>
  `;
}

function createCardHTML(source) {
  const sourceUrl = safeLink(source.url);
  const title = escapeText(source.title);
  const savedLabel = isSourceSaved(source.id)
    ? '✓ В таблице'
    : 'Добавить в таблицу';

  let titleHTML = title;
  if (sourceUrl) {
    titleHTML = `
      <a href="${escapeText(sourceUrl)}" target="_blank" rel="noopener">
        ${title}
      </a>
    `;
  }

  return `
    <article class="card">
      <div class="card-top">
        <div class="card-icon">${documentIcon}</div>
        <div class="card-content">
          <h3 class="card-title">${titleHTML}</h3>
          <p class="card-meta">
            ${escapeText(source.authors)} · ${escapeText(source.year || 'Б. г.')}
            · ${escapeText(source.venue)}
          </p>
        </div>
      </div>
      <div class="card-bottom">
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm"
            data-add="${escapeText(source.id)}">${savedLabel}</button>
          <button class="btn btn-secondary btn-sm"
            data-export="${escapeText(source.id)}">Экспорт</button>
        </div>
        ${ratingControl(source)}
      </div>
    </article>
  `;
}

function render() {
  // Сортируем копию, чтобы не потерять исходный порядок ответа OpenAlex.
  const visibleCards = [...cards];

  if (activeFilter === 'Новое' || activeFilter === 'По дате') {
    visibleCards.sort(function (first, second) {
      return (second.year || 0) - (first.year || 0);
    });
  }

  if (activeFilter === 'Популярное') {
    visibleCards.sort(function (first, second) {
      return (second.cited || 0) - (first.cited || 0);
    });
  }

  if (visibleCards.length === 0) {
    grid.innerHTML = '<p>Источники не найдены. Попробуйте изменить запрос.</p>';
    return;
  }

  grid.innerHTML = visibleCards.map(createCardHTML).join('');
}

function createTableRowHTML(source, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeText(source.title)}</td>
      <td>${ratingControl(source)}</td>
      <td>
        <button data-remove="${escapeText(source.id)}"
          aria-label="Удалить источник">×</button>
      </td>
    </tr>
  `;
}

function table() {
  if (saved.length === 0) {
    tableBody.innerHTML = `
      <tr><td colspan="4">Добавьте источники из результатов поиска.</td></tr>
    `;
  } else {
    tableBody.innerHTML = saved.map(createTableRowHTML).join('');
  }

  exportButton.disabled = saved.length === 0;
}

function openSourceTable() {
  table();
  tableDialog.showModal();
}

// 5. Добавление, удаление и экспорт источников

function addSource(sourceId) {
  const source = cards.find(function (card) {
    return card.id === sourceId;
  });

  if (!source || isSourceSaved(sourceId)) {
    openSourceTable();
    return;
  }

  saved.push(source);
  persist();
  render();
  notice('Источник добавлен в таблицу');
}

function removeSource(sourceId) {
  saved = saved.filter(function (source) {
    return source.id !== sourceId;
  });

  persist();
  table();
  render();
}

function bibliography(sources) {
  return sources.map(function (source, index) {
    let entry = `${index + 1}. ${source.authors}. ${source.title}`
      + ` // ${source.venue}. — ${source.year || 'Б. г.'}.`;
    const sourceUrl = safeLink(source.url);

    if (sourceUrl) {
      entry += ' — URL: ' + sourceUrl;
    }

    return entry;
  }).join('\n\n');
}

function download(sources) {
  const warning = 'Черновик списка литературы. '
    + 'Проверьте выходные данные и требования к оформлению.\n\n';
  const file = new Blob([warning + bibliography(sources)], {
    type: 'text/plain;charset=utf-8'
  });
  const fileUrl = URL.createObjectURL(file);
  const link = document.createElement('a');

  link.href = fileUrl;
  link.download = 'SciNav-sources.txt';
  link.click();

  setTimeout(function () {
    URL.revokeObjectURL(fileUrl);
  }, 1000);
}

// 6. Получение публикаций из OpenAlex

function convertPublication(publication, query) {
  const authorships = publication.authorships || [];
  const authors = authorships.slice(0, 3).map(function (authorship) {
    return authorship.author?.display_name;
  }).filter(Boolean).join(', ');

  return {
    id: publication.id,
    title: publication.display_name,
    authors: authors,
    year: publication.publication_year,
    venue: publication.primary_location?.source?.display_name || 'OpenAlex',
    url: publication.doi || publication.primary_location?.landing_page_url
      || publication.id,
    cited: Number.isFinite(publication.cited_by_count)
      ? publication.cited_by_count
      : null,
    searchQuery: query
  };
}

function refreshSavedSources() {
  saved = saved.map(function (oldSource) {
    const currentSource = cards.find(function (card) {
      return card.id === oldSource.id;
    });

    if (currentSource) {
      return { ...oldSource, ...currentSource };
    }

    return oldSource;
  });
}

async function search() {
  if (isSearching) return;

  const errorMessage = document.querySelector('#search-error');
  const searchForm = document.querySelector('.search-box');
  if (!input.value.trim()) {
    errorMessage.textContent = 'Введите тему исследования.';
    errorMessage.hidden = false;
    searchForm.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  errorMessage.hidden = true;
  input.removeAttribute('aria-invalid');
  searchForm.classList.remove('has-error');

  isSearching = true;
  searchButton.disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, SEARCH_TIMEOUT);

  notice('Поиск источников…');

  try {
    const parameters = new URLSearchParams({
      search: input.value.trim(),
      'per-page': '6'
    });
    const response = await fetch('https://api.openalex.org/works?' + parameters, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error('OpenAlex вернул HTTP ошибку');
    }

    const data = await response.json();
    if (!Array.isArray(data.results)) {
      throw new Error('В ответе OpenAlex нет массива results');
    }

    cards = data.results.map(function (publication) {
      const source = convertPublication(publication, input.value.trim());
      return rateItem(source);
    });

    refreshSavedSources();
    persist();
    render();

    if (cards.length > 0) {
      notice('Источники найдены');
    } else {
      notice('По этому запросу ничего не найдено');
    }
  } catch {
    notice('Поиск недоступен. Проверьте интернет и повторите попытку.');
  } finally {
    clearTimeout(timeout);
    isSearching = false;
    searchButton.disabled = false;
  }
}

// 7. Обработчики действий пользователя

function handleCardClick(event) {
  const addButton = event.target.closest('[data-add]');
  const downloadButton = event.target.closest('[data-export]');

  if (addButton) {
    addSource(addButton.dataset.add);
  }

  if (downloadButton) {
    const source = cards.find(function (card) {
      return card.id === downloadButton.dataset.export;
    });

    if (source) {
      download([source]);
    }
  }
}

function handleTableClick(event) {
  const removeButton = event.target.closest('[data-remove]');
  if (removeButton) {
    removeSource(removeButton.dataset.remove);
  }
}

function changeFilter(selectedButton) {
  filterButtons.forEach(function (button) {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  });

  selectedButton.classList.add('active');
  selectedButton.setAttribute('aria-pressed', 'true');
  activeFilter = selectedButton.textContent;
  render();
}

function registerEvents() {
  // Событие на контейнере работает и после перерисовки карточек.
  grid.addEventListener('click', handleCardClick);
  tableBody.addEventListener('click', handleTableClick);
  document.querySelector('.menu-btn').addEventListener('click', openSourceTable);

  document.querySelector('#close-table').onclick = function () {
    tableDialog.close();
  };

  exportButton.onclick = function () {
    download(saved);
  };

  filterButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      changeFilter(button);
    });
  });

  document.querySelector('.search-box').addEventListener('submit', function (event) {
    event.preventDefault();
    search();
  });

  input.addEventListener('input', function () {
    if (input.value.trim()) {
      document.querySelector('#search-error').hidden = true;
      document.querySelector('.search-box').classList.remove('has-error');
      input.removeAttribute('aria-invalid');
    }
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      search();
    }
  });

  const accountLinks = document.querySelectorAll(
    'a[href="#login"],a[href="#register"]'
  );

  accountLinks.forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      accountDialog.showModal();
    });
  });

  document.querySelector('#close-account').onclick = function () {
    accountDialog.close();
  };
}

// 8. Запуск после разбора HTML (скрипт подключён с defer)

saved = saved.map(rateItem);
persist();
registerEvents();
render();
