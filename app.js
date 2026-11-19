const DASHBOARD_PASSWORD = 'Zrhfcbdfz,kjylbyrf';
const USE_LOCAL_PROXY = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const SHEETS = USE_LOCAL_PROXY
  ? { exits: '/api/exits', metrics: '/api/metrics' }
  : {
      exits: 'https://docs.google.com/spreadsheets/d/10rIIALkEF2CS4D4QbprXzQyXbOdwywFiw1-ifKVTg5Y/export?format=csv&gid=0',
      metrics: 'https://docs.google.com/spreadsheets/d/18ByGRXv1Cins4U0eEbC0lvViJ5TlH0epCU_lcAHb55c/export?format=csv&gid=0',
    };
const CACHE_KEY = 'smartway-turnover-dashboard-cache-v2';

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const TEAMS = [
  {
    name: 'Авиа · Нижний Новгород',
    departmentNames: ['Отдел Авиа и ЖД'],
    city: 'Нижний Новгород',
    metricSections: ['Авиа Нижний Новгород'],
    note: 'Для города Нижний Новгород',
  },
  {
    name: 'Отели Премиум',
    departmentNames: ['Премиум'],
    metricSections: ['ПРЕМИУМ'],
  },
  {
    name: 'Отдел по организации деловых мероприятий · MICE',
    departmentNames: ['Отдел по организации деловых мероприятий'],
    city: 'Нижний Новгород',
    cityLabel: 'Нижний Новгород',
    metricSections: ['Организация мероприятий (Нижний)'],
  },
  {
    name: 'Отдел холодных продаж · MICE',
    departmentNames: ['Отдел продаж корпоративных мероприятий', 'Отдел холодных продаж MICE'],
    city: 'Нижний Новгород',
    cityLabel: 'Нижний Новгород',
    metricSections: ['Майс продажи (Нижний)']
  },
  {
    name: 'Офлайн',
    departmentNames: ['Офлайн', 'Оффлайн', 'Отдел офлайн', 'Отдел оффлайн'],
    metricSections: ['Офлайн'],
  },
];

const elements = {
  grid: document.getElementById('department-grid'),
  overview: document.getElementById('department-overview'),
  detail: document.getElementById('department-detail'),
  detailTitle: document.getElementById('detail-title'),
  detailLocation: document.getElementById('detail-location'),
  detailRateCard: document.getElementById('detail-rate-card'),
  detailPanel: document.getElementById('detail-panel'),
  backButton: document.getElementById('back-to-departments'),
  groupsTab: document.getElementById('groups-tab'),
  chartsTab: document.getElementById('charts-tab'),
  yearSelect: document.getElementById('year-select'),
  totalExits: document.getElementById('total-exits'),
  teamCount: document.getElementById('team-count'),
  periodCaption: document.getElementById('period-caption'),
  syncLabel: document.getElementById('sync-label'),
  refreshButton: document.getElementById('refresh-button'),
  toast: document.getElementById('toast'),
  statusDot: document.querySelector('.live-dot'),
};

let state = { exits: null, metrics: null, year: new Date().getFullYear() };
let selectedTeamIndex = null;
let activeDetailTab = 'groups';
let toastTimer;

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];
    if (quoted) {
      if (character === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  return rows;
}

async function getSheet(url, forceRefresh = false) {
  if (location.protocol === 'file:') {
    throw new Error('Запустите run-dashboard.bat из папки проекта — он откроет дашборд с доступом к Google Таблицам.');
  }
  const separator = url.includes('?') ? '&' : '?';
  const requestUrl = forceRefresh ? `${url}${separator}_=${Date.now()}` : url;
  const response = await fetch(requestUrl, { cache: forceRefresh ? 'no-store' : 'default' });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `Не удалось получить данные (код ${response.status})`);
  }
  const text = await response.text();
  const normalizedResponse = text.trimStart().toLowerCase();
  if (normalizedResponse.startsWith('<!doctype html') || normalizedResponse.startsWith('<html')) {
    throw new Error('Таблица недоступна для чтения. Проверьте доступ «Все, у кого есть ссылка».');
  }
  return parseCSV(text);
}

