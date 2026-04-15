const BASE_URL = '/frontend-questions';

// ─── Состояние ───────────────────────────────────────────────────────────────

let manifest = null;
let allQuestions = [];
let categoryTree = [];
let activeQuestion = null;
let questionStatuses = {};
let currentFilter = 'all';

// ─── Кэш DOM-элементов (заполняется один раз в cacheDom) ─────────────────────

const DOM = {};

function cacheDom() {
  [
    'loading', 'question-view', 'welcome-screen', 'breadcrumb', 'question-grade',
    'question-title', 'question-subtitle', 'explanation-content', 'expand-btn',
    'explanation-header', 'main-content', 'sidebar-tree', 'sidebar', 'sidebar-filter',
    'search-input', 'search-results', 'btn-prev', 'btn-next', 'scroll-to-top',
    'status-repeat', 'status-learned', 'status-repeat-bottom', 'status-learned-bottom',
    'compact-toggle', 'drawer-overlay', 'mobile-drawer-toggle', 'drawer-close'
  ].forEach(id => { DOM[id] = document.getElementById(id); });

  // Единственный querySelector — закэшируем тоже
  DOM['explanation-section'] = document.querySelector('.explanation-section');
}

// ─── localStorage ─────────────────────────────────────────────────────────────

const LS_KEY = 'questions_statuses';

function loadStatuses() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) questionStatuses = JSON.parse(raw);
  } catch(e) { questionStatuses = {}; }
}

function saveStatuses() {
  localStorage.setItem(LS_KEY, JSON.stringify(questionStatuses));
}

function getStatus(questionId) {
  return questionStatuses[questionId] || null;
}

function setStatus(questionId, status) {
  if (questionStatuses[questionId] === status) {
    delete questionStatuses[questionId];
  } else {
    questionStatuses[questionId] = status;
  }
  saveStatuses();
}

// ─── Инициализация ────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadStatuses();
  cacheDom(); // <-- кэшируем DOM до всего остального
  hljs.configure({ ignoreUnescapedHTML: true });

  setupMobileDrawer();
  setupScrollToTop();

  try {
    manifest = await fetch(`${BASE_URL}/index.json`).then(r => r.json());

    const allPromises = [];
    manifest.categories.forEach(cat => {
      cat.topics.forEach(topic => {
        topic.files.forEach(file => {
          allPromises.push(
            fetch(`${BASE_URL}/${file}`)
              .then(r => r.json())
              .then(data => ({ categoryName: cat.name, topicName: topic.name, subtopicName: null, fileName: file, data }))
          );
        });
        if (topic.subtopics) {
          topic.subtopics.forEach(sub => {
            sub.files.forEach(file => {
              allPromises.push(
                fetch(`${BASE_URL}/${file}`)
                  .then(r => r.json())
                  .then(data => ({ categoryName: cat.name, topicName: topic.name, subtopicName: sub.name, fileName: file, data }))
              );
            });
          });
        }
      });
    });

    const results = await Promise.all(allPromises);
    buildQuestionIndex(results);
    buildQuestionById(); // O(1)-индекс для prev/next навигации
    buildSidebar();

    DOM['loading'].style.display = 'none';

    setupSearch();
    setupCompactToggle();
    setupExpandBtn();
    setupStatusButtons();
    setupFilter();

    const savedIdx = parseInt(localStorage.getItem('active_question_idx'), 10);

    if (!isNaN(savedIdx) && allQuestions[savedIdx]) {
      showQuestion(savedIdx);
    }  else if (allQuestions.length > 0) {
      showQuestion(0);
    } else {
      DOM['welcome-screen'].style.display = 'block';
    }
  } catch (err) {
    console.error('Ошибка загрузки:', err);
    DOM['loading'].innerHTML = '<p style="color:#e57373;">Ошибка загрузки данных</p>';
  }
}

// ─── Построение индекса ───────────────────────────────────────────────────────

