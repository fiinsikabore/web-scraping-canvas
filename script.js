// =====================================================
// script.js
// PART 1 — WEB SCRAPING: read the data out of canvas.html with jQuery
// PART 2 — DISPLAY: rebuild the page with the new design
// PART 3 — EVENTS: clicks, search, filters
// =====================================================


// =====================================================
// PART 1 — WEB SCRAPING
// =====================================================

// Get the visible text of an element
// (Canvas also hides extra copies for screen readers, so we remove them)
function getText(element) {
  const copy = $(element).first().clone();
  copy.find('.screenreader-only, [class*="screenReaderContent"], .hidden-desktop, .nav-badge').remove();
  return copy.text().replace(/\s+/g, ' ').trim();
}

// Turn "94.23" into a number, "-" into null, and "abc" into NaN (not a number)
function toNumber(value) {
  if (value === undefined || value === '-') return null;
  return Number(value);
}

function scrapePage(html) {
  // Error handling: empty file
  if (!html || html.trim() === '') {
    throw new Error('The page is empty.');
  }

  // Turn the HTML text into a page we can search with jQuery
  // (DOMParser does not run the page's scripts or load its images)
  const page = $(new DOMParser().parseFromString(html, 'text/html'));

  // Error handling: not the right page
  if (page.find('.ig-row').length === 0) {
    throw new Error('No tasks found. Is this the Canvas "Travaux" page?');
  }

  const canvasUrl = 'https://alueducation.instructure.com';
  const warnings = [];

  // ---------- 1. Course information ----------
  const course = {
    name: page.find('title').text().replace('Travaux:', '').trim(),   // "Frontend Web Development"
    term: page.find('#section-tabs-header-subtitle').text().trim(),   // "2026 September Term (ALU)"
    url: canvasUrl + page.find('#breadcrumbs li:eq(1) a').attr('href')
  };

  // ---------- 2. Breadcrumbs ----------
  const crumbs = [];
  page.find('#breadcrumbs li').each(function () {
    const link = $(this).find('a');
    crumbs.push({
      label: getText(link) || link.find('i').attr('title'),   // the first one is an icon: title="Mon tableau de bord"
      url: canvasUrl + link.attr('href')
    });
  });

  // ---------- 3. Course menu ----------
  const menu = [];
  page.find('#section-tabs a').each(function () {
    menu.push({
      label: getText(this),                                   // "Notes"
      url: canvasUrl + $(this).attr('href'),
      badge: $(this).find('.nav-badge').text().trim(),        // "3"
      active: $(this).hasClass('active')                      // the page we are on
    });
  });

  // ---------- 4. Tasks ----------
  const tasks = [];

  // Canvas groups tasks into sections: "Devoirs sans date", "Devoirs passés"
  page.find('.assignment_group').each(function () {
    const section = getText($(this).find('.ig-header-title'));

    $(this).find('.ig-row').each(function () {
      const row = $(this);
      const name = getText(row.find('.ig-title'));

      // Error handling: empty name
      if (name === '') {
        warnings.push('A task with an empty name was skipped.');
        return;
      }

      // Error handling: characters that could not be read
      if (name.includes('�')) {
        warnings.push(name + ': contains unreadable characters.');
      }

      // Score: the text looks like "94.23 /100 pts" or "-/25 pts"
      const scoreText = getText(row.find('.score-display'));
      const parts = scoreText.replace('pts', '').split('/');
      let score = toNumber(parts[0].trim());
      let points = toNumber(parts[1] && parts[1].trim());

      // Error handling: not a number, negative value
      if (Number.isNaN(score) || score < 0) {
        warnings.push(name + ': the score is not valid.');
        score = null;
      }
      if (Number.isNaN(points) || points < 0) {
        warnings.push(name + ': the points are not valid.');
        points = null;
      }

      // Grade: "94.23%" or "Pas encore noté"
      const grade = getText(row.find('.grade-display'));

      // Due date: Canvas stores the exact date in <time datetime="2026-09-11T21:59:59Z">
      const dueAttribute = row.find('.assignment-date-due time').attr('datetime');
      let due = dueAttribute ? new Date(dueAttribute) : null;
      if (due && isNaN(due)) {
        warnings.push(name + ': the due date could not be read.');
        due = null;
      }

      // Availability: "Fermé" (closed), or nothing when the task is open
      const availability = getText(row.find('.assignment-date-available')) || 'Open';

      // ACTIVE or PAST (what the facilitator asked for)
      let status = 'Active';
      if (availability === 'Fermé' || (due && due < new Date())) {
        status = 'Past';
      }

      // Submission: Graded, Awaiting grade or Not submitted
      const canvasNote = row.find('.js-score > .screenreader-only').text().replace(/\s+/g, ' ').trim();
      let submission = 'Not submitted';
      if (score !== null) {
        submission = 'Graded';
      } else if (grade === 'Pas encore noté') {
        submission = 'Awaiting grade';
      }

      tasks.push({
        number: tasks.length + 1,
        fullName: name,
        name: name.replace(' [synced from intranet]', '').replace(' (Front-End Web Development)', ''),
        fromIntranet: name.includes('[synced from intranet]'),
        type: row.find('.ig-type-icon .screenreader-only').text().trim(),   // "Travail" / "Questionnaire"
        url: row.find('.ig-title').attr('href'),
        section: section,
        availability: availability,
        due: due,
        status: status,
        submission: submission,
        score: score,
        points: points,
        grade: grade,
        canvasNote: canvasNote
      });
    });
  });

  return { course, crumbs, menu, tasks, warnings };
}


