const cards = Array.from(document.querySelectorAll('.card'));
const sections = Array.from(document.querySelectorAll('[data-category-section]'));
const filters = Array.from(document.querySelectorAll('[data-filter]'));
const jumps = Array.from(document.querySelectorAll('[data-jump]'));
const search = document.querySelector('#tool-search');
const status = document.querySelector('#filter-status');
const empty = document.querySelector('#empty-state');
const clear = document.querySelector('#clear-filters');

const labels = {
  all: 'tools',
  video: 'video tools',
  text: 'text tools',
  images: 'image tools',
};

let active = 'all';

function updateCounts() {
  filters.forEach((button) => {
    const category = button.dataset.filter;
    const count = category === 'all'
      ? cards.length
      : cards.filter((card) => card.dataset.category === category).length;
    const badge = button.querySelector('span');
    if (badge) badge.textContent = count;
  });
}

function haystack(card) {
  return `${card.textContent} ${card.dataset.keywords || ''}`.toLowerCase();
}

function applyFilter() {
  const query = search.value.trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let visible = 0;

  cards.forEach((card) => {
    const inCategory = active === 'all' || card.dataset.category === active;
    const text = haystack(card);
    const matches = terms.every((term) => text.includes(term));
    const show = inCategory && matches;
    card.hidden = !show;
    if (show) visible += 1;
  });

  sections.forEach((section) => {
    const hasVisible = Array.from(section.querySelectorAll('.card')).some((card) => !card.hidden);
    section.hidden = !hasVisible;
  });

  empty.hidden = visible !== 0;

  if (terms.length) {
    status.textContent = `${visible} ${visible === 1 ? 'tool matches' : 'tools match'} “${query}”`;
    return;
  }

  if (active === 'all') {
    status.textContent = `Showing all ${cards.length} tools`;
    return;
  }

  status.textContent = `Showing ${visible} ${labels[active]}`;
}

function setFilter(category, options = {}) {
  active = category;

  filters.forEach((button) => {
    const isActive = button.dataset.filter === category;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  applyFilter();

  if (options.updateHash !== false) {
    try {
      const next = category === 'all' ? location.pathname + location.search : `#${category}`;
      history.replaceState(null, '', next);
    } catch (error) {
      status.dataset.hashSync = 'unavailable';
    }
  }

  if (options.scroll) {
    const target = document.getElementById(category);
    if (target) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }
}

filters.forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});

jumps.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const category = link.dataset.jump;
    setFilter(category, { scroll: true });
  });
});

search.addEventListener('input', applyFilter);

search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && search.value) {
    search.value = '';
    applyFilter();
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable;

  if (event.key === '/' && !typing) {
    event.preventDefault();
    search.focus();
  }
});

if (clear) {
  clear.addEventListener('click', () => {
    search.value = '';
    setFilter('all');
    search.focus();
  });
}

window.addEventListener('hashchange', () => {
  const category = location.hash.replace('#', '');
  if (['video', 'text', 'images'].includes(category)) {
    setFilter(category, { updateHash: false });
    return;
  }
  if (!category) setFilter('all', { updateHash: false });
});

updateCounts();

const initial = location.hash.replace('#', '');
const initialCategory = ['video', 'text', 'images'].includes(initial) ? initial : 'all';
setFilter(initialCategory, { updateHash: false });
