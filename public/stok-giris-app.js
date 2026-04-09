import { initNav } from './nav.js';

function toast(msg, type = 'info') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

const xlsInput = document.getElementById('xlsFile');
const uploadXlsBtn = document.getElementById('uploadXlsBtn');
const xlsUploadResult = document.getElementById('xlsUploadResult');

xlsInput.addEventListener('change', () => {
  uploadXlsBtn.disabled = !xlsInput.files?.length;
  xlsUploadResult.textContent = '';
});

uploadXlsBtn.addEventListener('click', async () => {
  const f = xlsInput.files?.[0];
  if (!f) {
    toast('Dosya seçin', 'error');
    return;
  }
  uploadXlsBtn.disabled = true;
  xlsUploadResult.textContent = 'Yükleniyor…';
  const fd = new FormData();
  fd.append('file', f);
  try {
    const r = await fetch('/api/stock-items/import-xls', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (r.status === 401) {
      window.location.href = '/login.html';
      return;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      xlsUploadResult.textContent = data.error || 'Yükleme başarısız';
      toast(data.error || 'Hata', 'error');
      uploadXlsBtn.disabled = false;
      return;
    }
    const skipInfo =
      data.skippedRows?.length > 0
        ? `\nAtlanan satır: ${data.skippedRows.length} (örnek: ${JSON.stringify(data.skippedRows.slice(0, 3))})`
        : '';
    xlsUploadResult.textContent = `Tamam. ${data.upserted} kayıt veritabanına yazıldı (sayfa: ${data.sheetName}).${skipInfo}`;
    toast(`${data.upserted} kayıt aktarıldı`, 'success');
    xlsInput.value = '';
  } catch (e) {
    xlsUploadResult.textContent = String(e.message || e);
    toast('Ağ hatası', 'error');
  }
  uploadXlsBtn.disabled = !xlsInput.files?.length;
});

document.getElementById('stockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('newName').value.trim();
  const code = document.getElementById('newCode').value.trim();
  const unit = document.getElementById('newUnit').value;
  if (!name || !code || !unit) {
    toast('Tüm alanları doldurun', 'error');
    return;
  }
  const r = await fetch('/api/stock-items', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, code, unit }),
  });
  if (r.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    toast(err.error || 'Kayıt başarısız', 'error');
    return;
  }
  toast('Stok kaydedildi', 'success');
  document.getElementById('stockForm').reset();
});

(async () => {
  await initNav();
})();
