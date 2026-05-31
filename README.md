# Qast — Vercel live read fix

This is the compact Vercel-ready Qast frontend fixed to match the already-deployed QIE mainnet contract:

`0x669fa07b8518d27b5F0286b78868505300eE6224`

Important fix:
- The deployed contract uses `markets(uint256)` public getter, not `getMarket(uint256)`.
- The deployed contract uses `claimed(uint256,address)`, not `hasClaimed(uint256,address)`.
- The deployed contract uses 1-based market IDs: first market is `1`, not `0`.

## Vercel settings

Install command:

```bash
npm install --no-package-lock --no-audit --no-fund --legacy-peer-deps --prefer-online
```

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Node:

```text
20.x
```

## Vercel environment variables

```env
VITE_QAST_CONTRACT_ADDRESS=0x669fa07b8518d27b5F0286b78868505300eE6224
VITE_QIE_CHAIN_ID=1990
VITE_QIE_CHAIN_NAME=QIEMainnet
VITE_QIE_RPC_URL=https://rpc1mainnet.qie.digital/
VITE_QIE_EXPLORER_URL=https://mainnet.qie.digital
VITE_QIE_NATIVE_SYMBOL=QIEV3
VITE_FAUCET_URL=https://q-faucet-ymmi.vercel.app/
VITE_ADMIN_ADDRESS=0xb7f85bf000d0a37fc881bf5f1d80469f749fad98
VITE_TREASURY_ADDRESS=0x00e348677ae2b11a48fbe1bf452133c51ba833c3
```

Do not add `PRIVATE_KEY` to Vercel.
