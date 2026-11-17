(function () {
  const user = window.AuthStore.currentUser();
  if (!user) return;

  const listEl = document.getElementById('appointments');
  const errEl = document.getElementById('list-error');

  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  function parseLocal(dt) {
    const [d, t] = dt.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return new Date(y, mo - 1, da, h, mi);
  }

  function formatWhen(dt) {
    const d = parseLocal(dt);
    const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const h = d.getHours();
    return { date, time: `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}` };
  }

  document.getElementById('welcome').innerHTML =
    `Logged in as <strong>${escapeHtml(user.name)}</strong> (${escapeHtml(user.email)})`;

  const STATUS_LABELS = {
    pending: 'Pending payment', booked: 'Booked', arrived: 'Arrived', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled'
  };

  async function render() {
    let items;
    try {
      items = await window.AppointmentStore.listByEmail(user.email);
    } catch (e) {
      errEl.textContent = e.message;
      return;
    }
    if (!items.length) {
      listEl.innerHTML = `<div class="empty">
        <p>You have no appointments yet.</p>
        <a href="index.html#book" class="btn">Book your first appointment</a>
      </div>`;
      return;
    }
    const now = new Date();
    listEl.innerHTML = items.map(a => {
      const { date, time } = formatWhen(a.appointment_datetime);
      const isPast = parseLocal(a.appointment_datetime) < now;
      const isOpen = (a.status === 'booked' || a.status === 'pending') && !isPast;
      const showPast = (a.status === 'booked' || a.status === 'pending') && isPast;
      const statusLabel = showPast ? 'Past' : STATUS_LABELS[a.status] || a.status;
      const badgeClass = showPast ? 'past' : a.status.replace('_', '-');
      return `<article class="appt ${a.status}${isPast ? ' past' : ''}">
        <div class="appt-when">
          <span class="appt-date">${date}</span>
          <span class="appt-time">${time}</span>
        </div>
        <div class="appt-info">
          <h3>${escapeHtml(a.doctor)}</h3>
          <p>${escapeHtml(a.specialty)} · Lakeside Medical Clinic, JLT</p>
          ${a.paid_at ? '<p class="appt-paid">✓ AED 100 deposit paid</p>' : ''}
          <p class="appt-id">Booking ID: ${escapeHtml(a.id)}</p>
        </div>
        <div class="appt-actions">
          <span class="badge badge-${escapeHtml(badgeClass)}">${escapeHtml(statusLabel)}</span>
          ${isOpen && a.status === 'pending' ? `<button type="button" class="btn btn-small btn-pay" data-pay="${escapeHtml(a.id)}">Pay deposit</button>` : ''}
          ${isOpen ? `<button type="button" class="btn btn-outline btn-danger" data-cancel="${escapeHtml(a.id)}">Cancel</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  listEl.addEventListener('click', async e => {
    const payBtn = e.target.closest('[data-pay]');
    if (!payBtn) return;
    errEl.textContent = '';
    payBtn.disabled = true;
    try {
      const appt = await window.AppointmentStore.get(payBtn.dataset.pay);
      await window.Payments.startCheckout(appt);
    } catch (err) {
      errEl.textContent = err.message;
      payBtn.disabled = false;
      render();
    }
  });

  listEl.addEventListener('click', async e => {
    const btn = e.target.closest('[data-cancel]');
    if (!btn) return;
    if (!window.confirm('Cancel this appointment?')) return;
    errEl.textContent = '';
    btn.disabled = true;
    try {
      const updated = await window.AppointmentStore.cancel(btn.dataset.cancel);
      if (!updated) throw new Error('Appointment not found.');
      await render();
    } catch (err) {
      errEl.textContent = err.message || 'Could not cancel the appointment. Please try again.';
      btn.disabled = false;
    }
  });

  render();
})();
