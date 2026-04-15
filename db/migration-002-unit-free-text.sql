-- Birim: Excel'den gelen tam metin (örn. "adet 110gr", "kg 2,5") saklanır.
-- Mevcut veritabanında bir kez çalıştırın: psql veya docker exec ile.

ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_unit_check;
ALTER TABLE stock_items ALTER COLUMN unit TYPE VARCHAR(128);
