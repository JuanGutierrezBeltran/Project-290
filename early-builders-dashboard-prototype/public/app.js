'use strict';

const i18n = {
  es: {
    workspace:'ESPACIO DE TRABAJO',overview:'Resumen',builders:'Builders',invites:'Invitaciones',sources:'Fuentes de datos',demoMode:'Modo de demostración',readOnly:'Solo lectura',programs:'Programas',programTitle:'Early Builders',period:'Periodo',allTime:'Todo el periodo',refresh:'Actualizar',demoBannerTitle:'Prototipo con datos simulados',demoBannerText:'No hay conexiones activas a HubSpot, PostHog ni al portal.',signupGoal:'Meta de cierre · inscritos',capacity:'Capacidad aprobada',accounts:'cuentas',separateTarget:'Indicador separado de la meta de cierre',ceoGoal:'Meta de CEO',pending:'Pendiente',notConfirmed:'Aún no confirmada',signupCount:'meta de inscritos',funnelTitle:'Embudo de invitaciones e inscripción',funnelSub:'Cada etapa conserva su fuente y denominador.',builderProgress:'Progreso de builders',builderProgressSub:'Builder activo = proyecto real y una pieza de contenido publicada.',viewAll:'Ver todos',needsFollowup:'Necesitan seguimiento',followupSub:'Tiempo contado desde la carga de créditos, si hay fecha disponible.',builder:'Builder',stage:'Etapa',day0:'Día 0 · créditos',project:'Proyecto',content:'Contenido',day14:'Día 14',openList:'Abrir lista',buildersDetail:'Seguimiento de inscripción, actividad, créditos y entregables.',allStages:'Todas las etapas',profile:'Perfil',signup:'Registro',credits:'Créditos',activity:'Actividad',referral:'Referido / canal',invitationFlow:'Flujo de invitaciones',invitationDetail:'La lista unificada precede al formulario de inscripción de HubSpot.',sourceRule:'Regla de fuente',sourceRuleText:'Los estados de correo se mostrarán como automáticos solo después de validar la conexión. El prototipo no simula un envío o una respuesta real.',sourcesSub:'Estado del prototipo y datos necesarios para cada conexión.',privacy:'Seguridad',privacyText:'Las credenciales deben vivir en el servicio, nunca en el frontend, el repositorio o los archivos de datos.',prototypeFooter:'Prototipo local · sin datos reales ni sincronización',search:'Buscar ID o referido',projectYes:'Creado',projectNo:'Pendiente',contentYes:'Publicado',contentNo:'Pendiente',noDay0:'Sin fecha',days:'días',noBuilders:'No hay builders con esos filtros.',syncDemo:'Este prototipo no sincroniza. La conexión requiere credenciales del servicio.',updated:'Corte demo',invited:'Contactados',sent:'Correo enviado',delivered:'Recibido',responded:'Respondió',accepted:'Aceptó',signedUp:'Inscrito',fromStart:'del inicio',conversion:'conversión',in14:'Dentro de 14 días',active:'Activos',missingContent:'Falta contenido',missingProject:'Falta proyecto',daysSince:'Días desde asignación',followup:'Seguimiento',channel:'Canal',lastLogin:'Último ingreso',countSignins:'Ingresos',connectionPending:'Pendiente',connectionManual:'Manual',connected:'Conectado',
    accessFull:'Acceso completo',accessPseudonymous:'Seudónimo',accessNone:'Solo agregados',restricted:'Detalle restringido para tu rol',restrictedText:'Tu rol solo ve cifras agregadas; los registros individuales no se envían a este navegador.',channelsTitle:'Desglose por canal',signInTitle:'Inicio de sesión requerido',signInText:'Este tablero requiere una sesión de Think4Ever. Inicia sesión con el SSO de tu organización.',devLoginText:'Modo desarrollo: elige un rol local para probar el acceso:',forbiddenText:'Tu rol no tiene acceso a este tablero.',authNotConfigured:'La autenticación del servidor no está configurada; la API permanece bloqueada.',loadError:'No se pudieron cargar los datos de demostración. Inicia el servidor desde la carpeta del prototipo.'
  },
  en: {
    workspace:'WORKSPACE',overview:'Overview',builders:'Builders',invites:'Invitations',sources:'Data sources',demoMode:'Demo mode',readOnly:'Read only',programs:'Programs',programTitle:'Early Builders',period:'Period',allTime:'All time',refresh:'Refresh',demoBannerTitle:'Prototype with simulated data',demoBannerText:'No active connections to HubSpot, PostHog, or the portal.',signupGoal:'Close target · sign-ups',capacity:'Approved capacity',accounts:'accounts',separateTarget:'Separate indicator from the close target',ceoGoal:'CEO target',pending:'Pending',notConfirmed:'Not confirmed yet',signupCount:'sign-up target',funnelTitle:'Invitation and enrollment funnel',funnelSub:'Each stage keeps its source and denominator.',builderProgress:'Builder progress',builderProgressSub:'Active builder = real project and one published content piece.',viewAll:'View all',needsFollowup:'Needs follow-up',followupSub:'Time starts at credit grant, when the date is available.',builder:'Builder',stage:'Stage',day0:'Day 0 · credits',project:'Project',content:'Content',day14:'Day 14',openList:'Open list',buildersDetail:'Enrollment, activity, credits, and deliverables.',allStages:'All stages',profile:'Profile',signup:'Sign-up',credits:'Credits',activity:'Activity',referral:'Referral / channel',invitationFlow:'Invitation flow',invitationDetail:'The unified prospect list precedes the HubSpot enrollment form.',sourceRule:'Source rule',sourceRuleText:'Email states will be marked automatic only after the connection is validated. The prototype does not simulate a real send or reply.',sourcesSub:'Prototype state and required data for each connection.',privacy:'Security',privacyText:'Credentials belong in the service, never in the frontend, repository, or data files.',prototypeFooter:'Local prototype · no real data or synchronization',search:'Search ID or referral',projectYes:'Created',projectNo:'Pending',contentYes:'Published',contentNo:'Pending',noDay0:'No date',days:'days',noBuilders:'No builders match those filters.',syncDemo:'This prototype does not sync. Connection requires service credentials.',updated:'Demo cutoff',invited:'Contacted',sent:'Email sent',delivered:'Received',responded:'Replied',accepted:'Accepted',signedUp:'Enrolled',fromStart:'of start',conversion:'conversion',in14:'Within 14 days',active:'Active',missingContent:'Content missing',missingProject:'Project missing',daysSince:'Days since grant',followup:'Follow-up',channel:'Channel',lastLogin:'Last sign-in',countSignins:'Sign-ins',connectionPending:'Pending',connectionManual:'Manual',connected:'Connected',
    accessFull:'Full access',accessPseudonymous:'Pseudonymous',accessNone:'Aggregates only',restricted:'Detail restricted for your role',restrictedText:'Your role sees aggregate figures only; individual records are not sent to this browser.',channelsTitle:'Channel breakdown',signInTitle:'Sign-in required',signInText:'This dashboard requires a Think4Ever session. Sign in with your organization SSO.',devLoginText:'Development mode: pick a local role to test access:',forbiddenText:'Your role does not have access to this dashboard.',authNotConfigured:'Server authentication is not configured; the API stays locked.',loadError:'Could not load the demo data. Start the server from the prototype folder.'
  }
};

