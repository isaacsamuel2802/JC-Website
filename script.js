const STORAGE_KEYS = {
  session: 'clubSession'
};

const API_BASE_URL = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

const uploadList = document.getElementById('uploadList');
const searchInput = document.getElementById('searchInput');
const statusMessage = document.getElementById('statusMessage');
const siteTitle = document.getElementById('siteTitle');
const siteSubtitle = document.getElementById('siteSubtitle');
const aboutText = document.getElementById('aboutText');
const editAboutButton = document.getElementById('editAboutButton');
const serverWarning = document.getElementById('serverWarning');

const panels = document.querySelectorAll('.panel');
const memberDashboard = document.getElementById('memberDashboard');
const memberGreeting = document.getElementById('memberGreeting');
const memberLogout = document.getElementById('memberLogout');
const adminDashboard = document.getElementById('adminDashboard');
const adminLoginCard = document.getElementById('adminLoginCard');
const adminLogout = document.getElementById('adminLogout');
const memberListElement = document.getElementById('memberList');
const attendanceForm = document.getElementById('attendanceForm');
const attendanceDate = document.getElementById('attendanceDate');
const attendanceMemberGrid = document.getElementById('attendanceMemberGrid');
const attendanceRecordsElement = document.getElementById('attendanceRecords');
const attendanceExportBtn = document.getElementById('attendanceExportBtn');
const memberAttendanceSummary = document.getElementById('memberAttendanceSummary');
const memberAttendanceList = document.getElementById('memberAttendanceList');
const memberAttendanceExportBtn = document.getElementById('memberAttendanceExportBtn');
const btnNewMember = document.getElementById('btnNewMember');

let currentAttendanceRecords = [];
let currentMemberAttendanceRecords = [];
const btnSearchArticles = document.getElementById('btnSearchArticles');
const btnMemberLogin = document.getElementById('btnMemberLogin');
const btnAdminLogin = document.getElementById('btnAdminLogin');
const btnGoToRegister = document.getElementById('btnGoToRegister');
const backButtons = document.querySelectorAll('.back-home');

const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const uploadForm = document.getElementById('uploadForm');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminForm = document.getElementById('adminForm');
const pastEventsList = document.getElementById('pastEventsList');
const pastEventForm = document.getElementById('pastEventForm');
const adminPastEventsList = document.getElementById('adminPastEventsList');
const pastEventImageInput = document.getElementById('pastEventImage');
const pastEventImagePreview = document.getElementById('pastEventImagePreview');
const pastEventSubmitBtn = document.getElementById('pastEventSubmitBtn');
const cancelPastEventEdit = document.getElementById('cancelPastEventEdit');

let uploads = [];
let adminMembers = [];
let upcomingEvents = [];
let upcomingEventsLoaded = false;
let upcomingEventsLoadError = false;
let pastEvents = [];
let pastEventsLoaded = false;
let pastEventsLoadError = false;
let editingPastEventImage = '';
let adminSettings = {
  siteTitle: 'Journal Club',
  siteSubtitle: 'A warm, elegant journal space where members publish articles through PDF uploads.',
  aboutText: 'This club is dedicated to sharing journals, articles, and research through a simple, polished publishing workflow. Members upload PDF files and the journal appears automatically.'
};
let session = JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || 'null') || { type: 'visitor' };

async function restoreAdminSession() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/session`, {
      credentials: 'same-origin'
    });
    if (!response.ok) {
      if (session.type === 'admin') {
        session = { type: 'visitor' };
        saveState();
        renderUI();
        renderUploads(searchInput ? searchInput.value : '');
      }
      return;
    }
    const data = await response.json();
    session = { type: 'admin', name: data.name, email: '' };
    saveState();
    renderUI();
    renderUploads(searchInput ? searchInput.value : '');
    restorePanelFromHash();
  } catch (error) {
    console.error('Unable to verify admin session', error);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
}

function setPanel(panelName) {
  panels.forEach(panel => {
    const show = panel.dataset.panel === panelName;
    panel.classList.toggle('active', show);
    panel.classList.toggle('hidden', !show);
  });
  document.body.classList.toggle('admin-login-view', panelName === 'admin' && session.type !== 'admin');
  if (panelName === 'admin') {
    window.scrollTo(0, 0);
  }
}

function updateServerWarning(visible, message) {
  if (!serverWarning) return;
  serverWarning.classList.toggle('hidden', !visible);
  serverWarning.innerHTML = message || '';
}

async function loadSettings() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/settings`);
    if (!response.ok) {
      throw new Error('Settings fetch failed');
    }
    adminSettings = await response.json();
    updateSiteContent();
    updateServerWarning(false);
  } catch (error) {
    console.error('Unable to load settings', error);
    updateServerWarning(true, 'Backend server not reachable. Start it with <code>node server.js</code> and open the site at <a href="http://localhost:3000">http://localhost:3000</a>. Member registration and publishing require the backend.');
  }
}

async function restoreMemberSession() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/session`, {
      credentials: 'same-origin'
    });
    if (!response.ok) {
      if (session.type === 'member') {
        session = { type: 'visitor' };
        saveState();
        renderUI();
        renderUploads(searchInput ? searchInput.value : '');
      }
      return;
    }
    const data = await response.json();
    session = { type: 'member', name: data.name, email: data.email };
    saveState();
    renderUI();
    renderUploads(searchInput ? searchInput.value : '');
  } catch (error) {
    console.error('Unable to verify member session', error);
    if (session.type === 'member') {
      session = { type: 'visitor' };
      saveState();
      renderUI();
      renderUploads(searchInput ? searchInput.value : '');
    }
  }
}
async function fetchArticles() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/articles`);
    uploads = response.ok ? await response.json() : [];
    renderUploads(searchInput ? searchInput.value : '');
  } catch (error) {
    uploads = [];
    renderUploads(searchInput ? searchInput.value : '');
  }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatArticlePreview(text, maxLength = 340) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'No article text available yet.';
  }
  const preview = normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
  return escapeHtml(preview);
}

function isPdfFile(fileType, fileData) {
  return (fileType && fileType.toLowerCase().includes('pdf')) || (typeof fileData === 'string' && fileData.startsWith('data:application/pdf'));
}

function decodeDataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function extractTextFromPdfDataUrl(dataUrl) {
  if (!window.pdfjsLib || !dataUrl) return '';
  try {
    const rawData = decodeDataUrlToUint8Array(dataUrl);
    const loadingTask = pdfjsLib.getDocument({ data: rawData });
    const pdfDoc = await loadingTask.promise;
    let text = '';
    for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex += 1) {
      const page = await pdfDoc.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      text += `${pageText}\n\n`;
    }
    return text.trim();
  } catch (error) {
    console.error('PDF text extraction failed:', error);
    return '';
  }
}

