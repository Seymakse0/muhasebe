#!/usr/bin/env python3
"""Sunucuda ~/muhasebe içinden: python3 deploy/fix-app-port-3006.py"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
p = root / "docker-compose.yml"
if not p.is_file():
    print("docker-compose.yml bulunamadı:", p, file=sys.stderr)
    sys.exit(1)

t = p.read_text(encoding="utf-8")
orig = t
# "3000:3000" veya "${APP_PORT:-...}:3000" → 3006:3000
t = re.sub(r'"3000:3000"', '"3006:3000"', t)
t = re.sub(r'"\$\{APP_PORT:[^}]*\}:3000"', '"3006:3000"', t)

ov = root / "docker-compose.override.yml"
if ov.is_file():
    otxt = ov.read_text(encoding="utf-8")
    if "3000" in otxt and "PGPORT" not in otxt:
        print("UYARI:", ov, "içinde 3000 geçiyor — bu dosya compose ile birleşir.")
        print("  Geçici: mv", ov, str(ov) + ".bak")
        print()

if t == orig:
    print("Bilinen 3000 host patterni yok; ports satırları:")
    for i, line in enumerate(t.splitlines(), 1):
        if "ports" in line or (":3000" in line and "PGPORT" not in line):
            print(f"  {i}: {line.rstrip()}")
    if '"3006:3000"' in t:
        print("\nZaten 3006:3000 görünüyor — sorun docker-compose.override.yml veya başka compose dosyası olabilir.")
else:
    p.write_text(t, encoding="utf-8")
    print("Güncellendi:", p)

print("\nSonra: docker compose down && docker compose up -d --build")
