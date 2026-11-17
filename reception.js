(function () {
  const AUTO_REFRESH_MS = 60000;
  const STATUS_LABELS = {
    pending: 'Pending payment', booked: 'Booked', arrived: 'Arrived', done: 'Done', no_show: 'No-show'
  };
  const ACTIONS = [
    { status: 'arrived', label: 'Arrived' },
    { status: 'done', label: 'Done' },
    { status: 'no_show', label: 'No-show' }
  ];

  const $ = id => document.getElementById(id);
  const loginView = $('login-view');
  const dashView = $('dash-view');
  const logoutBtn = $('logout');
  const groupsEl = $('groups');
  const dashError = $('dash-error');
  let timer = null;

  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const formatTime = dt => {
    const [h, m] = dt.slice(11, 16).split(':').map(Number);
    return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.endsWith('/login')) {
      showLogin();
      throw new Error(data.error || 'Please log in.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function showLogin() {
    clearInterval(timer);
    dashView.hidden = true;
    logoutBtn.hidden = true;
    loginView.hidden = false;
    $('login-form').elements.password.focus();
  }

  function showDashboard() {
    loginView.hidden = true;
    dashView.hidden = false;
    logoutBtn.hidden = false;
    load();
    clearInterval(timer);
    timer = setInterval(load, AUTO_REFRESH_MS);
  }

  function render(data) {
    const { date, count, doctors, appointments } = data;
    $('count').textContent = count;
    const [y, mo, d] = date.split('-').map(Number);
    $('today').textContent = new Date(y, mo - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const tally = appointments.reduce((t, a) => ((t[a.status] = (t[a.status] || 0) + 1), t), {});
    $('stats').innerHTML = ['booked', 'arrived', 'done', 'no_show', 'pending']
      .filter(s => tally[s])
      .map(s => `<li><span class="badge badge-${s.replace('_', '-')}">${STATUS_LABELS[s]}</span> ${tally[s]}</li>`)
      .join('') || '<li class="muted">No appointments yet</li>';

    groupsEl.innerHTML = Object.entries(doctors).map(([specialty, doctor]) => {
      const list = appointments.filter(a => a.doctor === doctor);
      const rows = list.map(a => `
        <tr class="rx-row status-${a.status}">
          <td class="rx-time" data-label="Time">${formatTime(a.appointment_datetime)}</td>
          <td class="rx-patient" data-label="Patient">
            <strong>${escapeHtml(a.patient_name)}</strong>
            <span class="muted">${escapeHtml(a.patient_phone)}</span>
          </td>
          <td data-label="Specialty">${escapeHtml(a.specialty)}</td>
          <td data-label="Status"><span class="badge badge-${a.status.replace('_', '-')}">${STATUS_LABELS[a.status] || escapeHtml(a.status)}</span></td>
          <td class="rx-actions" data-label="Update">
            ${ACTIONS.map(x => `<button type="button" class="rx-btn rx-${x.status.replace('_', '-')}${a.status === x.status ? ' is-active' : ''}"
                data-id="${escapeHtml(a.id)}" data-status="${x.status}" aria-pressed="${a.status === x.status}">${x.label}</button>`).join('')}
          </td>
        </tr>`).join('');
      return `<section class="rx-group">
        <header class="rx-group-head">
          <div>
            <h2>${escapeHtml(doctor)}</h2>
            <p class="muted">${escapeHtml(specialty)}</p>
          </div>
          <span class="rx-group-count">${list.length} ${list.length === 1 ? 'appointment' : 'appointments'}</span>
        </header>
        ${list.length ? `<table class="rx-table">
          <thead><tr><th>Time</th><th>Patient</th><th>Specialty</th><th>Status</th><th>Update</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : '<p class="rx-empty muted">No appointments today.</p>'}
      </section>`;
    }).join('');

    $('updated').textContent = `Last updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · refreshes every minute`;
  }

  async function load() {
    dashError.textContent = '';
    try {
      render(await api('/api/reception/today'));
    } catch (e) {
      if (!loginView.hidden) return;
      dashError.textContent = e.message;
    }
  }

  groupsEl.addEventListener('click', async e => {
    const btn = e.target.closest('.rx-btn');
    if (!btn || btn.classList.contains('is-active')) return;
    dashError.textContent = '';
    btn.closest('.rx-actions').querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      await api(`/api/reception/appointments/${encodeURIComponent(btn.dataset.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: btn.dataset.status })
      });
      await load();
    } catch (err) {
      dashError.textContent = err.message;
      btn.closest('.rx-actions').querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  });

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type=submit]');
    const err = $('login-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/api/reception/login', { method: 'POST', body: JSON.stringify({ password: form.elements.password.value }) });
      form.reset();
      showDashboard();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await api('/api/reception/logout', { method: 'POST', body: '{}' }).catch(() => {});
    showLogin();
  });

  $('refresh').addEventListener('click', load);

  api('/api/reception/session')
    .then(s => (s.authenticated ? showDashboard() : showLogin()))
    .catch(showLogin);
})();