async function updatePdfTextPreviews(filteredItems) {
  if (!uploadList || !window.pdfjsLib) return;
  await Promise.all(filteredItems.map(async ({ item, originalIndex }) => {
    if (!isPdfFile(item.fileType, item.fileData)) return;
    if (!item.fileText) {
      item.fileText = await extractTextFromPdfDataUrl(item.fileData);
    }

    const card = uploadList.querySelector(`.upload-card-item[data-upload-index="${originalIndex}"]`);
    if (!card) return;
    const textBlock = card.querySelector('.article-text');
    if (!textBlock) return;
    textBlock.innerHTML = `<p>${formatArticlePreview(item.fileText)}</p>`;

    if (item.fileText && item.fileText.length > 340) {
      const toggleButton = card.querySelector('.toggle-article-text');
      if (!toggleButton) {
        const actionArea = card.querySelector('.action-row');
        if (actionArea) {
          actionArea.insertAdjacentHTML('beforeend', `<button class="action-btn toggle-article-text" data-action="toggle-text" data-index="${originalIndex}">Read full article</button>`);
        }
      }
    }
  }));
}

function renderUploads(filter = '') {
  if (!uploadList) return;
  const query = filter.trim().toLowerCase();
  const filtered = uploads
    .map((item, index) => ({ item, originalIndex: index }))
    .filter(({ item }) => {
      const text = `${item.title} ${item.author} ${item.category} ${item.uploadedBy}`.toLowerCase();
      return text.includes(query);
    });

  if (filtered.length === 0) {
    uploadList.innerHTML = '<p class="empty-state">No uploads match the search or none have been submitted yet.</p>';
    return;
  }

  uploadList.innerHTML = filtered.map(({ item, originalIndex }) => {
    const dateLabel = item.date ? `Published: ${escapeHtml(item.date)}` : 'Publication date not set';
    const fileLabel = escapeHtml(item.fileName || 'PDF upload');

    const canDelete =
      session.type === 'admin' ||
      (session.type === 'member' &&
        Boolean(session.email) &&
        Boolean(item.uploadedByEmail) &&
        session.email.toLowerCase() === item.uploadedByEmail.toLowerCase());

    const deleteButton = canDelete
      ? `<button class="action-btn" data-action="delete" data-index="${originalIndex}">Delete</button>`
      : '';

    const textPreview = item.fileText
      ? `<p>${formatArticlePreview(item.fileText)}</p>`
      : isPdfFile(item.fileType, item.fileData)
        ? '<p>Loading article text from PDF...</p>'
        : '<p>No text preview available for this article.</p>';

    return `
      <article class="upload-card-item" data-upload-index="${originalIndex}">
        <h3>${escapeHtml(item.title || 'Untitled article')}</h3>
        <div class="meta">
          <span>Author: ${escapeHtml(item.author || item.uploadedBy)}</span>
          <span>${escapeHtml(item.category)}</span>
          <span>${dateLabel}</span>
        </div>
        <p>Uploaded by ${escapeHtml(item.uploadedBy)} · ${fileLabel}</p>
        <div class="article-text">${textPreview}</div>
        <div class="action-row">
          <button class="action-btn" data-action="download" data-index="${originalIndex}">Download PDF</button>
          ${deleteButton}
        </div>
      </article>
    `;
  }).join('');

  updatePdfTextPreviews(filtered);
}

function updateSiteContent() {
  if (siteTitle && adminSettings.siteTitle) {
    siteTitle.textContent = adminSettings.siteTitle;
  }
  if (siteSubtitle && adminSettings.siteSubtitle) {
    siteSubtitle.textContent = adminSettings.siteSubtitle;
  }
  if (aboutText && adminSettings.aboutText) {
    aboutText.textContent = adminSettings.aboutText;
  }
}


function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function attendanceStatusClass(status) {
  return status && status.toLowerCase() === 'present' ? 'present' : 'absent';
}

function formatAttendanceStatus(status) {
  return status && status.toLowerCase() === 'present' ? 'Present' : 'Absent';
}