const Core = window.DashboardCore;

let language = 'es';
let data;
let activeView = 'overview';
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tr = (key) => i18n[language][key] || key;
const num = (value) => Number(value || 0).toLocaleString();
const hasRecords = () => Array.isArray(data && data.builders);
const dayOf = (date) => Core.dayNumber(date, data.snapshotAt);

async function loadData() {
  const response = await fetch('api/dashboard', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (response.status === 401) return showSignIn(await response.json().catch(() => ({})));
  if (response.status === 403) return showMessage(`<span>${esc(tr('forbiddenText'))}</span>`);
  if (response.status === 503) return showMessage(`<span>${esc(tr('authNotConfigured'))}</span>`);
  if (!response.ok) throw new Error('No se pudo cargar la demo');
  data = await response.json();
  render();
}

function showMessage(html) {
  document.querySelector('.content').innerHTML = `<div class="demo-banner">${html}</div>`;
}

function showSignIn(info) {
  const roles = info && info.devLogin && Array.isArray(info.roles) ? info.roles : [];
  const links = roles.length
    ? `<span> ${esc(tr('devLoginText'))} ${roles.map((r) => `<a href="auth/dev-login?role=${encodeURIComponent(r.id)}">${esc(r.label)}</a>`).join(' · ')}</span>`
    : '';
  showMessage(`<span class="demo-icon">i</span><span><strong>${esc(tr('signInTitle'))}</strong> <span>${esc(tr('signInText'))}</span>${links}</span>`);
}

function restrictedRow(columns) {
  return `<tr><td colspan="${columns}"><strong>${esc(tr('restricted'))}</strong><span class="email">${esc(tr('restrictedText'))}</span></td></tr>`;
}

function statusClass(stage) {
  return stage === 'Activo' ? 'status-active' : stage === 'En progreso' ? 'status-progress' : stage === 'Invitado' ? 'status-invited' : 'status-pending';
}

function stageLabel(stage) {
  if (language === 'es') return stage;
  return ({ 'Activo': 'Active', 'En progreso': 'In progress', 'Invitado': 'Invited', 'Inscrito': 'Enrolled' })[stage] || stage;
}

function renderFunnel() {
  $('#funnel').innerHTML = Core.funnelSteps(data.funnel).map((step) => {
    const rate = step.conversion == null ? 100 : step.conversion;
    return `<article class="funnel-step"><div class="funnel-title">${esc(tr(step.key))}</div><div class="funnel-number">${step.value.toLocaleString()}</div><div class="funnel-rate">${rate}% ${esc(step.conversion == null ? tr('fromStart') : tr('conversion'))}</div><div class="funnel-bar"><span style="width:${step.percentOfStart}%"></span></div></article>`;
  }).join('');
}

function rowMarkup(person, detail = false) {
  const day = dayOf(person.creditsGrantedAt);
  const project = Core.hasProject(person);
  const published = Core.isPublished(person);
  const progress = Core.dayProgress(day);
  const core = `<span class="builder-id">${esc(person.id)}</span>${person.email ? `<span class="email">${esc(person.email)}</span>` : ''}`;
  if (!detail) {
    return `<tr><td>${core}</td><td><span class="status-pill ${statusClass(person.stage)}">${esc(stageLabel(person.stage))}</span></td><td>${person.creditsGrantedAt ? `${esc(person.creditsGrantedAt)}<span class="email">${day} ${esc(tr('days'))}</span>` : esc(tr('noDay0'))}</td><td><span class="status-pill ${project ? 'status-active' : 'status-pending'}">${project ? esc(tr('projectYes')) : esc(tr('projectNo'))}</span></td><td><span class="status-pill ${published ? 'status-active' : 'status-pending'}">${published ? esc(tr('contentYes')) : esc(tr('contentNo'))}</span></td><td>${day == null ? '—' : `<div class="day-track"><span>${day}/14</span><span class="mini-track"><span style="width:${progress}%"></span></span></div>`}</td></tr>`;
  }
  return `<tr><td>${core}</td><td>${esc(person.profile)}</td><td><span class="status-pill ${statusClass(person.stage)}">${esc(stageLabel(person.stage))}</span></td><td>${person.signedUpAt ? esc(person.signedUpAt) : '—'}</td><td>${person.credits ? num(person.credits) : '—'}<span class="email">${num(person.creditsUsed)} ${language === 'es' ? 'usados' : 'used'}</span></td><td>${esc(person.projects)} ${esc(tr('project').toLowerCase())}<span class="email">${esc(person.signIns)} ${esc(tr('countSignins').toLowerCase())} · ${esc(person.lastSignIn || '—')}</span></td><td>${esc(person.refKey)}<span class="email">${esc(person.channel)}</span></td></tr>`;
}

function renderSummary() {
  const progress = Core.signupProgress(data.funnel, data.program.signupTarget);
  $('#signup-total').textContent = progress.total.toLocaleString();
  $('#signup-goal').textContent = progress.target.toLocaleString();
  $('#capacity-total').textContent = num(data.program.accountCapacity);
  $('#signup-progress').style.width = `${progress.percent}%`;
  $('#signup-progress-text').textContent = `${progress.percent}% ${language === 'es' ? 'completado' : 'complete'}`;
  $('#updated-label').textContent = `${tr('updated')}: ${new Intl.DateTimeFormat(language === 'es' ? 'es-CO' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }).format(new Date(data.snapshotAt))}`;
  renderFunnel();

  const s = data.summary || Core.summarizeBuilders(data.builders || [], data.snapshotAt);
  const cards = [
    [tr('active'), s.active, tr('builderProgressSub')],
    [tr('in14'), s.within14, `${s.granted} ${language === 'es' ? 'con créditos asignados' : 'with credits granted'}`],
    [tr('missingContent'), s.missingContent, tr('contentNo')],
    [tr('missingProject'), s.missingProject, tr('projectNo')],
  ];
  $('#summary-cards').innerHTML = cards.map(([label, value, foot]) => `<article class="summary-card"><div class="summary-label">${esc(label)}</div><div class="summary-value">${esc(value)}</div><div class="summary-foot">${esc(foot)}</div></article>`).join('');

  if (!hasRecords()) {
    $('#followup-table').innerHTML = restrictedRow(6);
    return;
  }
  const followups = Core.followUps(data.builders);
  $('#followup-table').innerHTML = followups.length ? followups.map((b) => rowMarkup(b)).join('') : `<tr><td colspan="6">${esc(tr('noBuilders'))}</td></tr>`;
}

function renderBuilders() {
  const controls = $('.table-controls');
  if (!hasRecords()) {
    if (controls) controls.style.display = 'none';
    const channels = (data.channels || []).map((c) => `<tr><td colspan="7"><strong>${esc(c.channel)}</strong><span class="email">${esc(tr('builders'))}: ${esc(c.total)} · ${esc(tr('signedUp'))}: ${esc(c.signedUp)} · ${esc(tr('active'))}: ${esc(c.active)}</span></td></tr>`).join('');
    $('#builders-table').innerHTML = restrictedRow(7) + (channels ? `<tr><td colspan="7"><strong>${esc(tr('channelsTitle'))}</strong></td></tr>${channels}` : '');
    $('#builder-count').textContent = data.summary ? data.summary.total : 0;
    return;
  }
  if (controls) controls.style.display = '';
  const filter = $('#builder-filter');
  const selected = filter.value || 'all';
  const stages = Core.stagesOf(data.builders);
  filter.innerHTML = `<option value="all">${esc(tr('allStages'))}</option>` + stages.map((stage) => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('');
  filter.value = stages.includes(selected) ? selected : 'all';
  const rows = Core.filterBuilders(data.builders, { search: $('#builder-search').value, stage: filter.value });
  $('#builders-table').innerHTML = rows.length ? rows.map((b) => rowMarkup(b, true)).join('') : `<tr><td colspan="7">${esc(tr('noBuilders'))}</td></tr>`;
  $('#builder-count').textContent = data.builders.length;
}

function renderInvitations() {
  $('#invitation-cards').innerHTML = Core.funnelSteps(data.funnel).map((step) => `<article class="invite-card"><div class="invite-label">${esc(tr(step.key))}</div><div class="invite-value">${step.value.toLocaleString()}</div><div class="invite-sub">${step.conversion == null ? (language === 'es' ? 'lista de demo' : 'demo list') : `${step.conversion}% ${esc(tr('conversion'))}`}</div></article>`).join('');
}

function renderSources() {
  $('#source-grid').innerHTML = data.sources.map((source) => `<article class="source-card"><div class="source-top"><strong>${esc(source.name)}</strong><span class="source-state">${esc(tr(source.state === 'Manual' ? 'connectionManual' : source.state === 'Conectado' ? 'connected' : 'connectionPending'))}</span></div><div class="source-purpose">${esc(source.purpose)}</div><div class="source-meta"><span>${language === 'es' ? 'Método' : 'Method'}</span><b>${esc(source.method)}</b><span>${language === 'es' ? 'Última carga' : 'Last load'}</span><b>${esc(source.lastSync)}</b><span>${language === 'es' ? 'Necesita' : 'Needs'}</span><b>${esc(source.needs)}</b></div></article>`).join('');
}

function renderProfile() {
  if (!data || !data.access) return;
  const label = data.access.label || data.access.role;
  const accessKey = data.access.recordAccess === 'full' ? 'accessFull' : data.access.recordAccess === 'pseudonymous' ? 'accessPseudonymous' : 'accessNone';
  const initial = String(label).charAt(0).toUpperCase();
  $('#profile-role').textContent = label;
  $('#profile-access').textContent = `${tr('readOnly')} · ${tr(accessKey)}`;
  $('#profile-avatar').textContent = initial;
  $('#profile-avatar-small').textContent = initial;
}

function translatePage() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = tr(node.dataset.i18n); });
  $('#builder-search').placeholder = tr('search');
  const titles = { overview: language === 'es' ? 'Seguimiento del programa' : 'Program overview', builders: tr('builders'), invitations: tr('invites'), sources: tr('sources') };
  $('#page-title').textContent = titles[activeView];
  $('#page-subtitle').textContent = activeView === 'overview' ? (language === 'es' ? 'Invitaciones, registros y progreso de builders en Colombia.' : 'Invitations, sign-ups, and builder progress in Colombia.') : '';
  $('#snapshot-label').textContent = language === 'es' ? 'Datos de demostración' : 'Demo data';
  renderProfile();
}

function render() {
  translatePage();
  renderSummary();
  renderBuilders();
  renderInvitations();
  renderSources();
  document.querySelectorAll('.view-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== `view-${activeView}`));
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]');
  const goButton = event.target.closest('[data-go]');
  if ((viewButton || goButton) && data) {
    activeView = (viewButton || goButton).dataset.view || (viewButton || goButton).dataset.go;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (event.target.closest('#refresh')) showToast(tr('syncDemo'));
  if (event.target.closest('.banner-close')) event.target.closest('.demo-banner').remove();
});
$('#language').addEventListener('change', (event) => { language = event.target.value; if (data) render(); });
$('#builder-search').addEventListener('input', () => { if (data) renderBuilders(); });
$('#builder-filter').addEventListener('change', () => { if (data) renderBuilders(); });
$('#period').addEventListener('change', () => showToast(language === 'es' ? 'Este prototipo mantiene conteos fijos para el periodo seleccionado.' : 'This prototype keeps fixed counts for the selected range.'));

loadData().catch(() => {
  showMessage(esc(tr('loadError')));
});
