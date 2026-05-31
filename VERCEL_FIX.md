# Qast Vercel Fix

This version removes package-lock.json because the previous lock file contained registry URLs from the build environment and caused Vercel's npm install to fail.

Use Vercel settings:
- Install Command: npm install --no-package-lock --no-audit --no-fund --legacy-peer-deps --prefer-online
- Build Command: npm run build
- Output Directory: dist
- Node.js: 20.x

Do not add PRIVATE_KEY to Vercel.
