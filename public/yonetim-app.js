import { initNav } from './nav.js';

function toast(msg, type = 'info') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (r.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Giriş gerekli');
  }
  return r;
}

let currentUserId = null;

async function loadUsers() {
  const r = await api('/api/users');
  if (!r.ok) {
    if (r.status === 403) {
      toast('Bu sayfa için yönetici yetkisi gerekli', 'error');
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 1500);
      return;
    }
    toast('Liste alınamadı', 'error');
    return;
  }
  const users = await r.json();
  const me = await fetch('/api/auth/me', { credentials: 'include' }).then((x) => x.json());
  currentUserId = me.id;
  const av = document.getElementById('navAvatar');
  if (av && me.username) av.textContent = me.username.charAt(0).toUpperCase();

  const tbody = document.getElementById('userTableBody');
  tbody.innerHTML = users
    .map(
      (u) => `
    <tr data-id="${u.id}">
      <td>${escapeHtml(u.username)}</td>
      <td>${u.is_admin ? '<span class="badge badge-gold">Yönetici</span>' : '<span class="badge badge-gray">Kullanıcı</span>'}</td>
      <td style="font-size:12px; color:var(--text-dim);">${formatDate(u.created_at)}</td>
      <td>
        ${
          u.id === currentUserId
            ? '<span style="color:var(--text-dim); font-size:12px;">Siz</span>'
            : `<button type="button" class="btn btn-sm btn-danger btn-del-user" data-id="${u.id}">Sil</button>`
        }
      </td>
    </tr>`
    )
    .join('');

  tbody.querySelectorAll('.btn-del-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!confirm('Bu kullanıcı silinsin mi?')) return;
      const del = await api(`/api/users/${id}`, { method: 'DELETE' });
      if (!del.ok) {
        const err = await del.json().catch(() => ({}));
        toast(err.error || 'Silinemedi', 'error');
        return;
      }
      toast('Kullanıcı silindi', 'success');
      loadUsers();
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('tr-TR');
  } catch {
    return String(iso);
  }
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const is_admin = document.getElementById('newIsAdmin').checked;
  const r = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, is_admin }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    toast(err.error || 'Eklenemedi', 'error');
    return;
  }
  toast('Kullanıcı eklendi', 'success');
  document.getElementById('userForm').reset();
  loadUsers();
});

(async () => {
  const u = await initNav();
  if (!u) return;
  if (!u.is_admin) {
    toast('Yönetici değilsiniz', 'error');
    window.location.href = '/index.html';
    return;
  }
  loadUsers();
})();