function normalize(value) {
  return String(value ?? '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[()·.,:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value) {
  const source = String(value ?? '').trim();
  if (!source) return null;
  let match = source.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    return null;
  }
  match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseNumber(value) {
  const source = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!source || source.startsWith('#') || source === '-') return null;
  const number = Number(source.replace('%', ''));
  return Number.isFinite(number) ? number : null;
}

function getYearData() {
  const years = new Set();
  for (const exit of state.exits ?? []) if (exit.date) years.add(exit.date.getFullYear());
  for (const metric of state.metrics ?? []) if (metric.year) years.add(metric.year);
  return [...years].sort((a, b) => b - a);
}

function buildExitRows(rows) {
  return rows.slice(1).map((cells) => {
    const date = parseDate(cells[5]);
    const initiator = (cells[11] ?? '').trim();
    const employeeReason = (cells[13] ?? '').trim();
    const companyReason = (cells[14] ?? '').trim();
    const reason = normalize(initiator) === 'компания'
      ? companyReason || employeeReason
      : employeeReason || companyReason;
    return {
      date,
      tenure: parseNumber(cells[6]),
      department: cells[7] ?? '',
      manager: (cells[9] ?? '').trim(),
      city: cells[10] ?? '',
      initiator,
      reason: reason || 'Причина не указана',
    };
  }).filter((exit) => exit.date && exit.department);
}

function restoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!cached) return false;
    if (Array.isArray(cached.exits)) state.exits = cached.exits.map((exit) => ({ ...exit, date: new Date(exit.date) }));
    if (Array.isArray(cached.metrics)) state.metrics = cached.metrics;
    if (!state.exits && !state.metrics) return false;
    elements.syncLabel.textContent = 'Показываем сохранённые данные';
    render();
    return true;
  } catch {
    return false;
  }
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      exits: state.exits?.map((exit) => ({ ...exit, date: exit.date.toISOString() })) ?? null,
      metrics: state.metrics,
      savedAt: Date.now(),
    }));
  } catch {
    // Storage can be disabled or full; live data still works for this page.
  }
}

function buildMetricRows(rows) {
  const metrics = [];
  const nonSectionLabels = new Set([
    'всего', 'приемы', 'увольнения', 'офферы', 'отказы',
    'по инициативе работника', 'по инициативе компании',
    'всего на ис', 'по инициативе компании на ис', 'по инициативе работника на ис',
  ]);
  let activeSection = '';
  for (const cells of rows) {
    const emptyPrefix = cells.slice(0, 6).every((cell) => !(cell ?? '').trim());
    if (emptyPrefix) {
      const label = cells.slice(6, 12).map((cell) => (cell ?? '').trim()).find((candidate) => {
        if (!candidate || /^\d+(?:[,.]\d+)?$/.test(candidate) || /^202\d$/.test(candidate)) return false;
        return !nonSectionLabels.has(normalize(candidate));
      });
      if (label) activeSection = label;
    }

    const periodText = (cells[2] ?? '').trim();
    const monthlyPeriod = periodText.match(/^(\d{1,2})\.(\d{4})$/);
    if (monthlyPeriod) {
      metrics.push({
        section: activeSection,
        year: Number(monthlyPeriod[2]),
        month: Number(monthlyPeriod[1]) - 1,
        period: 'month',
        rate: parseNumber(cells[15]),
        voluntaryRate: parseNumber(cells[16]),
      });
      continue;
    }

    const year = Number(periodText);
    if (year >= 2000 && year <= 2100) {
      metrics.push({
        section: activeSection,
        year,
        month: null,
        period: 'year',
        rate: parseNumber(cells[15]),
        voluntaryRate: parseNumber(cells[16]),
      });
    }
  }
  return metrics;
}

