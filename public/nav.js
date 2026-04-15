/**
 * Oturum: kenar çubuğu kullanıcı adı, yönetici menüsü, çıkış.
 * Sayfada #navUserName, #navYonetim, #btnLogout öğeleri olmalı.
 */
export async function initNav() {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  if (!r.ok) {
    window.location.href = '/login.html';
    return null;
  }
  const u = await r.json();
  const nameEl = document.getElementById('navUserName');
  if (nameEl) nameEl.textContent = u.username;
  const av = document.getElementById('navAvatar');
  if (av && u.username) av.textContent = u.username.charAt(0).toUpperCase();
  const roleEl = document.getElementById('navUserRole');
  if (roleEl) roleEl.textContent = u.is_admin ? 'Yönetici' : 'Kullanıcı';
  const yon = document.getElementById('navYonetim');
  if (yon && u.is_admin) yon.style.display = '';
  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });
  return u;
}