function csvEscape(value) {
  const stringValue = value == null ? '' : String(value);
  const formulaSafeValue = /^[\s]*[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  const escaped = formulaSafeValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildAttendanceCsv(records, memberView = false) {
  const rows = [];
  if (memberView) {
    rows.push(['Date', 'Status']);
    records.forEach(record => {
      rows.push([record.date || '', formatAttendanceStatus(record.status)]);
    });
  } else {
    rows.push(['Date', 'Member Name', 'Email', 'Status', 'Notes']);
    records.forEach(record => {
      rows.push([
        record.date || '',
        record.memberName || '',
        record.memberEmail || '',
        formatAttendanceStatus(record.status),
        record.notes || ''
      ]);
    });
  }
  return rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
}

function downloadCsvFile(filename, csvText) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function updateAttendanceExportButtonState() {
  if (attendanceExportBtn) {
    const enabled = Array.isArray(currentAttendanceRecords) && currentAttendanceRecords.length > 0;
    attendanceExportBtn.classList.toggle('hidden', !enabled);
    attendanceExportBtn.disabled = !enabled;
  }
}

function updateMemberAttendanceExportButtonState() {
  if (memberAttendanceExportBtn) {
    const enabled = Array.isArray(currentMemberAttendanceRecords) && currentMemberAttendanceRecords.length > 0;
    memberAttendanceExportBtn.classList.toggle('hidden', !enabled);
    memberAttendanceExportBtn.disabled = !enabled;
  }
}

function renderAttendanceMemberGrid(members, records = []) {
  if (!attendanceMemberGrid) return;
  const attendanceMap = (records || []).reduce((map, record) => {
    map[record.memberEmail] = record;
    return map;
  }, {});

  if (!members || members.length === 0) {
    attendanceMemberGrid.innerHTML = '<p class="empty-state">No members found to mark attendance.</p>';
    return;
  }

  attendanceMemberGrid.innerHTML = members.map(member => {
    const record = attendanceMap[member.email] || {};
    const checked = record.status && record.status.toLowerCase() === 'present' ? 'checked' : '';
    return `
      <div class="attendance-row">
        <div>
          <strong>${escapeHtml(member.name)}</strong>
            <div class="subtle">${escapeHtml(member.email)}</div>
        </div>
        <label>
            <input type="checkbox" name="attendancePresent" value="${escapeHtml(member.email)}" ${checked} />
          Present
        </label>
      </div>
    `;
  }).join('');
}

function renderAttendanceRecords(records = []) {
  if (!attendanceRecordsElement) return;
  currentAttendanceRecords = Array.isArray(records) ? records : [];
  updateAttendanceExportButtonState();

  if (!records || records.length === 0) {
    attendanceRecordsElement.innerHTML = '<p class="empty-state">No attendance records for this date.</p>';
    return;
  }

  const presentCount = records.filter(item => item.status && item.status.toLowerCase() === 'present').length;
  const totalCount = records.length;
  attendanceRecordsElement.innerHTML = `
    <div class="attendance-summary">
      <div class="summary-item"><strong>${presentCount}</strong><span>Present</span></div>
      <div class="summary-item"><strong>${totalCount - presentCount}</strong><span>Absent</span></div>
      <div class="summary-item"><strong>${totalCount}</strong><span>Total marked</span></div>
    </div>
    <div class="attendance-records-table">
      <table class="attendance-table">
        <thead>
          <tr><th>Member</th><th>Email</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${records.map(record => `
            <tr>
              <td>${escapeHtml(record.memberName || '')}</td>
              <td>${escapeHtml(record.memberEmail)}</td>
              <td><span class="attendance-status ${attendanceStatusClass(record.status)}">${formatAttendanceStatus(record.status)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMemberAttendance(records = []) {
  if (memberAttendanceSummary) {
    const present = records.filter(r => r.status && r.status.toLowerCase() === 'present').length;
    const absent = records.filter(r => !r.status || r.status.toLowerCase() !== 'present').length;
    memberAttendanceSummary.innerHTML = `
      <div class="attendance-summary">
        <div class="summary-item"><strong>${present}</strong><span>Present days</span></div>
        <div class="summary-item"><strong>${absent}</strong><span>Absent days</span></div>
        <div class="summary-item"><strong>${records.length}</strong><span>Total records</span></div>
      </div>
    `;
  }

  if (!memberAttendanceList) return;
  currentMemberAttendanceRecords = Array.isArray(records) ? records : [];
  updateMemberAttendanceExportButtonState();

  if (!records || records.length === 0) {
    memberAttendanceList.innerHTML = '<p class="empty-state">No attendance history yet.</p>';
    return;
  }

  memberAttendanceList.innerHTML = `
    <table class="attendance-table">
      <thead>
        <tr><th>Date</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${records.map(record => `
          <tr>
            <td>${escapeHtml(record.date || '')}</td>
            <td><span class="attendance-status ${attendanceStatusClass(record.status)}">${formatAttendanceStatus(record.status)}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadAttendanceForDate(date) {
  if (!date || !attendanceMemberGrid) return;
  const activeDate = date || getToday();
  if (attendanceDate) attendanceDate.value = activeDate;

  const members = adminMembers.length > 0 ? adminMembers : await renderMemberList();
  const response = await fetch(`${API_BASE_URL}/api/attendance?date=${encodeURIComponent(activeDate)}`);
  if (!response.ok) {
    showAlert('Unable to load attendance. Verify your admin session and try again.');
    return;
  }
  const records = await response.json();
  renderAttendanceMemberGrid(members, records);
  renderAttendanceRecords(records);
}

async function loadMemberAttendance(email) {
  if (!email || !memberAttendanceList) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/attendance?memberEmail=${encodeURIComponent(email)}`);
    const records = response.ok ? await response.json() : [];
    renderMemberAttendance(records);
  } catch (error) {
    console.error('Unable to load member attendance', error);
    if (memberAttendanceList) memberAttendanceList.innerHTML = '<p class="empty-state">Unable to load attendance history.</p>';
  }
}

function updateStatus() {
  if (!statusMessage) return;
  if (session.type === 'member') {
    statusMessage.textContent = `Signed in as ${session.name}`;
  } else if (session.type === 'admin') {
    statusMessage.textContent = 'Signed in as admin';
  } else {
    statusMessage.textContent = 'Not signed in';
  }
}

function openMemberDashboard() {
  if (!memberDashboard || !memberGreeting) return;
  memberGreeting.textContent = `Hello, ${session.name}. Upload your PDF to publish a new journal.`;
  memberDashboard.classList.remove('hidden');
  loadMemberAttendance(session.email);
  renderUpcomingEvents();
}

function closeMemberDashboard() {
  if (!memberDashboard) return;
  memberDashboard.classList.add('hidden');
}

function openAdminDashboard() {
  if (!adminLoginCard || !adminDashboard) return;
  adminLoginCard.classList.add('hidden');
  adminDashboard.classList.remove('hidden');
  const titleInput = document.getElementById('siteTitleInput');
  const subtitleInput = document.getElementById('siteSubtitleInput');
  const aboutInput = document.getElementById('aboutTextInput');
  if (titleInput) titleInput.value = adminSettings.siteTitle;
  if (subtitleInput) subtitleInput.value = adminSettings.siteSubtitle;
  if (aboutInput) aboutInput.value = adminSettings.aboutText;
  renderMemberList().then(() => {
    const targetDate = attendanceDate?.value || getToday();
    if (attendanceDate) attendanceDate.value = targetDate;
    loadAttendanceForDate(targetDate);
  });
  fetchUpcomingEvents();
  fetchPastEvents();
}

function closeAdminDashboard() {
  if (adminLoginCard) adminLoginCard.classList.remove('hidden');
  if (adminDashboard) adminDashboard.classList.add('hidden');
}

function renderUI() {
  updateSiteContent();
  updateStatus();

  if (session.type === 'member') {
    openMemberDashboard();
  } else {
    closeMemberDashboard();
  }

  if (session.type === 'admin') {
    openAdminDashboard();
  } else {
    closeAdminDashboard();
  }

  if (session.type === 'visitor') {
    setPanel('home');
  }
}

async function renderMemberList() {
  if (!memberListElement) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/members`);
    if (!response.ok) {
      memberListElement.innerHTML = '<p class="empty-state">Unable to load members.</p>';
      return;
    }

    const members = await response.json();
    if (members.length === 0) {
      memberListElement.innerHTML = '<p class="empty-state">No registered members yet.</p>';
      adminMembers = [];
      return members;
    }

    adminMembers = members;
    memberListElement.innerHTML = members.map(member => `
      <div class="member-item">
        <span>${escapeHtml(member.name)} — ${escapeHtml(member.email)}</span>
        <button class="action-btn" data-action="remove-member" data-email="${escapeHtml(member.email)}">Remove</button>
      </div>
    `).join('');
    return members;
  } catch (error) {
    memberListElement.innerHTML = '<p class="empty-state">Unable to load members.</p>';
    adminMembers = [];
    return [];
  }
}

function showAlert(message) {
  window.alert(message);
}

function getDisplayTitle(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
}

async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

if (uploadForm) {
  uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (session.type !== 'member') {
    showAlert('Only logged in members can publish an article.');
    return;
  }

  const titleInput = document.getElementById('title').value.trim();
  const authorInput = document.getElementById('author').value.trim();
  const date = document.getElementById('date').value;
  const category = document.getElementById('category').value;
  const fileInput = document.getElementById('fileUpload');
  const file = fileInput.files[0];

  if (!file) {
    showAlert('Please upload a PDF file to publish.');
    return;
  }

  if (file.type !== 'application/pdf') {
    showAlert('Only PDF files are accepted for publication.');
    return;
  }

  const fileData = await readFileAsDataURL(file);
  const fileText = window.pdfjsLib && file.type.toLowerCase() === 'application/pdf'
    ? await extractTextFromPdfDataUrl(fileData)
    : '';
  const title = titleInput || getDisplayTitle(file.name);
  const author = authorInput || session.name;

  const article = {
    title,
    author,
    category,
    date,
    uploadedBy: session.name,
    uploadedByEmail: session.email,
    fileName: file.name,
    fileType: file.type,
    fileData,
    fileText
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/articles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(article)
    });

    if (!response.ok) {
      const error = await response.json();
      showAlert(error.error || 'Failed to publish article.');
      return;
    }

    await fetchArticles();
    uploadForm.reset();
    showAlert('Your PDF has been published as an article.');
  } catch (error) {
    console.error('Publish error', error);
    showAlert('Unable to reach the backend. Start the server and open the site at http://localhost:3000.');
  }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('memberName').value.trim();
    const email = document.getElementById('memberEmail').value.trim().toLowerCase();
    const password = document.getElementById('memberPassword').value;

    if (!name || !email || !password) {
      showAlert('Fill in all registration fields.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });

      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Registration failed.');
        return;
      }

      showAlert('Registration complete. Please log in to publish articles.');
      registerForm.reset();
      setPanel('member-login');
    } catch (error) {
      console.error('Registration error', error);
      showAlert('Unable to reach the backend. Start the server and open the site at http://localhost:3000.');
    }
  });
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Invalid email or password.');
        return;
      }

      const data = await response.json();
      session = { type: 'member', name: data.name, email: data.email };
      saveState();
      renderUI();
      setPanel('member-dashboard');
      loginForm.reset();
    } catch (error) {
      console.error('Login error', error);
      showAlert('Unable to reach the backend. Start the server and open the site at http://localhost:3000.');
    }
  });
}