// =====================================================
// PART 2 — DISPLAY
// 1. Load canvas.html   2. Scrape it   3. Build the widgets
// =====================================================

let data = null;        // everything returned by scrapePage()
let filter = 'all';     // 'all', 'Active', 'Past' or 'Graded'
let view = 'date';      // 'date' (Canvas sections) or 'type' (Travail / Questionnaire)

// ---------- Small helpers ----------

// Make text safe to put inside HTML (so "<" in a name can't break the page)
function safe(text) {
  return $('<div>').text(text ?? '').html();
}

// Dimmed word, like "in" in "in New York City"
function dim(text) {
  return '<span class="dim">' + text + '</span>';
}

// 2026-09-11 → "11 Sept 2026"
function formatDate(date) {
  return date.getDate() + ' ' + date.toLocaleDateString('en-GB', { month: 'short' }) + ' ' + date.getFullYear();
}

// 2026-09-11 23:59 → "23:59"
function formatTime(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// 94.2333 → 94.23
function round(number) {
  return Math.round(number * 100) / 100;
}

function showError(message) {
  $('#message').html(message).prop('hidden', false);
}

// ---------- Cross-stitch motifs ----------
// Each drawing is a small grid: "X" = one stitch, "." = empty fabric.
const MOTIFS = {
  diamond: ['....X....', '...X.X...', '..X.X.X..', '.X.X.X.X.', 'X.X.X.X.X', '.X.X.X.X.', '..X.X.X..', '...X.X...', '....X....'],
  sun:     ['.....X.....', '.X...X...X.', '..X.....X..', '....XXX....', '...XXXXX...', 'XX.XXXXX.XX', '...XXXXX...', '....XXX....', '..X.....X..', '.X...X...X.', '.....X.....'],
  star:    ['....X....', '....X....', '...XXX...', '..XXXXX..', 'XXXXXXXXX', '..XXXXX..', '...XXX...', '....X....', '....X....']
};

// Every "X" becomes two small crossing lines, like a real cross stitch
function stitch(pattern, color) {
  let lines = '';
  pattern.forEach(function (row, y) {
    row.split('').forEach(function (cell, x) {
      if (cell === 'X') {
        lines += `M${x + .15} ${y + .15}L${x + .85} ${y + .85}M${x + .85} ${y + .15}L${x + .15} ${y + .85}`;
      }
    });
  });
  return `<svg viewBox="0 0 ${pattern[0].length} ${pattern.length}"><path d="${lines}" stroke="${color}" stroke-width=".3" stroke-linecap="round"/></svg>`;
}

// =====================================================
// STEP 1 — Load canvas.html
// =====================================================
function loadPage() {
  $.get('canvas.html')
    .done(function (html) {
      startApp(html);
    })
    .fail(function () {
      // Browsers block this when index.html is opened by double-click
      showError('Could not read <b>canvas.html</b>. Open the folder with Live Server, ' +
                'or choose the file here: <input type="file" id="pick-file" accept=".html">');
    });
}

// =====================================================
// STEP 2 — Scrape it, then draw everything
// =====================================================
function startApp(html) {
  try {
    data = scrapePage(html);
  } catch (error) {
    showError(error.message);
    return;
  }
  $('#message').prop('hidden', true);

  showCourse();
  showWidgets();
  showWarnings();
  showTasks();
}

// =====================================================
// STEP 3 — Build the page
// =====================================================

// Sidebar (course name, term, menu) and breadcrumbs
function showCourse() {
  document.title = 'Travaux · ' + data.course.name;
  $('#course-home').text(data.course.name).attr('href', data.course.url);
  $('#term').text(data.course.term);

  data.menu.forEach(function (item) {
    const badge = item.badge ? '<b class="badge">' + item.badge + '</b>' : '';
    const active = item.active ? 'active' : '';
    $('#course-nav').append(
      '<li><a href="' + item.url + '" target="_blank" class="' + active + '">' + safe(item.label) + badge + '</a></li>'
    );
  });

  data.crumbs.forEach(function (crumb, i) {
    const isLast = i === data.crumbs.length - 1;
    const content = isLast
      ? '<span>' + safe(crumb.label) + '</span>'
      : '<a href="' + crumb.url + '" target="_blank">' + safe(crumb.label) + '</a>';
    $('#crumbs').append('<li>' + content + '</li>');
  });
}

// The 4 widgets at the top
function showWidgets() {
  const tasks = data.tasks;
  const active = tasks.filter(t => t.status === 'Active').length;
  const past = tasks.filter(t => t.status === 'Past').length;
  const graded = tasks.filter(t => t.submission === 'Graded');
  const toDo = tasks.filter(t => t.submission === 'Not submitted').length;
  const waiting = tasks.filter(t => t.submission === 'Awaiting grade').length;

  // --- 1. Hero: title + counts + stacked cards ---
  $('#hero-title').html(
    'Your tasks<br>' + dim('in') + ' ' + safe(data.course.name) + ' ' + dim('this') + ' ' + safe(data.course.term.replace(' (ALU)', ''))
  );
  $('#count-all').text(tasks.length);
  $('#count-active').text(active);
  $('#count-past').text(past);
  $('#count-graded').text(graded.length);
  $('#stack').html(
    '<div class="card">' + stitch(MOTIFS.sun, '#A3200B') + '</div>' +
    '<div class="card">' + stitch(MOTIFS.diamond, '#FFC862') + '</div>' +
    '<div class="card">' + stitch(MOTIFS.star, '#FFF8EE') + '</div>'
  );

  // --- 2. Big number: share of graded tasks + average grade ---
  const percent = Math.round(graded.length / tasks.length * 100);
  let totalPercent = 0;
  graded.forEach(t => { totalPercent += t.score / t.points * 100; });
  const average = graded.length ? round(totalPercent / graded.length) : 0;

  $('#big-number').text(percent + '%');
  $('#score-sentence').html(
    dim('Your tasks are') + ' ' + percent + '% graded ' + dim('and your') + ' average grade ' +
    dim('is') + ' ' + average + '% ' + dim('on') + ' ' + graded.length + ' tasks.'
  );
  $('#updated').text('Scraped from canvas.html · ' + formatDate(new Date()) + '.');

  // --- 3. To do ---
  $('#todo-fill').css('width', (toDo / tasks.length * 100) + '%');
  $('#todo-icon').html(stitch(MOTIFS.diamond, '#EE8434'));
  $('#todo-title').text(toDo + ' to do');
  $('#todo-text').html(
    'tasks are <b>not submitted</b> yet, and <b>' + waiting + '</b> ' +
    (waiting === 1 ? 'is' : 'are') + ' <b>waiting for a grade</b>.'
  );

  // --- 4. Course progress: points earned out of all points ---
  let earned = 0, possible = 0;
  tasks.forEach(function (t) {
    if (t.points) possible += t.points;
    if (t.score) earned += t.score;
  });
  $('#course-icon').html(stitch(MOTIFS.diamond, '#FFC862'));
  $('#course-title').text(data.course.name);
  $('#course-meta').html('Canvas <i>•</i> ' + safe(data.course.term) + ' <i>•</i> ' + tasks.length + ' tasks');
  $('#poster').html(stitch(MOTIFS.sun, '#FFF8EE'));
  $('#points-fill').css('width', (earned / possible * 100) + '%');
  $('#points-left').text(Math.round(possible - earned) + ' pts left');
}

// List of problems found in the data (error handling)
function showWarnings() {
  if (data.warnings.length === 0) return;
  let list = '';
  data.warnings.forEach(w => { list += '<li>' + safe(w) + '</li>'; });
  $('#warnings')
    .html('<summary>' + data.warnings.length + ' data warning(s)</summary><ul>' + list + '</ul>')
    .prop('hidden', false);
}

// ---------- One task widget ----------
function makeTask(task) {
  // Choose the look: past = light, graded = gold glow, active = orange glow
  let style = 'task-active', icon = stitch(MOTIFS.diamond, '#EE8434');
  if (task.status === 'Past') {
    style = 'task-past'; icon = stitch(MOTIFS.sun, '#A3200B');
  } else if (task.submission === 'Graded') {
    style = 'task-graded'; icon = stitch(MOTIFS.star, '#F4B400');
  }
  const iconClass = task.status === 'Past' ? 'round-icon' : 'round-icon dark-icon';

  // Info line: "Travail • Intranet • Due 11 Sept 2026"
  let meta = task.type;
  if (task.fromIntranet) meta += ' <i>•</i> Intranet';
  meta += ' <i>•</i> ' + (task.due ? 'Due ' + formatDate(task.due) : 'No due date');

  // Progress bar: how much of the points was earned
  let fill = 0;
  if (task.score !== null && task.points > 0) fill = task.score / task.points * 100;

  let label = (task.points ?? 0) + ' pts';
  if (task.submission === 'Graded') label = task.grade || (task.score + ' / ' + task.points);
  if (task.submission === 'Awaiting grade') label = 'Awaiting';

  const dueText = task.due ? formatDate(task.due) + ' at ' + formatTime(task.due) : 'no due date set';

  return `
    <article class="task ${style}">
      <div class="task-head">
        <span class="${iconClass}">${icon}</span>
        <a class="round-btn" href="${task.url}" target="_blank" aria-label="Open in Canvas">›</a>
      </div>

      <h3 class="task-name" title="${safe(task.fullName)}">${safe(task.name)}</h3>
      <p class="task-meta">${meta}</p>

      <div class="seg-bar">
        <div class="seg-track"><span class="seg-fill" style="width:${fill}%"></span></div>
        <span class="seg-label">${safe(label)}</span>
      </div>

      <p class="task-status"><span class="dot"></span>${task.submission} · ${task.status} · ${safe(task.availability)}</p>

      <details class="task-desc">
        <summary>Description</summary>
        <ul>
          <li><b>Task:</b> ${safe(task.fullName)}</li>
          <li><b>Type:</b> ${task.type}${task.fromIntranet ? ', synced from the ALU intranet' : ''}</li>
          <li><b>Canvas section:</b> ${safe(task.section)}</li>
          <li><b>Due:</b> ${dueText}</li>
          <li><b>Points possible:</b> ${task.points ?? '–'}</li>
          ${task.grade ? `<li><b>Grade:</b> ${safe(task.grade)}</li>` : ''}
          <li><b>Canvas says:</b> ${safe(task.canvasNote)}</li>
        </ul>
      </details>
    </article>`;
}

// ---------- All tasks, in sections ----------
function showTasks() {
  const search = $('#search').val().toLowerCase();

  // 1. Keep only the tasks that match the filter and the search
  const visible = data.tasks.filter(function (task) {
    let matchesFilter = filter === 'all' || task.status === filter;
    if (filter === 'Graded') matchesFilter = task.submission === 'Graded';
    const matchesSearch = task.fullName.toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });

  // 2. Put them in sections: by Canvas section, or by type
  const sections = {};
  visible.forEach(function (task) {
    const title = view === 'date' ? task.section : task.type;
    if (!sections[title]) sections[title] = [];
    sections[title].push(task);
  });

  // 3. Write the HTML
  let html = '';
  for (const title in sections) {
    let cards = '';
    sections[title].forEach(task => { cards += makeTask(task); });
    html += `
      <section class="group">
        <button class="group-head" aria-expanded="true">
          <span class="group-title">${safe(title)}</span>
          <span class="group-count">${sections[title].length}</span>
          <span class="chev">⌄</span>
        </button>
        <div class="tasks">${cards}</div>
      </section>`;
  }
  $('#groups').html(html);

  // 4. Update the small texts and the tabs
  $('#empty').prop('hidden', visible.length > 0);
  let showing = 'Showing ' + visible.length + ' of ' + data.tasks.length;
  if (filter !== 'all') showing += ' · ' + filter + ' · <button id="reset">show all</button>';
  $('#showing').html(showing);

  $('.tab').each(function () {
    $(this).attr('aria-pressed', $(this).data('filter') === filter);
  });
}

// ---------- Download everything as a spreadsheet (CSV) ----------
function downloadCsv() {
  let csv = 'Number,Name,Type,Section,Status,Submission,Availability,Due date,Score,Points,Grade,Canvas note,Link\n';

  data.tasks.forEach(function (t) {
    const due = t.due ? t.due.toISOString().slice(0, 10) + ' ' + formatTime(t.due) : '';
    const row = [t.number, t.fullName, t.type, t.section, t.status, t.submission, t.availability,
                 due, t.score ?? '', t.points ?? '', t.grade, t.canvasNote, t.url];
    // Put every value in quotes so commas inside names don't break the columns
    csv += row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',') + '\n';
  });

  // "﻿" helps Excel show French accents (é, è) correctly
  const file = new Blob(['﻿' + csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = 'travaux.csv';
  link.click();
}

// =====================================================
// PART 3 — EVENTS: what happens when the user clicks or types
// =====================================================
$(document).ready(function () {
  loadPage();

  // Search while typing
  $('#search').on('input', showTasks);

  // Filter tabs in the big widget (All, Active, Past, Graded)
  $('.tab').on('click', function () {
    filter = $(this).data('filter');
    showTasks();
  });

  // The ">" button scrolls down to the tasks
  $('#go-tasks').on('click', function () {
    $('html, body').animate({ scrollTop: $('#tasks-section').offset().top - 16 }, 400);
  });

  // "Par date" / "Par type"
  $('.view-toggle button').on('click', function () {
    view = $(this).data('view');
    $('.view-toggle button').removeClass('selected');
    $(this).addClass('selected');
    showTasks();
  });

  // Open / close a section (these buttons are created later, so we listen on #groups)
  $('#groups').on('click', '.group-head', function () {
    const isOpen = $(this).attr('aria-expanded') === 'true';
    $(this).attr('aria-expanded', !isOpen);
    $(this).next('.tasks').slideToggle(200);
  });

  // "show all" link
  $('#showing').on('click', '#reset', function () {
    filter = 'all';
    showTasks();
  });

  $('#export').on('click', downloadCsv);

  // Backup: choose canvas.html by hand if it could not be loaded
  $('#message').on('change', '#pick-file', function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => startApp(reader.result);
    reader.readAsText(file);
  });
});

