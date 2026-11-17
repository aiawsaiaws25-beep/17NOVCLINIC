(function () {
  const SPECIALTIES = [
    { id: 'gp', name: 'General Physician', doctor: 'Dr. Sara Ahmed', desc: 'Everyday health & preventive care' },
    { id: 'ent', name: 'ENT', doctor: 'Dr. Omar Khan', desc: 'Ear, nose & throat' },
    { id: 'dentist', name: 'Dentist', doctor: 'Dr. Lina Haddad', desc: 'Dental check-ups & treatment' },
    { id: 'cardio', name: 'Cardiologist', doctor: 'Dr. Raj Mehta', desc: 'Heart health & screening' }
  ];
  const OPEN_HOUR = 9;
  const CLOSE_HOUR = 21;
  const SLOT_MINUTES = 30;
  const LAST_STEP = 5;

  const modal = document.getElementById('booking');
  const form = document.getElementById('booking-form');
  const steps = form.querySelectorAll('.step');
  const progress = modal.querySelectorAll('.steps li');
  const backBtn = document.getElementById('back-btn');
  const nextBtn = document.getElementById('next-btn');
  const actions = document.getElementById('modal-actions');
  const dateInput = document.getElementById('date');
  const slotsEl = document.getElementById('slots');

  const state = { step: 1, specialty: null, doctor: null, date: '', time: '', name: '', phone: '', email: '' };
  let lastFocus = null;

  const pad = n => String(n).padStart(2, '0');
  const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const formatTime = (h, m) => `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
  const formatDate = s => parseDate(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function optionHtml(name, value, title, sub, checked) {
    return `<label class="option">
      <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>
      <span class="option-body"><strong>${title}</strong><small>${sub}</small></span>
    </label>`;
  }

  function renderSpecialties() {
    document.getElementById('specialty-options').innerHTML = SPECIALTIES
      .map(s => optionHtml('specialty', s.id, s.name, s.desc, state.specialty === s.id)).join('');
  }

  function renderDoctors() {
    const s = SPECIALTIES.find(x => x.id === state.specialty);
    document.getElementById('doctor-options').innerHTML = s
      ? optionHtml('doctor', s.doctor, s.doctor, s.name, state.doctor === s.doctor)
      : '';
  }

  async function renderSlots() {
    const err = document.getElementById('date-error');
    err.textContent = '';
    if (!state.date) {
      slotsEl.innerHTML = '<p class="muted">Pick a date to see available times.</p>';
      return;
    }
    const day = parseDate(state.date);
    if (day.getDay() === 0) {
      err.textContent = 'We are closed on Sundays. Please choose another day.';
      slotsEl.innerHTML = '';
      state.time = '';
      return;
    }
    const requestedDate = state.date;
    let taken;
    try {
      taken = await window.AppointmentStore.bookedTimes(state.doctor, requestedDate);
    } catch (e) {
      if (requestedDate === state.date) {
        err.textContent = e.message;
        slotsEl.innerHTML = '';
      }
      return;
    }
    if (requestedDate !== state.date) return;
    const now = new Date();
    const isToday = toISODate(now) === state.date;
    let html = '';
    for (let mins = OPEN_HOUR * 60; mins < CLOSE_HOUR * 60; mins += SLOT_MINUTES) {
      const h = Math.floor(mins / 60), m = mins % 60;
      const value = `${pad(h)}:${pad(m)}`;
      const past = isToday && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes());
      const unavailable = past || taken.includes(value);
      if (unavailable && state.time === value) state.time = '';
      html += `<label class="slot${unavailable ? ' disabled' : ''}"${taken.includes(value) ? ' title="Already booked"' : ''}>
        <input type="radio" name="time" value="${value}" ${unavailable ? 'disabled' : ''} ${state.time === value ? 'checked' : ''}>
        <span>${formatTime(h, m)}</span>
      </label>`;
    }
    slotsEl.innerHTML = html;
    nextBtn.disabled = !canProceed();
    if (!slotsEl.querySelector('input:not([disabled])')) {
      err.textContent = 'No available slots on this day. Please choose another day.';
    }
  }

  function summaryRows(a) {
    const [date, time] = a.appointment_datetime.split('T');
    const [h, m] = time.split(':').map(Number);
    return [
      ['Specialty', a.specialty],
      ['Doctor', a.doctor],
      ['Date', formatDate(date)],
      ['Time', formatTime(h, m)],
      ['Name', a.patient_name],
      ['Phone', a.patient_phone],
      ['Email', a.patient_email],
      ['Location', 'Lakeside Medical Clinic, Cluster X, JLT, Dubai']
    ];
  }

  const rowsHtml = rows => rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');

  function draftAppointment() {
    const s = SPECIALTIES.find(x => x.id === state.specialty);
    return {
      specialty: s.name,
      doctor: state.doctor,
      appointment_datetime: `${state.date}T${state.time}`,
      patient_name: state.name,
      patient_phone: state.phone,
      patient_email: state.email
    };
  }

  function renderSummary() {
    document.getElementById('confirm-error').textContent = '';
    document.getElementById('summary').innerHTML = rowsHtml([
      ...summaryRows(draftAppointment()),
      ['Deposit', `${window.Payments.DEPOSIT_LABEL} refundable consultation deposit — paid securely on Stripe`]
    ]);
  }

  async function confirmBooking() {
    const errEl = document.getElementById('confirm-error');
    errEl.textContent = '';
    nextBtn.disabled = true;
    nextBtn.textContent = 'Saving…';
    let saved = null;
    try {
      saved = await window.AppointmentStore.createPending(draftAppointment());
      nextBtn.textContent = 'Redirecting to secure payment…';
      await window.Payments.startCheckout(saved);
    } catch (e) {
      // Checkout never started, so release the slot instead of leaving it held.
      if (saved) await window.AppointmentStore.cancel(saved.id).catch(() => {});
      errEl.textContent = (e && e.message) || 'Sorry, the booking could not be saved. Please try again.';
      nextBtn.disabled = false;
      nextBtn.textContent = confirmLabel();
    }
  }

  const confirmLabel = () => `Pay ${window.Payments.DEPOSIT_LABEL} deposit & confirm`;

  async function showPaymentCancelled(appointmentId) {
    const appt = await window.AppointmentStore.get(appointmentId);
    if (!appt || appt.status !== 'pending') return;
    const [date, time] = appt.appointment_datetime.split('T');
    const [h, m] = time.split(':').map(Number);
    const notice = document.getElementById('payment-notice');
    notice.querySelector('[data-detail]').innerHTML =
      `Your appointment with <strong>${escapeHtml(appt.doctor)}</strong> on <strong>${formatDate(date)}</strong> at ` +
      `<strong>${formatTime(h, m)}</strong> is <strong>pending</strong> and not confirmed until the ${window.Payments.DEPOSIT_LABEL} deposit is paid.`;
    notice.hidden = false;
    const err = notice.querySelector('[data-error]');
    notice.querySelector('[data-retry]').onclick = async e => {
      e.target.disabled = true;
      err.textContent = '';
      try {
        await window.Payments.startCheckout(appt);
      } catch (ex) {
        err.textContent = ex.message;
        e.target.disabled = false;
      }
    };
    notice.querySelector('[data-new]').onclick = async () => {
      await window.AppointmentStore.cancel(appt.id).catch(() => {});
      notice.hidden = true;
    };
  }

  function canProceed() {
    switch (state.step) {
      case 1: return !!state.specialty;
      case 2: return !!state.doctor;
      case 3: return !!state.date && !!state.time;
      case 4: return true;
      default: return true;
    }
  }

  function validateDetails() {
    const name = document.getElementById('name');
    const phone = document.getElementById('phone');
    const email = document.getElementById('email');
    const err = document.getElementById('details-error');
    state.name = name.value.trim();
    state.phone = phone.value.trim();
    state.email = email.value.trim();
    [name, phone, email].forEach(i => i.classList.remove('invalid'));

    const problems = [];
    if (state.name.length < 2) { problems.push('your full name'); name.classList.add('invalid'); }
    if (!/^\+?[\d\s()-]{7,}$/.test(state.phone)) { problems.push('a valid phone number'); phone.classList.add('invalid'); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email)) { problems.push('a valid email'); email.classList.add('invalid'); }
    err.textContent = problems.length ? `Please enter ${problems.join(', ')}.` : '';
    return problems.length === 0;
  }

  function showStep(n) {
    state.step = n;
    steps.forEach(s => s.classList.toggle('active', Number(s.dataset.step) === n));
    progress.forEach((li, i) => {
      li.classList.toggle('active', i + 1 === n);
      li.classList.toggle('complete', i + 1 < n);
    });
    if (n === 2) renderDoctors();
    if (n === 3) renderSlots();
    if (n === 4) prefillPatient();
    if (n === 5) renderSummary();

    actions.hidden = n > LAST_STEP;
    modal.querySelector('.steps').hidden = n > LAST_STEP;
    backBtn.style.visibility = n === 1 ? 'hidden' : 'visible';
    nextBtn.textContent = n === LAST_STEP ? confirmLabel() : 'Next';
    nextBtn.disabled = !canProceed();
    modal.querySelector('.modal-panel').scrollTop = 0;
  }

  function prefillPatient() {
    const user = window.AuthStore && window.AuthStore.currentUser();
    const nameEl = document.getElementById('name');
    const emailEl = document.getElementById('email');
    const hint = document.getElementById('account-hint');
    if (user) {
      if (!nameEl.value) nameEl.value = user.name;
      emailEl.value = user.email;
      emailEl.readOnly = true;
      hint.innerHTML = `Booking as <strong>${escapeHtml(user.email)}</strong> — this appointment will appear in My Appointments.`;
    } else {
      emailEl.readOnly = false;
      hint.innerHTML = 'Have an account? <a href="login.html">Log in</a> to manage your appointments online.';
    }
  }

  function reset() {
    Object.assign(state, { step: 1, specialty: null, doctor: null, date: '', time: '', name: '', phone: '', email: '' });
    form.reset();
    document.getElementById('details-error').textContent = '';
    form.querySelectorAll('.invalid').forEach(i => i.classList.remove('invalid'));
    renderSpecialties();
    showStep(1);
  }

  function open(e) {
    if (e) e.preventDefault();
    lastFocus = document.activeElement;
    if (state.step > LAST_STEP) reset();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    dateInput.min = toISODate(new Date());
    setTimeout(() => modal.querySelector('.modal-close').focus(), 0);
  }

  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    if (state.step > LAST_STEP) reset();
    if (lastFocus) lastFocus.focus();
  }

  form.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'specialty') {
      if (state.specialty !== t.value) state.doctor = null;
      state.specialty = t.value;
    } else if (t.name === 'doctor') {
      state.doctor = t.value;
    } else if (t.name === 'time') {
      state.time = t.value;
    } else if (t.id === 'date') {
      state.date = t.value;
      renderSlots();
    }
    nextBtn.disabled = !canProceed();
  });

  nextBtn.addEventListener('click', () => {
    if (!canProceed()) return;
    if (state.step === 4 && !validateDetails()) return;
    if (state.step === LAST_STEP) {
      confirmBooking();
      return;
    }
    showStep(state.step + 1);
  });

  form.addEventListener('submit', e => { e.preventDefault(); nextBtn.click(); });

  backBtn.addEventListener('click', () => { if (state.step > 1) showStep(state.step - 1); });

  modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  document.querySelectorAll('[data-book]').forEach(b => b.addEventListener('click', open));

  reset();
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'cancelled' && params.get('appointment_id')) {
    showPaymentCancelled(params.get('appointment_id'));
  }
  if (window.location.hash === '#book') {
    history.replaceState(null, '', window.location.pathname);
    open();
  }
})();