if (memberLogout) {
  memberLogout.addEventListener('click', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/logout`, { method: 'POST' });
      if (!response.ok) throw new Error(`Member logout failed with status ${response.status}`);
    } catch (error) {
      console.error('Member logout error', error);
      showAlert('Unable to end your member session. Please try again.');
      return;
    }
    session = { type: 'visitor' };
    saveState();
    renderUI();
    setPanel('home');
  });
}

if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('adminUser').value.trim();
    const password = document.getElementById('adminPassword').value;

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Admin sign-in failed.');
        return;
      }

      const data = await response.json();
      session = { type: 'admin', name: data.name, email: '' };
      saveState();
      renderUI();
      setPanel('admin');
      adminLoginForm.reset();
    } catch (error) {
      console.error('Admin login error', error);
      showAlert('Unable to reach the backend. Start the server and try again.');
    }
  });
}

if (adminForm) {
  adminForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = document.getElementById('siteTitleInput').value.trim();
    const subtitle = document.getElementById('siteSubtitleInput').value.trim();
    const about = document.getElementById('aboutTextInput').value.trim();

    if (!title || !subtitle || !about) {
      showAlert('Fill in all site settings fields.');
      return;
    }

    const response = await fetch(`${API_BASE_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteTitle: title, siteSubtitle: subtitle, aboutText: about })
    });

    if (!response.ok) {
      const error = await response.json();
      showAlert(error.error || 'Failed to update settings.');
      return;
    }

    await loadSettings();
    showAlert('Site details updated successfully.');
  });
}

if (adminLogout) {
  adminLogout.addEventListener('click', async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/logout`, { method: 'POST' });
      if (!response.ok) throw new Error(`Admin logout failed with status ${response.status}`);
    } catch (error) {
      console.error('Admin logout error', error);
      showAlert('Unable to end the admin session on the server. Please try again.');
      return;
    }
    session = { type: 'visitor' };
    saveState();
    renderUI();
    setPanel('home');
  });
}

if (uploadList) {
  uploadList.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    const index = Number(button.dataset.index);
    const action = button.dataset.action;
    const item = uploads[index];

    if (action === 'toggle-text') {
      const index = Number(button.dataset.index);
      const item = uploads[index];
      const card = button.closest('.upload-card-item');
      if (!card || !item || !item.fileText) return;
      const textBlock = card.querySelector('.article-text');
      if (!textBlock) return;
      const expanded = textBlock.classList.toggle('expanded');
      if (expanded) {
        textBlock.innerHTML = `<p>${escapeHtml(item.fileText).replace(/\n/g, '<br>')}</p>`;
      } else {
        textBlock.innerHTML = `<p>${formatArticlePreview(item.fileText)}</p>`;
      }
      button.textContent = expanded ? 'Show less' : 'Read full article';
      return;
    }

    if (action === 'download') {
      if (!item || !item.fileData) {
        showAlert('No file is attached to this upload.');
        return;
      }

      if (!/^data:application\/pdf;base64,/i.test(item.fileData)) {
        showAlert('This article does not contain a valid PDF download.');
        return;
      }
      const link = document.createElement('a');
      link.href = item.fileData;
      link.download = item.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    if (action === 'delete') {
      if (!item) return;
      if (!confirm(`Delete "${item.title}" by ${item.author || item.uploadedBy}?`)) return;

      const response = await fetch(`${API_BASE_URL}/api/articles/${item.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Unable to delete article.');
        return;
      }
      await fetchArticles();
    }
  });
}

if (memberListElement) {
  memberListElement.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    const email = button.dataset.email;

    if (action === 'remove-member' && session.type === 'admin' && email) {
      const response = await fetch(`${API_BASE_URL}/api/members/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Unable to remove member.');
        return;
      }
      await renderMemberList();
      await loadAttendanceForDate(attendanceDate?.value || getToday());
    }
  });
}

if (attendanceDate) {
  attendanceDate.addEventListener('change', () => {
    if (attendanceDate.value) {
      loadAttendanceForDate(attendanceDate.value);
    }
  });
}

if (attendanceForm) {
  attendanceForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (session.type !== 'admin') {
      showAlert('Only admin can mark attendance.');
      return;
    }

    const date = attendanceDate?.value || getToday();
    if (!date) {
      showAlert('Select a date for attendance.');
      return;
    }

    const checkboxes = attendanceMemberGrid ? Array.from(attendanceMemberGrid.querySelectorAll('input[name="attendancePresent"]')) : [];
    const records = checkboxes.map(input => ({
      memberEmail: input.value,
      status: input.checked ? 'Present' : 'Absent'
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, records })
      });

      if (!response.ok) {
        const error = await response.json();
        showAlert(error.error || 'Unable to save attendance.');
        return;
      }

      showAlert('Attendance saved successfully.');
      await loadAttendanceForDate(date);
    } catch (error) {
      console.error('Attendance save error', error);
      showAlert('Unable to save attendance.');
    }
  });
}

if (attendanceExportBtn) {
  attendanceExportBtn.addEventListener('click', () => {
    if (!currentAttendanceRecords || currentAttendanceRecords.length === 0) {
      showAlert('No attendance records to export.');
      return;
    }
    const dateValue = attendanceDate?.value || getToday();
    const csv = buildAttendanceCsv(currentAttendanceRecords, false);
    downloadCsvFile(`attendance-${dateValue}.csv`, csv);
  });
}

if (memberAttendanceExportBtn) {
  memberAttendanceExportBtn.addEventListener('click', () => {
    if (!currentMemberAttendanceRecords || currentMemberAttendanceRecords.length === 0) {
      showAlert('No attendance history to export.');
      return;
    }
    const safeEmail = session.email ? session.email.replace(/[@.]/g, '-') : 'member';
    const csv = buildAttendanceCsv(currentMemberAttendanceRecords, true);
    downloadCsvFile(`attendance-${safeEmail}.csv`, csv);
  });
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    renderUploads(searchInput.value);
  });
}

// Event Management Functions
async function fetchUpcomingEvents() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/events`);
    if (!response.ok) {
      throw new Error(`Events request failed with status ${response.status}`);
    }
    upcomingEvents = await response.json();
    upcomingEventsLoadError = false;
  } catch (error) {
    console.error('Unable to load events', error);
    upcomingEvents = [];
    upcomingEventsLoadError = true;
  } finally {
    upcomingEventsLoaded = true;
    renderUpcomingEvents();
    if (session.type === 'admin') {
      renderAdminEventsList();
    }
  }
}

