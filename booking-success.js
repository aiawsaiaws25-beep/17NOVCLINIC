(function () {
  const resultEl = document.getElementById('result');
  const sessionId = new URLSearchParams(window.location.search).get('session_id') || '';

  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  function formatWhen(dt) {
    if (!dt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dt)) return { date: '—', time: '—' };
    const [d, t] = dt.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    const date = new Date(y, mo - 1, da).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { date, time: `${h % 12 || 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}` };
  }

  const money = (amount, currency) =>
    amount == null ? '—' : `${(currency || '').toUpperCase()} ${(amount / 100).toFixed(2)}`;

  const STATUS_LABELS = {
    pending: 'Pending payment', booked: 'Booked', arrived: 'Arrived', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled'
  };

  const rows = list => `<dl class="summary">${list
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>`;

  function renderConfirmed(appt, v) {
    const src = appt;
    const { date, time } = formatWhen(src.appointment_datetime);
    resultEl.innerHTML = `
      <div class="done-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="5 12 10 17 19 7"/></svg></div>
      <h1>Booking confirmed!</h1>
      <p class="muted">Thank you${src.patient_name ? ', <strong>' + escapeHtml(src.patient_name) + '</strong>' : ''}. Your deposit has been received and your appointment is confirmed.</p>
      ${rows([
        ['Booking ID', src.id || '—'],
        ['Specialty', src.specialty || '—'],
        ['Doctor', src.doctor || '—'],
        ['Date', date],
        ['Time', time],
        ['Location', 'Lakeside Medical Clinic, Cluster X, JLT, Dubai'],
        ['Deposit paid', money(v.amount_total, v.currency) + ' (refundable)'],
        ['Status', STATUS_LABELS[appt.status] || appt.status]
      ])}
      <div class="result-actions">
        <a class="btn" href="/my-appointments.html" data-auth="user">View My Appointments</a>
        <a class="btn btn-outline" href="/index.html">Back to home</a>
      </div>`;
    window.dispatchEvent(new Event('auth-links'));
  }

  function renderNotPaid(appt, message) {
    const canRetry = appt && appt.status === 'pending';
    resultEl.innerHTML = `
      <div class="done-icon warn" aria-hidden="true"><svg viewBox="0 0 24 24"><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <h1>Payment not completed</h1>
      <p class="muted">${escapeHtml(message)}</p>
      ${appt ? rows([
        ['Doctor', appt.doctor],
        ['Date', formatWhen(appt.appointment_datetime).date],
        ['Time', formatWhen(appt.appointment_datetime).time],
        ['Status', appt.status.charAt(0).toUpperCase() + appt.status.slice(1)]
      ]) : ''}
      <p class="field-error" id="retry-error"></p>
      <div class="result-actions">
        ${canRetry ? '<button type="button" class="btn" id="retry">Try payment again</button>' : ''}
        <a class="btn btn-outline" href="/index.html#book">Book again</a>
      </div>`;
    if (canRetry) {
      document.getElementById('retry').addEventListener('click', async e => {
        e.target.disabled = true;
        try {
          await window.Payments.startCheckout(appt);
        } catch (err) {
          document.getElementById('retry-error').textContent = err.message;
          e.target.disabled = false;
        }
      });
    }
  }

  async function run() {
    if (!sessionId) {
      renderNotPaid(null, 'We could not find a payment reference. If you were charged, please contact the clinic on +971 4 000 0000.');
      return;
    }
    let verification;
    try {
      verification = await window.Payments.verify(sessionId);
    } catch (e) {
      renderNotPaid(null, `We could not confirm your payment right now (${e.message}). Your appointment stays pending — please refresh this page in a moment.`);
      return;
    }

    const appt = verification.appointment;

    // The server has already checked with Stripe and updated the appointment; the redirect alone proves nothing.
    if (verification.paid && appt) {
      renderConfirmed(appt, verification);
    } else if (verification.paid) {
      renderNotPaid(null, 'Your payment was received, but we could not find the matching appointment. Please call the clinic on +971 4 000 0000.');
    } else {
      renderNotPaid(appt, verification.status === 'expired'
        ? 'This payment session has expired, so your appointment was not confirmed. It remains pending until the deposit is paid.'
        : 'Stripe has not received your deposit, so your appointment is still pending and not confirmed.');
    }
  }

  run();
})();
