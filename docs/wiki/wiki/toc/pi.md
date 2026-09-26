# pi

| Page | Type | Tags | Summary | Updated |
|------|------|------|---------|---------|
| [Gallery page is live before browsable catalog](pi/gallery-index-lag.md) | gotcha | npm gallery publishing pi-package | A package's pi.dev gallery page appears immediately after npm publish, but the browsable catalog can lag by hours because it is built from npm's search index. | 2026-09-20 |
| [npm-installed extensions do not cross minor versions on update](pi/npm-minor-version-pin.md) | gotcha | pi npm install update gotcha | pi's npm store pins a ^<minor> dependency range; for 0.x packages that excludes the next minor, so an @latest update can report success while the installed copy stays old — install the explicit version instead. | 2026-09-26 |
| [One install source only](pi/one-install-source.md) | gotcha | install pi-package tool-conflict pi npm | pi-jev-wiki must be installed from exactly one source (npm package, local folder, or git); a second registered copy makes pi refuse to load the extension with tool-conflict errors. | 2026-09-26 |