function teamExitRecords(team, year) {
  const departments = new Set(team.departmentNames.map(normalize));
  const city = team.city ? normalize(team.city) : null;
  return (state.exits ?? []).filter((exit) => (
    departments.has(normalize(exit.department))
    && (!city || normalize(exit.city) === city)
    && exit.date.getFullYear() === year
  ));
}

function teamExitData(team, year) {
  const records = teamExitRecords(team, year);
  const matchedAnywhere = (state.exits ?? []).some((exit) => (
    team.departmentNames.map(normalize).includes(normalize(exit.department))
    && (!team.city || normalize(exit.city) === normalize(team.city))
  ));
  const counts = Array(12).fill(0);
  for (const exit of records) counts[exit.date.getMonth()] += 1;
  return { counts, hasMatchingDepartment: matchedAnywhere };
}

function teamExits(team, year) {
  return teamExitData(team, year).counts;
}

function matchingMetrics(team, year) {
  const accepted = new Set(team.metricSections.map(normalize));
  return (state.metrics ?? []).filter((metric) => metric.year === year && accepted.has(normalize(metric.section)));
}

function teamRate(team, year) {
  if (!team.metricSections.length) return null;
  const row = matchingMetrics(team, year).find((metric) => metric.period === 'year');
  return row?.rate ?? null;
}

function teamMonthlyRates(team, year) {
  return matchingMetrics(team, year).filter((metric) => metric.period === 'month');
}

function formatRate(value) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}%`;
}

function renderTeam(team, index, year) {
  const { counts: monthlyCounts, hasMatchingDepartment } = teamExitData(team, year);
  const total = monthlyCounts.reduce((sum, count) => sum + count, 0);
  const rate = teamRate(team, year);
  const rows = MONTHS.map((month, monthIndex) => ({ month, count: monthlyCounts[monthIndex], monthIndex }))
    .filter((month) => month.count > 0)
    .map(({ month, count }) => `
      <tr><td>${month}</td><td><span class="month-count">${count}</span></td></tr>`)
    .join('');
  const missingRate = rate === null;
  const rateHint = missingRate
    ? (team.missingMetricNote ?? `Показатель не найден в строке ${year} этой таблицы`)
    : '<span class="rate-pill is-normal">значение из столбца P</span>';
  return `
    <article class="department-card" role="button" tabindex="0" data-team-index="${index}" aria-label="Открыть детали отдела: ${escapeHtml(team.name)}">
      <div class="card-topline"><h3 class="card-name">${team.name}</h3><span class="card-index">${String(index + 1).padStart(2, '0')}</span></div>
      ${team.cityLabel ? `<span class="card-city-label">г. ${team.cityLabel}</span>` : ''}
      <span class="turnover-label">ТЕКУЧЕСТЬ ОТДЕЛА</span>
      <div class="turnover-line"><span class="turnover-value${missingRate ? ' is-missing' : ''}">${formatRate(rate)}</span>${missingRate ? '' : '<span class="turnover-unit">за год</span>'}</div>
      <div class="rate-hint">${rateHint}</div>
      <div class="card-rule"></div>
      <div class="exits-heading"><span class="exits-label">Увольнения по месяцам</span><span class="exits-total">${hasMatchingDepartment ? `${total} чел.` : 'нет данных'}</span></div>
      ${rows ? `<table class="month-table" aria-label="Увольнения ${escapeHtml(team.name)} за ${year}"><tbody>${rows}</tbody></table>` : `<div class="empty-months">${hasMatchingDepartment ? `Нет увольнений за ${year} год` : state.exits ? 'Название отдела не найдено в таблице увольнений' : 'Нет данных из таблицы увольнений'}</div>`}
      <div class="card-footer"><span>${hasMatchingDepartment ? `Всего за ${year} год` : 'Проверьте источник данных'}</span><span class="card-open-hint">Открыть разрез ↗</span></div>
    </article>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const TENURE_BANDS = [
  'До 3 месяцев',
  'От 3 месяцев до 6 месяцев',
  'От 6 месяцев до 12 месяцев',
  'От 1 года до 2 лет',
  'Более 2 лет',
  'Стаж не указан',
];

