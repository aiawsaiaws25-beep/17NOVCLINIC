(function () {
  const AFTER_LOGIN = 'my-appointments.html';

  if (window.AuthStore.currentUser()) {
    window.location.replace(AFTER_LOGIN);
    return;
  }

  const forms = { login: document.getElementById('login-form'), signup: document.getElementById('signup-form') };
  const tabs = { login: document.getElementById('tab-login'), signup: document.getElementById('tab-signup') };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function show(which) {
    Object.keys(forms).forEach(k => {
      forms[k].hidden = k !== which;
      tabs[k].setAttribute('aria-selected', String(k === which));
      forms[k].querySelector('[data-error]').textContent = '';
    });
    const first = forms[which].querySelector('input');
    if (first) first.focus();
  }

  tabs.login.addEventListener('click', () => show('login'));
  tabs.signup.addEventListener('click', () => show('signup'));
  document.querySelectorAll('[data-switch]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    show(a.dataset.switch);
  }));
  if (window.location.hash === '#signup') show('signup');

  document.getElementById('use-demo').addEventListener('click', e => {
    e.preventDefault();
    show('login');
    const demo = window.AuthStore.demoCredentials;
    forms.login.elements.email.value = demo.email;
    forms.login.elements.password.value = demo.password;
    forms.login.querySelector('button[type=submit]').focus();
  });

  async function submit(form, label, action) {
    const btn = form.querySelector('button[type=submit]');
    const err = form.querySelector('[data-error]');
    err.textContent = '';
    form.querySelectorAll('.invalid').forEach(i => i.classList.remove('invalid'));
    btn.disabled = true;
    btn.textContent = 'Please wait…';
    try {
      await action();
      window.location.href = AFTER_LOGIN;
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function fail(form, field, message) {
    if (field) form.elements[field].classList.add('invalid');
    throw new Error(message);
  }

  forms.login.addEventListener('submit', e => {
    e.preventDefault();
    const f = forms.login;
    submit(f, 'Log in', async () => {
      const email = f.elements.email.value.trim();
      const password = f.elements.password.value;
      if (!EMAIL_RE.test(email)) fail(f, 'email', 'Please enter a valid email.');
      if (!password) fail(f, 'password', 'Please enter your password.');
      await window.AuthStore.logIn(email, password);
    });
  });

  forms.signup.addEventListener('submit', e => {
    e.preventDefault();
    const f = forms.signup;
    submit(f, 'Sign up', async () => {
      const name = f.elements.name.value.trim();
      const email = f.elements.email.value.trim();
      const password = f.elements.password.value;
      if (name.length < 2) fail(f, 'name', 'Please enter your full name.');
      if (!EMAIL_RE.test(email)) fail(f, 'email', 'Please enter a valid email.');
      if (password.length < 8) fail(f, 'password', 'Password must be at least 8 characters.');
      if (password !== f.elements.confirm.value) fail(f, 'confirm', 'Passwords do not match.');
      await window.AuthStore.signUp({ name, email, password });
    });
  });
})();