function buildQuestionIndex(results) {
  allQuestions = [];

  const catMap = new Map();
  manifest.categories.forEach(cat => {
    const topicMap = new Map();
    cat.topics.forEach(t => {
      const subtopicNames = (t.subtopics || []).map(s => s.name);
      topicMap.set(t.name, {
        direct: new Map(),
        subtopics: new Map(subtopicNames.map(n => [n, new Map()]))
      });
    });
    catMap.set(cat.name, topicMap);
  });

  results.forEach(({ categoryName, topicName, subtopicName, fileName, data }) => {
    const topicData = catMap.get(categoryName)?.get(topicName);
    if (!topicData) return;

    const targetMap = subtopicName
      ? topicData.subtopics.get(subtopicName)
      : topicData.direct;

    if (!targetMap) return;

    const subcatTitle = fileName
      .split('/')
      .pop()
      .replace(/\.json$/, '')
      .replace(/^\d+_/, '')
      .replace(/_/g, ' ');

    (data.questions || []).forEach(q => {
      const entry = {
        globalIdx: allQuestions.length,
        current:  q.current  || q,
        previous: q.previous || null,
        next:     q.next     || null,
        categoryName,
        topicName,
        subtopicName,
        subcatTitle
      };
      allQuestions.push(entry);

      if (!targetMap.has(subcatTitle)) targetMap.set(subcatTitle, []);
      targetMap.get(subcatTitle).push(entry);
    });
  });

  categoryTree = [];
  manifest.categories.forEach(cat => {
    const topicMap = catMap.get(cat.name);
    const topics = [];
    cat.topics.forEach(t => {
      const topicData = topicMap.get(t.name);
      const subcategories = [];
      topicData.direct.forEach((questions, name) => subcategories.push({ name, questions }));
      const subtopics = [];
      topicData.subtopics.forEach((subcatMap, subName) => {
        const subs = [];
        subcatMap.forEach((questions, name) => subs.push({ name, questions }));
        if (subs.length > 0) subtopics.push({ name: subName, subcategories: subs });
      });
      topics.push({ name: t.name, subcategories, subtopics });
    });
    categoryTree.push({ name: cat.name, topics });
  });
}

// ─── Сайдбар (DocumentFragment — один reflow) ────────────────────────────────

function countQuestions(topic) {
  let total = topic.subcategories.reduce((s, sc) => s + sc.questions.length, 0);
  if (topic.subtopics) {
    topic.subtopics.forEach(st => {
      total += st.subcategories.reduce((s, sc) => s + sc.questions.length, 0);
    });
  }
  return total;
}

function buildSubcatGroup(subcat) {
  const subGroup = document.createElement('div');
  subGroup.className = 'cat-group';
  subGroup.innerHTML = `<div class="subcat-header">
    <span class="arrow">&#9654;&#xFE0E;</span>
    <span class="subcat-title">${subcat.name}</span>
    <span class="cat-count">${subcat.questions.length}</span>
  </div>`;
  const subChildren = document.createElement('div');
  subChildren.className = 'subcat-children';

  // Собираем вопросы через фрагмент
  const frag = document.createDocumentFragment();
  subcat.questions.forEach(entry => frag.appendChild(createSidebarQuestion(entry)));
  subChildren.appendChild(frag);

  subGroup.appendChild(subChildren);
  subGroup.querySelector('.subcat-header').addEventListener('click', () => {
    subGroup.querySelector('.arrow').classList.toggle('open');
    subChildren.classList.toggle('open');
  });
  return subGroup;
}

