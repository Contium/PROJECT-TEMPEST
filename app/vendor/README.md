# Vendored data

Kept in the project so TEMPEST works offline.

| File | What | Source | Licence |
|---|---|---|---|
| `land-110m.json` | Earth's land outlines at 1:110m, as TopoJSON (object `land`) | [world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (`cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json`), built from [Natural Earth](https://www.naturalearthdata.com/) | Natural Earth data is public domain; world-atlas is ISC |
| `qrcode-generator/qrcode.js` | QR code encoder (draws the player screen link in Project settings) | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by Kazuhiko Arase (`registry.npmjs.org/qrcode-generator/-/qrcode-generator-1.4.4.tgz`, sha512 checked). Unchanged except one line added at the end, `export default qrcode;`, so it loads as an ES module | MIT |