function formatEventDate(date, time) {
  const dateObj = new Date(date + 'T00:00:00');
  const formatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return time ? `${formatted} at ${time}` : formatted;
}

async function fetchPastEvents() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/past-events`);
    if (!response.ok) {
      throw new Error(`Past events request failed with status ${response.status}`);
    }
    pastEvents = await response.json();
    pastEventsLoadError = false;
  } catch (error) {
    console.error('Unable to load past events', error);
    pastEvents = [];
    pastEventsLoadError = true;
  } finally {
    pastEventsLoaded = true;
    renderPastEvents();
    renderEventsPage();
    renderAdminPastEvents();
  }
}

function renderPastEvents() {
  if (!pastEventsList) return;
  if (!pastEventsLoaded) return;
  if (pastEventsLoadError) {
    pastEventsList.innerHTML = '<p class="empty-state">Unable to load previous events. Please refresh the page to try again.</p>';
    return;
  }

  const search = (document.getElementById('pastEventSearch')?.value || '').trim().toLowerCase();
  const fromDate = document.getElementById('pastEventFrom')?.value || '';
  const toDate = document.getElementById('pastEventTo')?.value || '';
  const filteredEvents = pastEvents.filter(event => {
    const searchableText = `${event.title} ${event.description || ''} ${event.location || ''}`.toLowerCase();
    return searchableText.includes(search)
      && (!fromDate || event.eventDate >= fromDate)
      && (!toDate || event.eventDate <= toDate);
  });

  if (filteredEvents.length === 0) {
    pastEventsList.innerHTML = `<p class="empty-state">${pastEvents.length ? 'No events match your search and date filters.' : 'No previous events have been added yet.'}</p>`;
    return;
  }

  pastEventsList.innerHTML = filteredEvents.map(event => {
    const imageHtml = event.eventImage
      ? `<img class="past-event-image" src="${escapeHtml(event.eventImage)}" alt="${escapeHtml(event.title)}" loading="lazy" />`
      : '<div class="past-event-image-placeholder">Journal Club event</div>';
    const eventDate = new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    return `
      <a class="past-event-card" href="events.html?id=${encodeURIComponent(event.id)}" aria-label="View details for ${escapeHtml(event.title)}">
        <div class="past-event-card-media">${imageHtml}</div>
        <div class="past-event-card-content">
          <time datetime="${escapeHtml(event.eventDate)}">${escapeHtml(eventDate)}</time>
          <h3>${escapeHtml(event.title)}</h3>
          ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
          ${event.location ? `<span class="past-event-location">${escapeHtml(event.location)}</span>` : ''}
          <span class="past-event-link-label">View event details <span aria-hidden="true">→</span></span>
        </div>
      </a>
    `;
  }).join('');
}

function renderEventsPage() {
  const eventsList = document.getElementById('eventsPageList');
  const eventDetail = document.getElementById('eventPageDetail');
  const eventsStatus = document.getElementById('eventsPageStatus');
  if (!eventsList || !eventDetail || !eventsStatus) return;

  if (!pastEventsLoaded) return;
  if (pastEventsLoadError) {
    eventsStatus.textContent = 'Unable to load events. Please refresh the page to try again.';
    eventsList.innerHTML = '';
    eventDetail.innerHTML = '';
    return;
  }

  const requestedId = new URLSearchParams(window.location.search).get('id');
  const selectedEvent = requestedId
    ? pastEvents.find(event => String(event.id) === requestedId)
    : null;

  if (selectedEvent) {
    const eventDate = new Date(`${selectedEvent.eventDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const imageHtml = selectedEvent.eventImage
      ? `<img class="event-detail-image" src="${escapeHtml(selectedEvent.eventImage)}" alt="${escapeHtml(selectedEvent.title)}" />`
      : '<div class="event-detail-image-placeholder">Journal Club event</div>';

    eventsStatus.textContent = '';
    eventDetail.innerHTML = `
      <a class="event-detail-back" href="events.html">← All events</a>
      <article class="event-detail-card">
        <div class="event-detail-media">${imageHtml}</div>
        <div class="event-detail-content">
          <time datetime="${escapeHtml(selectedEvent.eventDate)}">${escapeHtml(eventDate)}</time>
          <h2>${escapeHtml(selectedEvent.title)}</h2>
          ${selectedEvent.location ? `<p class="event-detail-location"><strong>Location</strong><span>${escapeHtml(selectedEvent.location)}</span></p>` : ''}
          ${selectedEvent.description ? `<p class="event-detail-description">${escapeHtml(selectedEvent.description)}</p>` : '<p class="event-detail-description">More information about this event is not available.</p>'}
        </div>
      </article>
    `;
    eventsList.innerHTML = '';
    return;
  }

  eventDetail.innerHTML = requestedId
    ? '<p class="empty-state">That event could not be found. It may have been removed from the archive.</p>'
    : '';
  eventsStatus.textContent = pastEvents.length ? '' : 'No previous events have been added yet.';
  eventsList.innerHTML = pastEvents.map(event => {
    const eventDate = new Date(`${event.eventDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const imageHtml = event.eventImage
      ? `<img class="events-page-image" src="${escapeHtml(event.eventImage)}" alt="" loading="lazy" />`
      : '<div class="events-page-image-placeholder">Journal Club event</div>';
    return `
      <a class="events-page-card" href="events.html?id=${encodeURIComponent(event.id)}">
        <div class="events-page-card-media">${imageHtml}</div>
        <div class="events-page-card-content">
          <time datetime="${escapeHtml(event.eventDate)}">${escapeHtml(eventDate)}</time>
          <h2>${escapeHtml(event.title)}</h2>
          ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
          ${event.location ? `<span class="past-event-location">${escapeHtml(event.location)}</span>` : ''}
          <span class="past-event-link-label">Read event details <span aria-hidden="true">→</span></span>
        </div>
      </a>
    `;
  }).join('');
}

function renderAdminPastEvents() {
  if (!adminPastEventsList) return;
  if (!pastEventsLoaded) {
    adminPastEventsList.innerHTML = '<p class="empty-state">Loading past events...</p>';
    return;
  }
  if (pastEventsLoadError) {
    adminPastEventsList.innerHTML = '<p class="empty-state">Unable to load past events.</p>';
    return;
  }
  if (pastEvents.length === 0) {
    adminPastEventsList.innerHTML = '<p class="empty-state">No past events in the archive yet.</p>';
    return;
  }

  adminPastEventsList.innerHTML = pastEvents.map(event => `
    <div class="event-admin-item past-event-admin-item" data-past-event-id="${event.id}">
      <div class="event-admin-thumb">
        ${event.eventImage
          ? `<img src="${escapeHtml(event.eventImage)}" alt="${escapeHtml(event.title)}" class="event-admin-thumbnail" />`
          : '<div class="event-admin-thumbnail-placeholder">📷</div>'}
      </div>
      <div class="past-event-admin-content">
        <div class="event-admin-header">
          <div>
            <h4>${escapeHtml(event.title)}</h4>
            <p class="subtle">${escapeHtml(formatEventDate(event.eventDate))}</p>
            ${event.location ? `<p class="subtle">${escapeHtml(event.location)}</p>` : ''}
          </div>
          <div class="event-admin-actions">
            <button type="button" class="action-btn" data-past-event-action="edit" data-past-event-id="${event.id}">Edit</button>
            <button type="button" class="action-btn" data-past-event-action="delete" data-past-event-id="${event.id}">Delete</button>
          </div>
        </div>
        ${event.description ? `<p class="event-admin-description">${escapeHtml(event.description)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function resetPastEventForm() {
  if (!pastEventForm) return;
  pastEventForm.reset();
  document.getElementById('pastEventEditingId').value = '';
  editingPastEventImage = '';
  pastEventSubmitBtn.textContent = 'Add past event';
  cancelPastEventEdit.classList.add('hidden');
  pastEventImagePreview.innerHTML = '';
  pastEventImagePreview.classList.add('hidden');
}

async function savePastEvent() {
  const title = document.getElementById('pastEventTitle').value.trim();
  const eventDate = document.getElementById('pastEventDate').value;
  const location = document.getElementById('pastEventLocation').value.trim();
  const description = document.getElementById('pastEventDescription').value.trim();
  const editingId = document.getElementById('pastEventEditingId').value;
  const imageFile = pastEventImageInput.files[0];

  if (!title || !eventDate) {
    showAlert('Enter the event title and date.');
    return;
  }
  const supportedImageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (imageFile && (!supportedImageTypes.includes(imageFile.type) || imageFile.size > 8 * 1024 * 1024)) {
    showAlert('Choose a supported image under 8 MB.');
    return;
  }

  try {
    const eventImage = imageFile ? await readFileAsDataURL(imageFile) : editingPastEventImage;
    const response = await fetch(
      editingId ? `${API_BASE_URL}/api/past-events/${editingId}` : `${API_BASE_URL}/api/past-events`,
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, eventDate, location, description, eventImage })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      showAlert(error.error || 'Unable to save past event.');
      return;
    }

    showAlert(editingId ? 'Past event updated.' : 'Past event added.');
    resetPastEventForm();
    await fetchPastEvents();
  } catch (error) {
    console.error('Past event save error', error);
    showAlert('Unable to save past event.');
  }
}

function renderUpcomingEvents() {
  const upcomingEventsSection = document.getElementById('upcomingEventsSection');
  const upcomingEventsList = document.getElementById('upcomingEventsList');
  
  if (!upcomingEventsList) return;
  if (upcomingEventsSection) upcomingEventsSection.classList.remove('hidden');
  if (!upcomingEventsLoaded) return;

  if (upcomingEventsLoadError) {
    upcomingEventsList.innerHTML = '<p class="empty-state">Unable to load upcoming events. Please refresh the page to try again.</p>';
    return;
  }

  // Filter and sort events: only show future events
  const today = new Date().toISOString().split('T')[0];
  const futureEvents = upcomingEvents.filter(event => event.startDate >= today).sort((a, b) => {
    return new Date(a.startDate) - new Date(b.startDate);
  });

  if (futureEvents.length === 0) {
    upcomingEventsList.innerHTML = '<p class="empty-state">No upcoming events scheduled.</p>';
    return;
  }

    upcomingEventsList.innerHTML = futureEvents.map((event, index) => {
      const timeStr = event.startTime ? ` at ${event.startTime}` : '';
      const locationStr = event.location ? ` | 📍 ${escapeHtml(event.location)}` : '';
      const imageHtml = event.eventImage 
        ? `<div class="event-image-wrapper"><img src="${escapeHtml(event.eventImage)}" alt="${escapeHtml(event.title)}" class="event-image" /></div>`
        : '<div class="event-image-wrapper"><div class="event-image-placeholder">📷</div></div>';
    
      return `
        <div class="event-item" data-event-id="${event.id}">
          ${imageHtml}
          <div class="event-content">
            <div class="event-date">📅 ${escapeHtml(new Date(event.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</div>
            <h4>${escapeHtml(event.title)}</h4>
            ${event.description ? `<p class="event-description">${escapeHtml(event.description)}</p>` : ''}
            <div class="event-meta">
              <span class="event-time">${escapeHtml(formatEventDate(event.startDate, event.startTime))}</span>${locationStr}
            </div>
          </div>
        </div>
      `;
    }).join('');
}

function renderAdminEventsList() {
  const eventsList = document.getElementById('eventsList');
  if (!eventsList) return;

  if (upcomingEvents.length === 0) {
    eventsList.innerHTML = '<p class="empty-state">No events created yet.</p>';
    return;
  }

  eventsList.innerHTML = upcomingEvents.map(event => {
    const timeStr = event.startTime ? ` at ${event.startTime}` : '';
    return `
      <div class="event-admin-item" data-event-id="${Number(event.id)}">
        <div class="event-admin-header">
          <div>
            <h4>${escapeHtml(event.title)}</h4>
            <p class="subtle">${escapeHtml(formatEventDate(event.startDate, event.startTime))}</p>
            ${event.location ? `<p class="subtle">📍 ${escapeHtml(event.location)}</p>` : ''}
          </div>
          <div class="event-admin-actions">
            <button class="action-btn" data-action="edit-event" data-event-id="${event.id}">Edit</button>
            <button class="action-btn" data-action="delete-event" data-event-id="${event.id}">Delete</button>
          </div>
        </div>
        ${event.description ? `<p class="event-admin-description">${escapeHtml(event.description)}</p>` : ''}
      </div>
    `;
  }).join('');

  // Add event listeners to edit and delete buttons
  const eventsList_admin = document.getElementById('eventsList');
    eventsList.innerHTML = upcomingEvents.map(event => {
      const timeStr = event.startTime ? ` at ${event.startTime}` : '';
      const imageThumb = event.eventImage 
        ? `<img src="${escapeHtml(event.eventImage)}" alt="${escapeHtml(event.title)}" class="event-admin-thumbnail" />`
        : '<div class="event-admin-thumbnail-placeholder">📷</div>';
      return `
        <div class="event-admin-item" data-event-id="${Number(event.id)}">
          <div class="event-admin-thumb">
            ${imageThumb}
          </div>
          <div class="event-admin-header">
            <div>
              <h4>${escapeHtml(event.title)}</h4>
              <p class="subtle">${escapeHtml(formatEventDate(event.startDate, event.startTime))}</p>
              ${event.location ? `<p class="subtle">📍 ${escapeHtml(event.location)}</p>` : ''}
            </div>
            <div class="event-admin-actions">
              <button class="action-btn" data-action="edit-event" data-event-id="${event.id}">Edit</button>
              <button class="action-btn" data-action="delete-event" data-event-id="${event.id}">Delete</button>
            </div>
          </div>
          ${event.description ? `<p class="event-admin-description">${escapeHtml(event.description)}</p>` : ''}
        </div>
      `;
    }).join('');

  if (eventsList_admin) {
    eventsList_admin.addEventListener('click', async (e) => {
      const button = e.target.closest('button');
      if (!button) return;

      const action = button.dataset.action;
      const eventId = button.dataset.eventId;

      if (action === 'edit-event') {
        const event = upcomingEvents.find(e => e.id == eventId);
        if (event) {
          document.getElementById('eventTitle').value = event.title;
          document.getElementById('eventDescription').value = event.description || '';
          document.getElementById('eventStartDate').value = event.startDate;
          document.getElementById('eventEndDate').value = event.endDate || '';
          document.getElementById('eventStartTime').value = event.startTime || '';
          document.getElementById('eventEndTime').value = event.endTime || '';
          document.getElementById('eventLocation').value = event.location || '';
          document.getElementById('eventEditingId').value = eventId;
          document.getElementById('eventSubmitBtn').textContent = 'Update Event';
          window.scrollTo(0, 0);
        }
      } else if (action === 'delete-event') {
        if (confirm('Are you sure you want to delete this event?')) {
          await deleteEvent(eventId);
        }
      }
    });
  }
}

async function saveEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  const description = document.getElementById('eventDescription').value.trim();
  const startDate = document.getElementById('eventStartDate').value;
  const endDate = document.getElementById('eventEndDate').value;
  const startTime = document.getElementById('eventStartTime').value;
  const endTime = document.getElementById('eventEndTime').value;
  const location = document.getElementById('eventLocation').value.trim();
  const eventId = document.getElementById('eventEditingId').value;

  if (!title || !startDate) {
    showAlert('Please fill in the event title and start date.');
    return;
  }

  try {
    const method = eventId ? 'PUT' : 'POST';
    const url = eventId ? `${API_BASE_URL}/api/events/${eventId}` : `${API_BASE_URL}/api/events`;
    
    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        startDate,
        endDate: endDate || startDate,
        startTime,
        endTime,
        location,
        createdBy: session.name || 'Admin'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      showAlert(error.error || 'Unable to save event.');
      return;
    }

    showAlert(eventId ? 'Event updated successfully.' : 'Event added successfully.');
    
    // Reset form
    document.getElementById('eventForm').reset();
    document.getElementById('eventEditingId').value = '';
    document.getElementById('eventSubmitBtn').textContent = 'Add Event';

    await fetchUpcomingEvents();
  } catch (error) {
    console.error('Event save error', error);
    showAlert('Unable to save event.');
  }
}

async function deleteEvent(eventId) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/events/${eventId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const error = await response.json();
      showAlert(error.error || 'Unable to delete event.');
      return;
    }

    showAlert('Event deleted successfully.');
    await fetchUpcomingEvents();
  } catch (error) {
    console.error('Event delete error', error);
    showAlert('Unable to delete event.');
  }
}

const eventForm = document.getElementById('eventForm');
if (eventForm) {
  eventForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (session.type !== 'admin') {
      showAlert('Only admin can manage events.');
      return;
    }
    await saveEvent();
  });
}

if (pastEventForm) {
  pastEventForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (session.type !== 'admin') {
      showAlert('Only admin can manage past events.');
      return;
    }
    await savePastEvent();
  });
}

if (pastEventImageInput) {
  pastEventImageInput.addEventListener('change', async () => {
    const file = pastEventImageInput.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)
      || file.size > 8 * 1024 * 1024) {
      pastEventImageInput.value = '';
      showAlert('Choose a supported image under 8 MB.');
      return;
    }
    try {
      const imageData = await readFileAsDataURL(file);
      pastEventImagePreview.innerHTML = `<img src="${imageData}" alt="Past event image preview" />`;
      pastEventImagePreview.classList.remove('hidden');
    } catch (error) {
      console.error('Past event image preview failed', error);
      showAlert('Unable to preview this image.');
    }
  });
}

if (cancelPastEventEdit) {
  cancelPastEventEdit.addEventListener('click', resetPastEventForm);
}

if (adminPastEventsList) {
  adminPastEventsList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-past-event-action]');
    if (!button) return;
    const eventId = button.dataset.pastEventId;
    const pastEvent = pastEvents.find(item => String(item.id) === eventId);
    if (!pastEvent) return;

    if (button.dataset.pastEventAction === 'edit') {
      document.getElementById('pastEventTitle').value = pastEvent.title;
      document.getElementById('pastEventDate').value = pastEvent.eventDate;
      document.getElementById('pastEventLocation').value = pastEvent.location || '';
      document.getElementById('pastEventDescription').value = pastEvent.description || '';
      document.getElementById('pastEventEditingId').value = pastEvent.id;
      editingPastEventImage = pastEvent.eventImage || '';
      pastEventImageInput.value = '';
      pastEventSubmitBtn.textContent = 'Save changes';
      cancelPastEventEdit.classList.remove('hidden');
      pastEventImagePreview.innerHTML = editingPastEventImage
        ? `<img src="${escapeHtml(editingPastEventImage)}" alt="${escapeHtml(pastEvent.title)} image preview" />`
        : '';
      pastEventImagePreview.classList.toggle('hidden', !editingPastEventImage);
      pastEventForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (button.dataset.pastEventAction === 'delete' && confirm('Delete this past event from the archive?')) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/past-events/${eventId}`, { method: 'DELETE' });
        if (!response.ok) {
          const error = await response.json();
          showAlert(error.error || 'Unable to delete past event.');
          return;
        }
        if (document.getElementById('pastEventEditingId').value === eventId) {
          resetPastEventForm();
        }
        showAlert('Past event deleted.');
        await fetchPastEvents();
      } catch (error) {
        console.error('Past event delete error', error);
        showAlert('Unable to delete past event.');
      }
    }
  });
}

['pastEventSearch', 'pastEventFrom', 'pastEventTo'].forEach(id => {
  const input = document.getElementById(id);
  if (input) input.addEventListener('input', renderPastEvents);
});

const clearPastEventFilters = document.getElementById('clearPastEventFilters');
if (clearPastEventFilters) {
  clearPastEventFilters.addEventListener('click', () => {
    document.getElementById('pastEventSearch').value = '';
    document.getElementById('pastEventFrom').value = '';
    document.getElementById('pastEventTo').value = '';
    renderPastEvents();
  });
}

// Handle navbar buttons - check if they exist and add event listeners
const navBtnNewMember = document.getElementById('btnNewMember');
const navBtnMemberLogin = document.getElementById('btnMemberLogin');
const navBtnAdminLogin = document.getElementById('btnAdminLogin');

if (navBtnNewMember) {
  navBtnNewMember.addEventListener('click', () => {
    if (typeof setPanel === 'function') {
      setPanel('member-register');
    } else {
      window.location.href = 'index.html#register';
    }
  });
}

if (btnSearchArticles) {
  btnSearchArticles.addEventListener('click', () => {
    if (window.location.pathname.split('/').pop() === 'index.html' || window.location.pathname.split('/').pop() === '') {
      if (typeof setPanel === 'function') setPanel('home');
      if (searchInput) {
        searchInput.focus();
      }
    } else {
      window.location.href = 'index.html';
    }
  });
}

if (navBtnMemberLogin) {
  navBtnMemberLogin.addEventListener('click', () => {
    if (panels.length > 0) {
      setPanel('member-login');
    } else {
      window.location.href = 'index.html#login';
    }
  });
}

if (btnGoToRegister) {
  btnGoToRegister.addEventListener('click', () => setPanel('member-register'));
}

const btnGoToLogin = document.getElementById('btnGoToLogin');
if (btnGoToLogin) {
  btnGoToLogin.addEventListener('click', () => setPanel('member-login'));
}

if (navBtnAdminLogin) {
  navBtnAdminLogin.addEventListener('click', () => {
    if (panels.length > 0) {
      setPanel('admin');
    } else {
      window.location.href = 'index.html#admin';
    }
  });
}

backButtons.forEach(button => {
  button.addEventListener('click', () => setPanel(button.dataset.panel));
});

// Global click handler to toggle glow on clicked buttons and links
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button, .nav-link, .portfolio-link');
  if (!btn) return;

  // Remove existing glow from any element
  document.querySelectorAll('.is-glowing').forEach(el => el.classList.remove('is-glowing'));

  // Add role-based dataset for nav links if not present (used by CSS selection)
  if (btn.classList.contains('nav-link')) {
    // mark nav-link with data-role if it contains 'admin' or 'member' keywords
    if (btn.textContent && /admin/i.test(btn.textContent)) btn.dataset.role = 'admin';
    else if (btn.textContent && /member|register|login/i.test(btn.textContent)) btn.dataset.role = 'member';
  }

  // Add glow class to the clicked element
  btn.classList.add('is-glowing');
});