function buildSidebar() {
  const tree = DOM['sidebar-tree'];
  const rootFrag = document.createDocumentFragment(); // один reflow для всего дерева

  categoryTree.forEach(cat => {
    const catTotalQ = cat.topics.reduce((s, t) => s + countQuestions(t), 0);
    const catGroup = document.createElement('div');
    catGroup.className = 'main-cat-group';
    catGroup.innerHTML = `<div class="main-cat-header">
      <span class="arrow">&#9654;&#xFE0E;</span>
      <span class="main-cat-title">${cat.name}</span>
      <span class="cat-count">${catTotalQ}</span>
    </div>`;
    const catChildren = document.createElement('div');
    catChildren.className = 'main-cat-children';

    cat.topics.forEach(topic => {
      const topicTotalQ = countQuestions(topic);
      const topicGroup = document.createElement('div');
      topicGroup.className = 'cat-group';
      topicGroup.innerHTML = `<div class="cat-header">
        <span class="arrow">&#9654;&#xFE0E;</span>
        <span class="cat-title">${topic.name}</span>
        <span class="cat-count">${topicTotalQ}</span>
      </div>`;
      const topicChildren = document.createElement('div');
      topicChildren.className = 'cat-children';

      topic.subcategories.forEach(subcat => topicChildren.appendChild(buildSubcatGroup(subcat)));

      if (topic.subtopics) {
        topic.subtopics.forEach(st => {
          const stTotalQ = st.subcategories.reduce((s, sc) => s + sc.questions.length, 0);
          const stGroup = document.createElement('div');
          stGroup.className = 'subtopic-group';
          stGroup.innerHTML = `<div class="subtopic-header">
            <span class="arrow">&#9654;&#xFE0E;</span>
            <span class="subtopic-title">${st.name}</span>
            <span class="cat-count">${stTotalQ}</span>
          </div>`;
          const stChildren = document.createElement('div');
          stChildren.className = 'subtopic-children';
          st.subcategories.forEach(subcat => stChildren.appendChild(buildSubcatGroup(subcat)));
          stGroup.appendChild(stChildren);
          stGroup.querySelector('.subtopic-header').addEventListener('click', () => {
            stGroup.querySelector('.arrow').classList.toggle('open');
            stChildren.classList.toggle('open');
          });
          topicChildren.appendChild(stGroup);
        });
      }

      topicGroup.appendChild(topicChildren);
      topicGroup.querySelector('.cat-header').addEventListener('click', () => {
        topicGroup.querySelector('.arrow').classList.toggle('open');
        topicChildren.classList.toggle('open');
      });
      catChildren.appendChild(topicGroup);
    });

    catGroup.appendChild(catChildren);
    catGroup.querySelector('.main-cat-header').addEventListener('click', () => {
      catGroup.querySelector('.arrow').classList.toggle('open');
      catChildren.classList.toggle('open');
    });

    rootFrag.appendChild(catGroup);
  });

  tree.innerHTML = '';
  tree.appendChild(rootFrag); // единственный reflow
}

function createSidebarQuestion(entry) {
  const div = document.createElement('div');
  div.className = 'sidebar-question';
  div.dataset.idx = entry.globalIdx;
  div.dataset.qid = entry.current.id;

  const gradeLabels = { trainee: 'Легкий', junior: 'Junior', middle: 'Middle', senior: 'Senior' };
  const grade = entry.current.grade;
  const gradeHtml = grade
    ? `<span class="sq-grade sq-grade-${grade}">${gradeLabels[grade] || grade}</span>`
    : '';
  const popularHtml = entry.current.isPopular ? `<span class="sq-popular">★ популярный</span>` : '';

  if (entry.current.isPopular) div.dataset.popular = '1';

  const status = getStatus(entry.current.id);
  const dotClass = status ? `status-${status}` : '';
  const metaHtml = (gradeHtml || popularHtml) ? `<span class="sq-meta">${gradeHtml}${popularHtml}</span>` : '';

  div.innerHTML = `<span class="sq-dot ${dotClass}"></span><span class="sq-info"><span class="sq-title">${entry.current.title}</span>${metaHtml}</span>`;

  div.addEventListener('click', () => {
    showQuestion(entry.globalIdx);
    if (window.innerWidth <= 768) closeDrawer();
  });

  return div;
}

function updateSidebarDot(questionId) {
  const status = getStatus(questionId);
  document.querySelectorAll(`.sidebar-question[data-qid="${questionId}"] .sq-dot`).forEach(dot => {
    dot.classList.remove('status-learned', 'status-repeat');
    if (status) dot.classList.add(`status-${status}`);
  });
}

