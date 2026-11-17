(function () {
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    menu.querySelectorAll('a, button').forEach(a => a.addEventListener('click', () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // Show/hide links depending on whether a patient is logged in (re-run for content added later).
  function applyAuthLinks() {
    const user = window.AuthStore ? window.AuthStore.currentUser() : null;
    document.querySelectorAll('[data-auth]').forEach(el => {
      el.hidden = el.dataset.auth === 'user' ? !user : !!user;
    });
  }
  applyAuthLinks();
  window.addEventListener('auth-links', applyAuthLinks);

  document.querySelectorAll('[data-logout]').forEach(el => el.addEventListener('click', async e => {
    e.preventDefault();
    await window.AuthStore.logOut();
    window.location.href = '/index.html';
  }));
})();
