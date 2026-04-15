import XLSX from 'xlsx';

/** Türkçe birim metninin kilogram veya adet ailesine uyup uymadığını kontrol eder (Excel tam metni saklanır). */
export function normalizeUnit(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().toLocaleLowerCase('tr-TR');
  s = s.replace(/\s+/g, '');
  if (/^(kg|kgs|kilogram|kilo|kğ)$/.test(s)) return 'kilogram';
  if (s === 'g' || s === 'gr' || s === 'gram') return 'kilogram';
  if (/^(ad|adet|adt|tane|pcs|pk|piece)$/.test(s)) return 'adet';
  if (
    (/kilo|kilogram/.test(s) || /kg/.test(s) || /\d+[,.]?\d*gr$/.test(s)) &&
    !/adet|tane/.test(s)
  ) {
    return 'kilogram';
  }
  if (/adet|tane/.test(s)) return 'adet';
  return null;
}

function normCell(h) {
  return String(h ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ');
}

/** Başlık satırından sütun indeksleri */
export function columnIndicesFromHeader(headerRow) {
  const cells = headerRow.map(normCell);
  let nameI = cells.findIndex(
    (c) =>
      /stok\s*adı|stok\s*adi|malzeme|ürün|urun|tanım|tanim|stok\s*ismi|açıklama/.test(c) ||
      (c.includes('stok') && c.includes('ad'))
  );
  let codeI = cells.findIndex(
    (c) =>
      (/stok\s*kodu|stok\s*kod|ürün\s*kodu|urun\s*kodu|kodu|sku/.test(c) || c === 'kod' || c === 'code') &&
      !c.includes('birim')
  );
  let unitI = cells.findIndex((c) => /birim|unit|ölçü|olcu|olçü/.test(c));

  if (nameI < 0 || codeI < 0 || unitI < 0) {
    if (cells.length >= 3 && nameI < 0 && codeI < 0 && unitI < 0) {
      return { nameI: 0, codeI: 1, unitI: 2 };
    }
  }
  return { nameI, codeI, unitI };
}

export function parseStockRowsFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) {
    return { items: [], skipped: [{ reason: 'Boş sayfa' }], sheetName };
  }

  let headerRow = -1;
  let cols = { nameI: -1, codeI: -1, unitI: -1 };
  for (let tryRow = 0; tryRow < Math.min(6, matrix.length); tryRow++) {
    const c = columnIndicesFromHeader(matrix[tryRow]);
    if (c.nameI >= 0 && c.codeI >= 0 && c.unitI >= 0) {
      headerRow = tryRow;
      cols = c;
      break;
    }
  }
  if (headerRow < 0) {
    cols = columnIndicesFromHeader(matrix[0]);
    if (cols.nameI >= 0 && cols.codeI >= 0 && cols.unitI >= 0) {
      headerRow = 0;
    }
  }

  const { nameI, codeI, unitI } = cols;
  if (nameI < 0 || codeI < 0 || unitI < 0) {
    return {
      items: [],
      skipped: [
        {
          reason:
            'Başlık satırında "stok adı", "stok kodu" ve "birim" sütunları bulunamadı (ilk 6 satırda arandı).',
        },
      ],
      sheetName,
    };
  }

  const items = [];
  const skipped = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const name = String(row[nameI] ?? '').trim();
    const code = String(row[codeI] ?? '').trim();
    const unitRaw = String(row[unitI] ?? '').trim();
    if (!name && !code) continue;
    if (!name || !code) {
      skipped.push({ row: r + 1, reason: 'Eksik stok adı veya kod' });
      continue;
    }
    if (!normalizeUnit(unitRaw)) {
      skipped.push({ row: r + 1, reason: `Bilinmeyen birim: "${unitRaw || '(boş)'}"` });
      continue;
    }
    items.push({ name, code, unit: unitRaw });
  }
  return { items, skipped, sheetName };
}