// ─── Фильтрация (через requestAnimationFrame) ─────────────────────────────────

function applyFilter() {
  requestAnimationFrame(() => {
    document.querySelectorAll('.sidebar-question').forEach(el => {
      const status = getStatus(Number(el.dataset.qid));
      let show = true;
      if      (currentFilter === 'learned') show = status === 'learned';
      else if (currentFilter === 'repeat')  show = status === 'repeat';
      else if (currentFilter === 'none')    show = !status;
      else if (currentFilter === 'popular') show = el.dataset.popular === '1';
      el.style.display = show ? '' : 'none';
    });

    document.querySelectorAll('.subcat-children').forEach(container => {
      const hasVisible = container.querySelector('.sidebar-question:not([style*="display: none"])');
      const subGroup = container.closest('.cat-group');
      if (subGroup?.querySelector('.subcat-header')) {
        subGroup.style.display = hasVisible ? '' : 'none';
      }
    });

    document.querySelectorAll('.subtopic-group').forEach(stGroup => {
      const stChildren = stGroup.querySelector('.subtopic-children');
      if (!stChildren) return;
      const hasVisible = stChildren.querySelector('.cat-group:not([style*="display: none"])');
      stGroup.style.display = hasVisible ? '' : 'none';
    });

    document.querySelectorAll('.cat-children').forEach(container => {
      const topicGroup = container.closest('.cat-group');
      if (!topicGroup?.querySelector('.cat-header')) return;
      const hasVisibleSub = container.querySelector('.cat-group:not([style*="display: none"]), .subtopic-group:not([style*="display: none"])');
      topicGroup.style.display = hasVisibleSub ? '' : 'none';
    });

    document.querySelectorAll('.main-cat-group').forEach(mainGroup => {
      const children = mainGroup.querySelector('.main-cat-children');
      if (!children) return;
      const hasVisibleTopic = children.querySelector('.cat-group:not([style*="display: none"])');
      mainGroup.style.display = hasVisibleTopic ? '' : 'none';
    });
  });
}

// ─── Мемоизация HTML объяснений ───────────────────────────────────────────────

const explanationCache = new Map();
const subtitleCache = new Map();

function getExplanationHtml(entry) {
  const id = entry.current.id;
  if (explanationCache.has(id)) return explanationCache.get(id);
  let html = '';
  if (entry.current.explanation) {
    try { html = extractTextFromJSON(JSON.parse(entry.current.explanation)); }
    catch(e) { html = entry.current.explanation; }
  }
  explanationCache.set(id, html);
  return html;
}

function getSubtitleText(entry) {
  const id = entry.current.id;
  if (subtitleCache.has(id)) return subtitleCache.get(id);
  let text = '';
  if (entry.current.text) {
    try { text = plainTextFromJSON(JSON.parse(entry.current.text)); }
    catch(e) { text = entry.current.text; }
  }
  subtitleCache.set(id, text);
  return text;
}

// Открытие сайдбара при обновлении страницы
function expandSidebarToActive(globalIdx) {
  const el = document.querySelector(`.sidebar-question[data-idx="${globalIdx}"]`);
  if (!el) return;

  let parent = el.parentElement;

  while (parent) {
    // раскрываем контейнеры
    if (parent.classList.contains('subcat-children') ||
      parent.classList.contains('cat-children') ||
      parent.classList.contains('subtopic-children') ||
      parent.classList.contains('main-cat-children')) {
      parent.classList.add('open');
    }

    // крутим стрелки
    const group =
      parent.closest('.cat-group') ||
      parent.closest('.subtopic-group') ||
      parent.closest('.main-cat-group');

    if (group) {
      const arrow = group.querySelector('.arrow');
      if (arrow) arrow.classList.add('open');
    }

    parent = parent.parentElement;
  }
}

// ─── Отображение вопроса ──────────────────────────────────────────────────────

const gradeLabels = { trainee: 'Легкий', junior: 'Junior', middle: 'Middle', senior: 'Senior' };

