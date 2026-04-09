import { initNav } from './nav.js';

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

function toast(msg, type = 'info') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast toast-${type === 'error' ? 'error' : type === 'success' ? 'success' : 'info'}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/** Miktar: harf, boşluk, nokta yok; rakam ve tek virgül (ondalık) */
function sanitizeQty(str) {
  let s = String(str || '');
  s = s.replace(/[^\d,]/g, '');
  const parts = s.split(',');
  if (parts.length <= 1) return parts[0] || '';
  return parts[0] + ',' + parts.slice(1).join('').replace(/,/g, '');
}

function qtyToApi(s) {
  const t = sanitizeQty(s);
  if (!t) return '';
  return t.replace(',', '.');
}

function formatQtyDisplay(num) {
  const n = Number(num);
  if (Number.isNaN(n)) return '';
  return String(n).replace('.', ',');
}

let costCenters = [];
let selectedCostCenter = null;
let counts = [];
let searchTimer = null;
let suggestOpen = false;
let activeSuggest = -1;
let lastSuggestItems = [];

const els = {
  openCostCenterBtn: document.getElementById('openCostCenterBtn'),
  costCenterModal: document.getElementById('costCenterModal'),
  closeCostCenterModal: document.getElementById('closeCostCenterModal'),
  cancelCostCenterModal: document.getElementById('cancelCostCenterModal'),
  costCenterList: document.getElementById('costCenterList'),
  selectedCostCenterBadge: document.getElementById('selectedCostCenterBadge'),
  pageSub: document.getElementById('pageSub'),
  stockSearch: document.getElementById('stockSearch'),
  stockSuggest: document.getElementById('stockSuggest'),
  stockCode: document.getElementById('stockCode'),
  stockUnit: document.getElementById('stockUnit'),
  stockQty: document.getElementById('stockQty'),
  selectedStockId: document.getElementById('selectedStockId'),
  addRowBtn: document.getElementById('addRowBtn'),
  excelExportBtn: document.getElementById('excelExportBtn'),
  countTableBody: document.getElementById('countTableBody'),
  exportHeaderMeta: document.getElementById('exportHeaderMeta'),
  rowCountBadge: document.getElementById('rowCountBadge'),
};

function openModal() {
  els.costCenterModal.classList.add('open');
  els.costCenterModal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  els.costCenterModal.classList.remove('open');
  els.costCenterModal.setAttribute('aria-hidden', 'true');
}

function unitLabel(u) {
  if (u === 'kilogram') return 'kilogram';
  if (u === 'adet') return 'adet';
  return u || '';
}

async function loadCostCenters() {
  const r = await api('/api/cost-centers');
  if (!r.ok) throw new Error('Maliyet merkezleri yüklenemedi');
  costCenters = await r.json();
  els.costCenterList.innerHTML = costCenters
    .map(
      (cc) =>
        `<button type="button" class="cost-center-btn" data-id="${cc.id}" style="color:var(--red);">${escapeHtml(cc.name)}</button>`
    )
    .join('');
  els.costCenterList.querySelectorAll('.cost-center-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectCostCenter(Number(btn.dataset.id)));
  });
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function selectCostCenter(id) {
  selectedCostCenter = costCenters.find((c) => c.id === id) || null;
  closeModal();
  if (!selectedCostCenter) return;

  els.selectedCostCenterBadge.style.display = 'inline-flex';
  els.selectedCostCenterBadge.textContent = selectedCostCenter.name;
  els.pageSub.textContent = `Seçili maliyet merkezi: ${selectedCostCenter.name}`;
  els.excelExportBtn.disabled = false;

  document.getElementById('stockSearch').value = '';
  document.getElementById('stockCode').value = '';
  document.getElementById('stockUnit').value = '';
  document.getElementById('stockQty').value = '';
  document.getElementById('selectedStockId').value = '';

  await loadCounts();
}

async function loadCounts() {
  if (!selectedCostCenter) return;
  const r = await api(`/api/stock-counts?cost_center_id=${selectedCostCenter.id}`);
  if (!r.ok) {
    toast('Sayım listesi alınamadı', 'error');
    return;
  }
  counts = await r.json();
  renderTable();
}

function renderTable() {
  els.exportHeaderMeta.textContent = `Maliyet merkezi: ${selectedCostCenter ? selectedCostCenter.name : '—'}`;
  els.rowCountBadge.textContent = `${counts.length} satır`;

  if (!selectedCostCenter) {
    els.countTableBody.innerHTML =
      '<tr><td colspan="5" style="color:var(--text-dim);">Maliyet merkezi seçin.</td></tr>';
    return;
  }

  if (counts.length === 0) {
    els.countTableBody.innerHTML =
      '<tr><td colspan="5" style="color:var(--text-dim);">Bu merkez için henüz satır yok.</td></tr>';
    return;
  }

  els.countTableBody.innerHTML = counts
    .map((row) => {
      const q = formatQtyDisplay(row.quantity);
      return `<tr data-id="${row.id}">
        <td>${escapeHtml(row.stock_name)}</td>
        <td>${escapeHtml(row.stock_code)}</td>
        <td>${escapeHtml(unitLabel(row.unit))}</td>
        <td><input type="text" class="form-input qty-input row-qty" data-id="${row.id}" value="${escapeHtml(q)}" /></td>
        <td><button type="button" class="btn btn-sm btn-danger row-del" data-id="${row.id}">Sil</button></td>
      </tr>`;
    })
    .join('');

  els.countTableBody.querySelectorAll('.row-qty').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      e.target.value = sanitizeQty(e.target.value);
    });
    inp.addEventListener('change', async () => {
      const id = Number(inp.dataset.id);
      const q = qtyToApi(inp.value);
      if (q === '' || Number.isNaN(Number(q))) {
        toast('Geçerli miktar girin', 'error');
        await loadCounts();
        return;
      }
      const r = await api(`/api/stock-counts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: q }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        toast(err.error || 'Güncellenemedi', 'error');
        await loadCounts();
        return;
      }
      toast('Miktar güncellendi', 'success');
      await loadCounts();
    });
  });

  els.countTableBody.querySelectorAll('.row-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!confirm('Bu satır silinsin mi?')) return;
      const r = await api(`/api/stock-counts/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast('Silinemedi', 'error');
        return;
      }
      toast('Satır silindi', 'success');
      await loadCounts();
    });
  });
}

