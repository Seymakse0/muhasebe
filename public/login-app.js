const form = document.getElementById('loginForm');
const errEl = document.getElementById('loginErr');
const btn = document.getElementById('loginBtn');

(async () => {
  const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
  if (r.ok) {
    window.location.replace(`${window.location.origin}/stok-giris.html`);
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.style.display = 'none';
  btn.disabled = true;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = data.error || 'Giriş başarısız';
      errEl.style.display = 'block';
      return;
    }
    window.location.assign(`${window.location.origin}/stok-giris.html`);
  } catch {
    errEl.textContent = 'Bağlantı hatası';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
});