function showQuestion(globalIdx) {
  const entry = allQuestions[globalIdx];
  if (!entry) return;

  localStorage.setItem('active_question_idx', globalIdx);

  activeQuestion = entry;

  DOM['welcome-screen'].style.display = 'none';
  DOM['question-view'].style.display = 'block';

  // Breadcrumb
  let bcHtml = `<span>${entry.categoryName}</span><span class="bc-sep">&gt;</span><span>${entry.topicName}</span>`;
  if (entry.subtopicName) bcHtml += `<span class="bc-sep">&gt;</span><span>${entry.subtopicName}</span>`;
  if (entry.subcatTitle !== entry.topicName && entry.subcatTitle !== entry.subtopicName) {
    bcHtml += `<span class="bc-sep">&gt;</span><span>${entry.subcatTitle}</span>`;
  }
  DOM['breadcrumb'].innerHTML = bcHtml;

  // Бейджи
  let badgesHtml = '';
  if (entry.current.grade)     badgesHtml += `<span class="grade-badge grade-${entry.current.grade}">${gradeLabels[entry.current.grade] || entry.current.grade}</span>`;
  if (entry.current.isPopular) badgesHtml += `<span class="grade-badge popular-badge">★ популярный</span>`;
  DOM['question-grade'].innerHTML = badgesHtml;

  DOM['question-title'].textContent    = entry.current.title;
  DOM['question-subtitle'].textContent = getSubtitleText(entry); // мемоизовано

  updateStatusButtonsUI(entry.current.id);

  // Объяснение — сбрасываем состояние
  const expandBtn = DOM['expand-btn'];
  const explanationEl = DOM['explanation-content'];
  expandBtn.classList.remove('open');
  explanationEl.classList.remove('open');
  expandBtn.innerHTML = 'Развернуть <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

  const html = getExplanationHtml(entry); // мемоизовано
  if (html) {
    explanationEl.innerHTML = html;
    DOM['explanation-section'].style.display = '';
  } else {
    DOM['explanation-section'].style.display = 'none';
  }

  setupNavButtons(entry);

  // Активный элемент в сайдбаре
  document.querySelectorAll('.sidebar-question').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.sidebar-question[data-idx="${globalIdx}"]`);

  expandSidebarToActive(globalIdx);

  if (activeEl) {
    activeEl.classList.add('active');
    if (activeEl.offsetParent) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Подсветка кода только если объяснение открыто
  setTimeout(() => {
    DOM['explanation-content'].querySelectorAll('pre code').forEach(block => {
      hljs.highlightElement(block);
    });
  }, 50);

  DOM['main-content'].scrollTo(0, 0);
}

// ─── Статус-кнопки ────────────────────────────────────────────────────────────

function setupStatusButtons() {
  const handle = (status) => {
    if (!activeQuestion) return;
    setStatus(activeQuestion.current.id, status);
    updateStatusButtonsUI(activeQuestion.current.id);
    updateSidebarDot(activeQuestion.current.id);
  };

  ['status-repeat', 'status-repeat-bottom'].forEach(id =>
    DOM[id].addEventListener('click', () => handle('repeat'))
  );
  ['status-learned', 'status-learned-bottom'].forEach(id =>
    DOM[id].addEventListener('click', () => handle('learned'))
  );
}

function updateStatusButtonsUI(questionId) {
  const status = getStatus(questionId);
  ['repeat', 'learned'].forEach(s => {
    [`status-${s}`, `status-${s}-bottom`].forEach(id => {
      DOM[id]?.classList.toggle('active', status === s);
    });
  });
}

// ─── Навигация ────────────────────────────────────────────────────────────────

// Индекс по id для быстрого поиска prev/next (O(1) вместо O(n))
const questionById = new Map();

function buildQuestionById() {
  allQuestions.forEach(entry => questionById.set(entry.current.id, entry));
}

function setupNavButtons(entry) {
  const btnPrev = DOM['btn-prev'];
  const btnNext = DOM['btn-next'];

  let prevGlobal = entry.globalIdx > 0 ? entry.globalIdx - 1 : null;
  let nextGlobal = entry.globalIdx < allQuestions.length - 1 ? entry.globalIdx + 1 : null;

  if (entry.previous) {
    const found = questionById.get(entry.previous.id);
    if (found) prevGlobal = found.globalIdx;
  }
  if (entry.next) {
    const found = questionById.get(entry.next.id);
    if (found) nextGlobal = found.globalIdx;
  }

  btnPrev.disabled = prevGlobal == null;
  btnNext.disabled = nextGlobal == null;

  btnPrev.onclick = () => { if (prevGlobal != null) showQuestion(prevGlobal); };
  btnNext.onclick = () => { if (nextGlobal != null) showQuestion(nextGlobal); };
}

// ─── Развернуть/свернуть объяснение ──────────────────────────────────────────

function setupExpandBtn() {
  const btn     = DOM['expand-btn'];
  const content = DOM['explanation-content'];
  const svgDown = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

  DOM['explanation-header'].addEventListener('click', () => {
    const isOpen = content.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.innerHTML = (isOpen ? 'Свернуть ' : 'Развернуть ') + svgDown;

    if (isOpen) {
      setTimeout(() => {
        content.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
      }, 50);
    }
  });
}

// ─── Поиск (с дебаунсом) ─────────────────────────────────────────────────────

function debounce(fn, delay = 350) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function setupSearch() {
  const input   = DOM['search-input'];
  const results = DOM['search-results'];

  const handleInput = debounce(() => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      results.classList.remove('active');
      results.innerHTML = '';
      return;
    }

    const matches = allQuestions.filter(e =>
      e.current.title.toLowerCase().includes(query)
    ).slice(0, 20);

    if (matches.length === 0) {
      results.innerHTML = '<div class="search-result-item">Ничего не найдено</div>';
      results.classList.add('active');
      return;
    }

    results.innerHTML = matches.map(e =>
      `<div class="search-result-item" data-idx="${e.globalIdx}">
        <div>${highlightMatch(e.current.title, query)}</div>
        <div class="sr-cat">${e.categoryName} &gt; ${e.topicName} &gt; ${e.subcatTitle}</div>
      </div>`
    ).join('');

    results.classList.add('active');

    results.querySelectorAll('.search-result-item[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        showQuestion(parseInt(el.dataset.idx));
        input.value = '';
        results.classList.remove('active');
      });
    });
  }, 200);

  input.addEventListener('input', handleInput);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar')) results.classList.remove('active');
  });
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    `<strong style="color:#f6f6f6">${escapeHtml(text.slice(idx, idx + query.length))}</strong>` +
    escapeHtml(text.slice(idx + query.length));
}

// ─── Компактный вид и фильтр ─────────────────────────────────────────────────

function setupCompactToggle() {
  DOM['compact-toggle'].addEventListener('click', () => {
    DOM['compact-toggle'].classList.toggle('active');
    DOM['sidebar'].classList.toggle('compact');
  });
}

function setupFilter() {
  DOM['sidebar-filter'].addEventListener('change', () => {
    currentFilter = DOM['sidebar-filter'].value;
    applyFilter();
  });
}

// ─── Парсинг JSON → HTML (не тронуто) ────────────────────────────────────────

function extractTextFromJSON(jsonObj) {
  if (!jsonObj) return '';
  let result = '';
  if (jsonObj.type === 'doc' && jsonObj.content) {
    jsonObj.content.forEach(block => { result += processBlock(block); });
  }
  return result;
}

function plainTextFromJSON(jsonObj) {
  if (!jsonObj) return '';
  let result = '';
  if (jsonObj.type === 'doc' && jsonObj.content) {
    jsonObj.content.forEach(block => { result += plainBlock(block); });
  }
  return result.trim();
}

function plainBlock(block) {
  if (!block) return '';
  let r = '';
  if (block.content) {
    block.content.forEach(item => {
      if (item.type === 'text') r += item.text || '';
      else if (item.content) r += plainBlock(item);
    });
  }
  return r;
}

function processBlock(block, inTableCell = false) {
  if (!block) return '';
  let result = '';

  switch(block.type) {
    case 'paragraph':
      if (block.content) {
        block.content.forEach(item => {
          if (item.type === 'text') {
            let text = item.text || '';
            if (item.marks) {
              item.marks.forEach(mark => {
                if (mark.type === 'bold')   text = `<strong>${text}</strong>`;
                if (mark.type === 'code')   text = `<code class="inline-code">${escapeHtml(text)}</code>`;
                if (mark.type === 'italic') text = `<em>${text}</em>`;
              });
            }
            result += text;
          } else if (item.type === 'hardBreak') {
            result += '<br>';
          }
        });
      }
      result = inTableCell ? result : `<p>${result}</p>`;
      break;

    case 'heading': {
      const level = block.attrs?.level || 1;
      const headingText = block.content?.map(c => c.text).join('') || '';
      result += `<h${Math.min(level + 2, 6)}>${headingText}</h${Math.min(level + 2, 6)}>`;
      break;
    }

    case 'codeBlock': {
      const lang = block.attrs?.language || 'javascript';
      const code = block.content?.map(c => c.text).join('') || '';
      result += `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
      break;
    }

    case 'blockquote':
      result += '<blockquote>';
      if (block.content) block.content.forEach(item => { result += processBlock(item); });
      result += '</blockquote>';
      break;

    case 'horizontalRule':
      result += '<hr>';
      break;

    case 'table':
      result += processTable(block);
      break;

    case 'bulletList':
    case 'orderedList': {
      const tag = block.type === 'bulletList' ? 'ul' : 'ol';
      result += `<${tag}>`;
      if (block.content) {
        block.content.forEach(item => {
          if (item.type === 'listItem') {
            result += '<li>';
            if (item.content) item.content.forEach(subItem => { result += processBlock(subItem); });
            result += '</li>';
          }
        });
      }
      result += `</${tag}>`;
      break;
    }
  }

  return result;
}

