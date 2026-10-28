"""Assemble index.html (single self-contained file) from src/ and vendor/.
Usage: python3 tools/build_web.py   (run from the repository root)"""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
ui = (root / 'src/ui.html').read_text(encoding='utf-8')
app = (root / 'src/app.js').read_text(encoding='utf-8')
core = (root / 'src/gbcore.js').read_text(encoding='utf-8').replace("if (typeof module !== 'undefined') module.exports = GB;", '')
vendor = ('<script>/* pako 1.0.11 inflate (MIT) — TIFF deflate support */\n' + (root / 'vendor/pako_inflate.min.js').read_text(encoding='utf-8') + '\n</script>\n'
          '<script>/* UTIF.js 3.1.0 (MIT, photopea) — TIFF decoder */\n' + (root / 'vendor/UTIF.js').read_text(encoding='utf-8') + '\n</script>')
body = ui.replace('/*VENDOR*/', vendor).replace('/*GBCORE*/', core).replace('/*APP*/', app)
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n'
(root / 'index.html').write_text(head + body + '\n</body>\n</html>\n', encoding='utf-8')
print('index.html', len(body), 'chars')