function tenureBand(value) {
  if (value === null || value === undefined) return 'Стаж не указан';
  if (value < 0.25) return TENURE_BANDS[0];
  if (value < 0.5) return TENURE_BANDS[1];
  if (value < 1) return TENURE_BANDS[2];
  if (value <= 2) return TENURE_BANDS[3];
  return TENURE_BANDS[4];
}

function groupExitRecords(records) {
  const groups = new Map();
  for (const exit of records) {
    const manager = exit.manager || 'РГ не указан';
    if (!groups.has(manager)) groups.set(manager, []);
    groups.get(manager).push(exit);
  }
  return [...groups.entries()]
    .map(([manager, exits]) => ({ manager, exits }))
    .sort((left, right) => right.exits.length - left.exits.length || left.manager.localeCompare(right.manager, 'ru'));
}

function renderGroupDetails(group) {
  const months = Array.from({ length: 12 }, () => []);
  for (const exit of group.exits) months[exit.date.getMonth()].push(exit);
  const rows = months.map((exits, month) => {
    if (!exits.length) return '';
    const tenureCounts = new Map();
    const reasonCounts = new Map();
    for (const exit of exits) {
      const band = tenureBand(exit.tenure);
      tenureCounts.set(band, (tenureCounts.get(band) ?? 0) + 1);
      reasonCounts.set(exit.reason, (reasonCounts.get(exit.reason) ?? 0) + 1);
    }
    const tenure = TENURE_BANDS.filter((band) => tenureCounts.has(band))
      .map((band) => `<span class="tenure-chip">${band} <b>${tenureCounts.get(band)}</b></span>`)
      .join('');
    const reasons = [...reasonCounts.entries()]
      .map(([reason, count]) => `<span class="reason-chip">${escapeHtml(reason)} <b>${count}</b></span>`)
      .join('');
    return `<tr><td>${MONTHS[month]}</td><td>${exits.length}</td><td><div class="tenure-chip-list">${tenure}</div></td><td><div class="reason-chip-list">${reasons}</div></td></tr>`;
  }).join('');

  return `
    <div class="rg-detail-note">Разрез стажа: до 3 месяцев; от 3 до 6; от 6 до 12 месяцев; от 1 до 2 лет; более 2 лет.</div>
    <div class="group-table-wrap">
      <table class="group-exits-table">
        <thead><tr><th>Месяц увольнения</th><th>Кол-во</th><th>Стаж по диапазонам</th><th>Причина</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderGroupsTab(team, year) {
  const exits = teamExitRecords(team, year);
  const groups = groupExitRecords(exits);
  const rate = teamRate(team, year);
  const groupMarkup = groups.length
    ? groups.map((group, index) => {
      const groupRate = exits.length ? group.exits.length / exits.length * 100 : null;
      return `
      <details class="rg-accordion"${index === 0 ? ' open' : ''}>
        <summary>
          <span class="rg-summary-main"><strong>${escapeHtml(group.manager)}</strong><span>${group.exits.length} увольн.</span></span>
          <span class="rg-turnover"><span>Текучесть РГ</span><b>${formatRate(groupRate)}</b><small>${group.exits.length} из ${exits.length}</small></span>
        </summary>
        ${renderGroupDetails(group)}
      </details>`;
    }).join('')
    : `<div class="detail-empty">За ${year} год по отделу не найдено увольнений${state.exits ? '.' : ' — таблица увольнений недоступна.'}</div>`;

  return `
    <div class="detail-stats">
      <div class="detail-stat"><span>ТЕКУЧЕСТЬ ОТДЕЛА</span><strong>${formatRate(rate)}</strong><small>значение из таблицы показателей</small></div>
      <div class="detail-stat"><span>УВОЛЬНЕНИЯ ЗА ${year} ГОД</span><strong>${exits.length}</strong><small>по выбранному городу и отделу</small></div>
      <div class="detail-stat"><span>ГРУППЫ РУКОВОДИТЕЛЕЙ</span><strong>${groups.length}</strong><small>с увольнениями за период</small></div>
    </div>
    <div class="detail-section-heading"><div><h3>Разрез по РГ</h3><p>РГ берётся из столбца J; строки свернуты по месяцу, стажу и причине увольнения.</p></div></div>
    <div class="group-list">${groupMarkup}</div>
    <p class="data-limitation">Текучесть РГ показана как доля увольнений этой группы от всех увольнений отдела за выбранный год. Отображаются РГ, встречающиеся в увольнениях за период.</p>`;
}

function renderReasonChart(team, year) {
  const exits = teamExitRecords(team, year);
  if (!exits.length) return '<div class="chart-empty">Нет увольнений для построения диаграммы за этот год.</div>';

  const counts = new Map();
  for (const exit of exits) counts.set(exit.reason, (counts.get(exit.reason) ?? 0) + 1);
  const reasons = [...counts.entries()]
    .map(([reason, count]) => ({ reason, count, percent: count / exits.length * 100 }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, 'ru'));
  const scale = Math.max(10, Math.ceil(Math.max(...reasons.map((reason) => reason.percent)) / 10) * 10);
  const columns = reasons.map(({ reason, count, percent }) => `
    <div class="reason-column" title="${escapeHtml(reason)}: ${formatRate(percent)} (${count} чел.)">
      <span class="reason-column-value">${formatRate(percent)}</span>
      <div class="reason-column-plot"><span class="reason-column-fill" style="height:${Math.max(2, percent / scale * 100)}%"></span></div>
      <span class="reason-column-label">${escapeHtml(reason)}</span>
    </div>`).join('');
  return `<div class="chart-bars-scroll"><div class="reason-chart-bars" style="min-width:${Math.max(320, reasons.length * 92)}px">${columns}</div></div>`;
}

function renderTurnoverChart(team, year) {
  const monthly = teamMonthlyRates(team, year);
  if (!monthly.length) return '<div class="chart-empty">В таблице показателей нет помесячных значений для этого отдела и года.</div>';

  const byMonth = new Map(monthly.map((metric) => [metric.month, metric]));
  const allValues = monthly.flatMap((metric) => [metric.rate, metric.voluntaryRate]).filter((value) => value !== null);
  const maximum = Math.max(5, Math.ceil(Math.max(0, ...allValues) / 5) * 5);
  const columns = MONTHS.map((month, index) => {
    const metric = byMonth.get(index);
    const total = metric?.rate ?? null;
    const voluntary = metric?.voluntaryRate ?? null;
    const voluntaryPart = voluntary === null ? 0 : Math.max(0, Math.min(voluntary, total ?? voluntary));
    const totalPart = total === null ? 0 : Math.max(0, total - voluntaryPart);
    const totalHeight = totalPart ? Math.max(2, totalPart / maximum * 100) : 0;
    const voluntaryHeight = voluntaryPart ? Math.max(2, voluntaryPart / maximum * 100) : 0;
    return `
      <div class="turnover-month" title="${month}: общая ${formatRate(metric?.rate ?? null)}, добровольная ${formatRate(metric?.voluntaryRate ?? null)}">
        <div class="turnover-month-values"><span>${formatRate(metric?.rate ?? null)}</span><span>${formatRate(metric?.voluntaryRate ?? null)}</span></div>
        <div class="turnover-double-bars"><span class="turnover-stack"><span class="turnover-bar is-total" style="height:${totalHeight}%"></span><span class="turnover-bar is-voluntary" style="height:${voluntaryHeight}%"></span></span></div>
        <span class="turnover-month-label">${MONTHS[index].slice(0, 3)}</span>
      </div>`;
  }).join('');
  return `
    <div class="turnover-chart-legend"><span><i class="legend-total"></i>Общая</span><span><i class="legend-voluntary"></i>Добровольная</span></div>
    <div class="turnover-chart-scroll"><div class="turnover-chart-bars">${columns}</div></div>
    <p class="chart-note">Высота всей колонки равна общей текучести из P; нижний сегмент — добровольная составляющая из Q.</p>`;
}

function renderChartsTab(team, year) {
  return `
    <div class="detail-section-heading"><div><h3>Графики · ${escapeHtml(team.name)}</h3><p>Показатели за ${year} год.</p></div></div>
    <div class="charts-grid">
      <article class="chart-card"><div class="chart-card-heading"><span class="chart-index">01</span><div><h4>Причины увольнений, %</h4><p>Доля причины от всех увольнений отдела за год.</p></div></div>${renderReasonChart(team, year)}</article>
      <article class="chart-card"><div class="chart-card-heading"><span class="chart-index">02</span><div><h4>Текучесть по месяцам, %</h4><p>Общая и добровольная текучесть.</p></div></div>${renderTurnoverChart(team, year)}</article>
    </div>`;
}

function renderDetail() {
  if (selectedTeamIndex === null) return;
  const team = TEAMS[selectedTeamIndex];
  const rate = teamRate(team, state.year);
  elements.detailTitle.textContent = team.name;
  elements.detailLocation.textContent = team.cityLabel ? `г. ${team.cityLabel}` : `Показатели за ${state.year} год`;
  elements.detailRateCard.innerHTML = `<span>ТЕКУЧЕСТЬ ОТДЕЛА</span><strong>${formatRate(rate)}</strong><small>из столбца P · ${state.year} год</small>`;
  elements.groupsTab.classList.toggle('is-active', activeDetailTab === 'groups');
  elements.groupsTab.setAttribute('aria-selected', String(activeDetailTab === 'groups'));
  elements.chartsTab.classList.toggle('is-active', activeDetailTab === 'charts');
  elements.chartsTab.setAttribute('aria-selected', String(activeDetailTab === 'charts'));
  elements.detailPanel.setAttribute('aria-labelledby', activeDetailTab === 'groups' ? 'groups-tab' : 'charts-tab');
  elements.detailPanel.innerHTML = activeDetailTab === 'groups'
    ? renderGroupsTab(team, state.year)
    : renderChartsTab(team, state.year);
}

function openDepartment(index) {
  if (!TEAMS[index]) return;
  selectedTeamIndex = index;
  activeDetailTab = 'groups';
  elements.overview.hidden = true;
  elements.detail.hidden = false;
  renderDetail();
  elements.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDepartment() {
  selectedTeamIndex = null;
  elements.detail.hidden = true;
  elements.overview.hidden = false;
  elements.overview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setDetailTab(tab) {
  if (tab !== 'groups' && tab !== 'charts') return;
  activeDetailTab = tab;
  renderDetail();
}

function render() {
  elements.grid.classList.toggle('department-grid--center-last-two', TEAMS.length % 3 === 2);
  elements.grid.classList.toggle('department-grid--center-last-one', TEAMS.length % 2 === 1);
  const availableYears = getYearData();
  if (!availableYears.includes(state.year)) state.year = availableYears[0] ?? new Date().getFullYear();
  elements.yearSelect.innerHTML = availableYears.map((year) => `<option value="${year}"${year === state.year ? ' selected' : ''}>${year}</option>`).join('');
  elements.periodCaption.textContent = `Показатели за ${state.year} год`;
  elements.teamCount.textContent = String(TEAMS.length);

  const totals = TEAMS.map((team) => teamExits(team, state.year).reduce((sum, count) => sum + count, 0));
  elements.totalExits.textContent = (state.exits ? totals.reduce((sum, count) => sum + count, 0) : null) ?? '—';
  elements.grid.innerHTML = TEAMS.map((team, index) => renderTeam(team, index, state.year)).join('');
  if (selectedTeamIndex !== null) renderDetail();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 3600);
}

async function loadData({ quiet = false, forceRefresh = false } = {}) {
  elements.refreshButton.classList.add('is-loading');
  elements.refreshButton.disabled = true;
  if (!quiet && !state.exits && !state.metrics) elements.syncLabel.textContent = 'Загружаем данные…';
  const [exitResult, metricResult] = await Promise.allSettled([getSheet(SHEETS.exits, forceRefresh), getSheet(SHEETS.metrics, forceRefresh)]);
  if (exitResult.status === 'fulfilled') state.exits = buildExitRows(exitResult.value);
  if (metricResult.status === 'fulfilled') state.metrics = buildMetricRows(metricResult.value);
  const failures = [exitResult, metricResult].filter((result) => result.status === 'rejected');
  const failureMessage = [...new Set(failures.map((result) => result.reason.message))].join(' ');
  const successCount = 2 - failures.length;
  elements.statusDot.classList.toggle('is-offline', failures.length > 0);
  if (successCount > 0) saveCache();
  elements.syncLabel.textContent = successCount === 2 ? 'Данные актуальны' : successCount === 1 ? 'Загружена часть данных' : state.exits || state.metrics ? 'Сохранённые данные · нет связи' : 'Не удалось обновить';
  elements.syncLabel.title = failures.map((result) => result.reason.message).join('\n');

  if (state.exits || state.metrics) {
    render();
    if (failures.length && !quiet) showToast(failures.map((result) => result.reason.message).join(' '));
  } else {
    const hint = location.protocol === 'file:'
      ? 'Закройте эту вкладку и запустите run-dashboard.bat из папки проекта.'
      : 'Проверьте доступ к таблицам по ссылке и нажмите кнопку обновления.';
    elements.grid.innerHTML = `<div class="load-error"><strong>Не удалось загрузить данные из таблиц.</strong><br>${escapeHtml(failureMessage)}<br>${hint}</div>`;
    elements.totalExits.textContent = '—';
  }
  elements.refreshButton.classList.remove('is-loading');
  elements.refreshButton.disabled = false;
}

elements.yearSelect.addEventListener('change', (event) => {
  state.year = Number(event.target.value);
  render();
});
elements.grid.addEventListener('click', (event) => {
  const card = event.target.closest('[data-team-index]');
  if (card) openDepartment(Number(card.dataset.teamIndex));
});
elements.grid.addEventListener('keydown', (event) => {
  const card = event.target.closest('[data-team-index]');
  if (card && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openDepartment(Number(card.dataset.teamIndex));
  }
});
elements.backButton.addEventListener('click', closeDepartment);
elements.groupsTab.addEventListener('click', () => setDetailTab('groups'));
elements.chartsTab.addEventListener('click', () => setDetailTab('charts'));
elements.refreshButton.addEventListener('click', () => loadData({ forceRefresh: true }));

function startDashboard() {
  if (window.smartwayDashboardStarted) return;
  window.smartwayDashboardStarted = true;
  restoreCache();
  loadData();
  setInterval(() => loadData({ quiet: true, forceRefresh: true }), 5 * 60 * 1000);
}

function initializeLogin() {
  const screen = document.getElementById('login-screen');
  const form = document.getElementById('login-form');
  const passwordInput = document.getElementById('login-password');
  const submitButton = document.getElementById('login-submit');
  const message = document.getElementById('login-message');

  if (USE_LOCAL_PROXY) {
    screen.hidden = true;
    startDashboard();
    return;
  }
  if (DASHBOARD_PASSWORD === 'CHANGE_ME_BEFORE_PUBLISHING') {
    passwordInput.disabled = true;
    submitButton.disabled = true;
    message.textContent = 'Перед публикацией задайте пароль в начале файла app.js.';
    message.hidden = false;
    return;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (passwordInput.value !== DASHBOARD_PASSWORD) {
      passwordInput.value = '';
      message.textContent = 'Неверный пароль. Попробуйте ещё раз.';
      message.hidden = false;
      passwordInput.focus();
      return;
    }
    screen.hidden = true;
    startDashboard();
  });
}

initializeLogin();