async function runStockSearch(q) {
  const r = await api(`/api/stock-items/search?q=${encodeURIComponent(q)}&limit=50`);
  if (!r.ok) return [];
  return r.json();
}

function renderSuggest(items) {
  lastSuggestItems = items;
  if (!items.length) {
    els.stockSuggest.innerHTML = '<div class="stok-suggest-item" style="color:var(--text-dim);">Sonuç yok</div>';
    els.stockSuggest.classList.add('open');
    suggestOpen = true;
    return;
  }
  els.stockSuggest.innerHTML = items
    .map(
      (it, i) =>
        `<div class="stok-suggest-item${i === activeSuggest ? ' active' : ''}" data-idx="${i}" role="option">${escapeHtml(it.name)} <span style="color:var(--text-dim); font-weight:400;">(${escapeHtml(it.code)})</span></div>`
    )
    .join('');
  els.stockSuggest.classList.add('open');
  suggestOpen = true;
  els.stockSuggest.querySelectorAll('.stok-suggest-item[data-idx]').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const idx = Number(el.dataset.idx);
      const it = lastSuggestItems[idx];
      if (it) pickStock(it);
    });
  });
}

function pickStock(it) {
  els.selectedStockId.value = String(it.id);
  els.stockCode.value = it.code;
  els.stockUnit.value = unitLabel(it.unit);
  els.stockSearch.value = it.name;
  els.stockSuggest.classList.remove('open');
  suggestOpen = false;
  els.addRowBtn.disabled = !selectedCostCenter;
}

els.stockSearch.addEventListener('input', () => {
  els.selectedStockId.value = '';
  els.stockCode.value = '';
  els.stockUnit.value = '';
  els.addRowBtn.disabled = true;
  clearTimeout(searchTimer);
  const q = els.stockSearch.value;
  searchTimer = setTimeout(async () => {
    const items = await runStockSearch(q);
    renderSuggest(items);
    activeSuggest = -1;
  }, 280);
});

els.stockSearch.addEventListener('focus', async () => {
  const q = els.stockSearch.value;
  const items = await runStockSearch(q || '%');
  renderSuggest(items);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.stok-search-wrap')) {
    els.stockSuggest.classList.remove('open');
    suggestOpen = false;
  }
});

els.stockQty.addEventListener('input', () => {
  els.stockQty.value = sanitizeQty(els.stockQty.value);
});

els.addRowBtn.addEventListener('click', async () => {
  if (!selectedCostCenter) {
    toast('Önce maliyet merkezi seçin', 'error');
    return;
  }
  const sid = Number(els.selectedStockId.value);
  if (!sid) {
    toast('Listeden stok seçin', 'error');
    return;
  }
  const q = qtyToApi(els.stockQty.value);
  if (q === '' || Number.isNaN(Number(q))) {
    toast('Geçerli miktar girin (rakam ve isteğe bağlı virgül)', 'error');
    return;
  }
  const r = await api('/api/stock-counts', {
    method: 'POST',
    body: JSON.stringify({
      cost_center_id: selectedCostCenter.id,
      stock_item_id: sid,
      quantity: q,
    }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    toast(err.error || 'Kaydedilemedi', 'error');
    return;
  }
  toast('Kaydedildi', 'success');
  els.stockQty.value = '';
  await loadCounts();
});

els.openCostCenterBtn.addEventListener('click', openModal);
els.closeCostCenterModal.addEventListener('click', closeModal);
els.cancelCostCenterModal.addEventListener('click', closeModal);
els.costCenterModal.addEventListener('click', (e) => {
  if (e.target === els.costCenterModal) closeModal();
});

els.excelExportBtn.addEventListener('click', () => {
  if (!selectedCostCenter || typeof XLSX === 'undefined') {
    toast('Excel kütüphanesi yüklenemedi veya merkez seçilmedi', 'error');
    return;
  }
  const rows = [
    [`Maliyet merkezi: ${selectedCostCenter.name}`],
    [],
    ['Stok adı', 'Stok kodu', 'Birim', 'Stok miktarı'],
    ...counts.map((row) => [
      row.stock_name,
      row.stock_code,
      unitLabel(row.unit),
      formatQtyDisplay(row.quantity),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 44 }, { wch: 20 }, { wch: 14 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sayim');
  const safe = selectedCostCenter.name.replace(/[^\w\u00C0-\u024f]+/g, '_');
  XLSX.writeFile(wb, `stok_sayim_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Excel dosyası indirildi', 'success');
});

(async function init() {
  try {
    await initNav();
    await loadCostCenters();
  } catch (e) {
    if (String(e.message || e).includes('Giriş')) return;
    toast(String(e.message || e), 'error');
  }
})();