// Preserve existing behavior: initialize app state
// Mark nav links active based on current URL, and ensure clicked nav links become active
const navLinks = document.querySelectorAll('.nav-link');
if (navLinks && navLinks.length) {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  navLinks.forEach(link => {
    const href = link.getAttribute('href') || '';
    if (href.endsWith(current) || (current === '' && href.includes('index.html'))) {
      link.classList.add('active');
      link.classList.add('is-glowing');
    }
    link.addEventListener('click', () => {
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
}
function getPanelFromHash() {
  const hash = window.location.hash.toLowerCase();
  switch (hash) {
    case '#register':
      return 'member-register';
    case '#login':
      return 'member-login';
    case '#admin':
      return 'admin';
    default:
      return null;
  }
}

function restorePanelFromHash() {
  const targetPanel = getPanelFromHash();
  if (targetPanel && panels.length > 0) {
    setPanel(targetPanel);
  }
}

loadSettings();
fetchArticles();
fetchUpcomingEvents();
fetchPastEvents();
renderUI();
restorePanelFromHash();
restoreAdminSession();
restoreMemberSession();

// Achievement counters: animate numbers from 0 to target when visible
function animateCount(el, target, suffix) {
  const duration = 3000;
  let start = null;
  const startVal = 0;
  // add movement class for the duration of the animation
  el.classList.add('count-anim');
  const step = (timestamp) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);
    const value = Math.floor(progress * (target - startVal) + startVal);
    el.textContent = value + (suffix || '');
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = target + (suffix || '');
      // ensure movement class is removed after animation completes
      setTimeout(() => el.classList.remove('count-anim'), 200);
    }
  };
  requestAnimationFrame(step);
}

function startAchievementCountersOnce() {
  const counts = document.querySelectorAll('.achievement-number .count');
  if (!counts || counts.length === 0) return;
  counts.forEach(el => {
    if (el.dataset.animated) return;
    const target = parseInt(el.dataset.target, 10) || 0;
    const suffix = el.dataset.suffix || '';
    animateCount(el, target, suffix);
    el.dataset.animated = '1';
  });
}

const achievementsSection = document.querySelector('.achievements-section');
if (achievementsSection) {
  const obs = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        startAchievementCountersOnce();
        observer.disconnect();
      }
    });
  }, { threshold: 0.25 });
  obs.observe(achievementsSection);
  // Only start the animation immediately if the achievements section is already visible on load.
  if (achievementsSection.getBoundingClientRect().top < window.innerHeight) {
    startAchievementCountersOnce();
  }
}
window.handleGoogleCredentialResponse = async function (response) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Google sign-in failed.');
      return;
    }
    session = { type: 'member', name: data.name, email: data.email };
    saveState();
    renderUI();
    setPanel('member-dashboard');
  } catch (err) {
    console.error('Google login error:', err);
    alert('Unable to reach server for Google sign-in.');
  }
};
function initGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    setTimeout(initGoogleSignIn, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: '1087606608620-lrp0j7413pmopt4q0s5cmr1p1u8dcabj.apps.googleusercontent.com',
    callback: window.handleGoogleCredentialResponse
  });

  const signInContainer = document.getElementById('googleSignInBtn');
  if (signInContainer) {
    google.accounts.id.renderButton(signInContainer, {
      theme: 'filled_black',
      size: 'large',
      type: 'standard',
      shape: 'pill',
      text: 'continue_with',
      width: 280
    });
  }

  const signUpContainer = document.getElementById('googleSignUpBtn');
  if (signUpContainer) {
    google.accounts.id.renderButton(signUpContainer, {
      theme: 'filled_black',
      size: 'large',
      type: 'standard',
      shape: 'pill',
      text: 'signup_with',
      width: 280
    });
  }
}

initGoogleSignIn();