function processTable(tableBlock) {
  let result = '<table>';
  if (tableBlock.content) {
    tableBlock.content.forEach((row, rowIndex) => {
      if (row.type === 'tableRow' && row.content) {
        result += '<tr>';
        row.content.forEach(cell => {
          const isHeader = rowIndex === 0 && (cell.type === 'tableHeader' || cell.type === 'tableCell');
          const cellTag = isHeader ? 'th' : 'td';
          let cellText = '';
          if (cell.content) cell.content.forEach(item => { cellText += processBlock(item, true); });
          result += `<${cellTag}>${cellText}</${cellTag}>`;
        });
        result += '</tr>';
      }
    });
  }
  return result + '</table>';
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ─── Mobile Drawer ────────────────────────────────────────────────────────────

function closeDrawer() {
  DOM['sidebar'].classList.remove('open');
  DOM['drawer-overlay'].classList.remove('active');
  document.body.style.overflow = '';
}

function openDrawer() {
  DOM['sidebar'].classList.add('open');
  DOM['drawer-overlay'].classList.add('active');
  document.body.style.overflow = 'hidden';
}

function setupMobileDrawer() {
  if (!DOM['mobile-drawer-toggle'] || !DOM['drawer-close'] || !DOM['drawer-overlay']) return;

  DOM['mobile-drawer-toggle'].addEventListener('click', openDrawer);
  DOM['drawer-close'].addEventListener('click', closeDrawer);
  DOM['drawer-overlay'].addEventListener('click', closeDrawer);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeDrawer();
  });
}

// ─── Scroll to Top ────────────────────────────────────────────────────────────

function setupScrollToTop() {
  const scrollBtn    = DOM['scroll-to-top'];
  const mainContent  = DOM['main-content'];
  if (!scrollBtn || !mainContent) return;

  mainContent.addEventListener('scroll', () => {
    scrollBtn.classList.toggle('visible', mainContent.scrollTop > 300);
  });

  scrollBtn.addEventListener('click', () => {
    mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  });
}