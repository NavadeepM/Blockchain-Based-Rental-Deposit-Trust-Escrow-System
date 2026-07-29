# Blockchain Based Rental Deposit & Escrow System

A blockchain-backed security deposit escrow platform for rental agreements
(property, equipment, or freelance gigs). Deposits are locked in a Solidity
smart contract instead of held by one party, removing "who keeps the deposit"
disputes and giving both sides on-chain, tamper-proof traceability.

Built for a 2026-era stack: **React + Node.js/Express + MongoDB + Solidity
(Ethereum/Sepolia) + Firebase Auth + Razorpay + IPFS.**

---

## Why this stands out

- **The escrow logic isn't a toy contract.** `RentalEscrow.sol` implements
  four independent release paths (mutual signoff, auto-release timeout,
  arbitrator dispute split, cancellation-before-funding), each with its own
  state-machine guards — and it's backed by **17 passing Hardhat tests**
  covering the happy path, edge cases, and adversarial calls (wrong signer,
  wrong amount, double-funding, bare ETH transfers, out-of-range splits).
- **A real trust-scoring algorithm**, not a placeholder. `trustScoreEngine.js`
  combines KYC completeness, liveness confidence (with time-decay), rental/
  payment history (completion rate + punctuality + a log-scaled volume
  bonus), and platform reputation into a weighted 0–100 score with tiers —
  the same shape as alternative-credit-scoring models for users without a
  traditional financial trail.
- **Fiat and crypto rails are bridged, not just juxtaposed.** Tenants pay
  the deposit in INR via Razorpay (familiar UX), which is then mirrored as
  an equivalent ETH lock in the smart contract — so the deposit is
  *provably* escrowed on-chain even though the user never touched a wallet
  UI to pay.
- **Evidence is tamper-proof without bloating gas costs.** Dispute photos
  and condition reports are bundled into a manifest, pinned to IPFS, and
  only the manifest's keccak256 hash + CID go on-chain — full
  provenance, minimal gas.

---

## Architecture

```
┌─────────────┐        Firebase OTP auth        ┌──────────────────┐
│   React     │ ───────────────────────────────▶ │  Firebase Auth   │
│  Frontend   │                                   └──────────────────┘
│  (Vite)     │        REST (Bearer ID token)
│             │ ────────────────────────────────▶ ┌──────────────────┐
│  ethers.js  │                                    │  Node/Express API │
│  (MetaMask) │                                    │  + MongoDB         │
└──────┬──────┘                                    └────────┬───────────┘
       │  signs txs directly                                │
       │  from the user's own wallet                        │ Razorpay orders/
       ▼                                                     │ refunds/webhooks
┌─────────────────┐   read/write escrow state    ┌───────────▼─────────┐
│ RentalEscrow.sol │ ◀──────────────────────────▶ │      Razorpay        │
│ (Sepolia)        │                               └──────────────────────┘
└─────────┬────────┘
          │ evidence hash + CID only
          ▼
   ┌──────────────┐
   │     IPFS      │  (full evidence files: photos, condition reports)
   └──────────────┘
```

Key design decision: **the backend never holds user private keys.** All
on-chain writes (`createAgreement`, `fundDeposit`, `confirmCompletion`,
`raiseDispute`) are signed client-side via the connected wallet. The backend
only signs `resolveDispute` using a platform-controlled arbitrator key,
mirroring a real dispute-resolution authority (which in a v2 could be a DAO
multisig instead of a single key).

---

## Repository layout

```
contracts/   Hardhat project — RentalEscrow.sol, tests, deploy script
backend/     Express API — auth, KYC, trust scoring, escrow orchestration,
             Razorpay, dispute/evidence handling
frontend/    React (Vite) app — onboarding, KYC, dashboard, agreement
             creation, wallet-signed escrow actions, dispute UI
docs/        Additional API reference
```

---

## 1. Smart contract (`/contracts`)

```bash
cd contracts
npm install

# Compiles via the npm-distributed solc (works fully offline — no binary
# download required, unlike a bare `npx hardhat compile`).
npm run compile

# Runs the full test suite against an in-memory Hardhat network.
npm test
```

Expected output: **17 passing tests** covering agreement creation, funding,
mutual completion, auto-release timeouts, dispute raising with evidence
hashes, arbitrator basis-point splits, and security edge cases.

To deploy to Sepolia:

```bash
cp .env.example .env   # fill in SEPOLIA_RPC_URL + DEPLOYER_PRIVATE_KEY
npm run deploy:sepolia
```

This writes the deployed address + ABI to `contracts/deployments/sepolia.json`
— copy the address into both `backend/.env` (`ESCROW_CONTRACT_ADDRESS`) and
`frontend/.env` (`VITE_ESCROW_CONTRACT_ADDRESS`).

## 2. Backend (`/backend`)

```bash
cd backend
npm install
cp .env.example .env   # fill in MongoDB, Firebase Admin, Razorpay, RPC keys
npm run dev
```

Runs on `http://localhost:5000`. See `docs/API.md` for the full route
reference. Health check: `GET /health`.

## 3. Frontend (`/frontend`)

```bash
cd frontend
npm install
cp .env.example .env   # fill in Firebase client config + contract address
npm run dev
```

Runs on `http://localhost:5173`, proxying `/api` to the backend.

---

## Core user flow

1. **Onboard** — phone OTP via Firebase Auth, connect MetaMask wallet.
2. **KYC** — upload an ID document + run a selfie liveness check. Both
   feed the trust score engine.
3. **Landlord creates an agreement** — drafted in MongoDB, then the
   landlord's wallet signs `createAgreement()` on Sepolia.
4. **Tenant funds the deposit** — pays via Razorpay in INR; on success the
   equivalent ETH amount is locked into the contract from the tenant's
   wallet.
5. **Tenancy ends cleanly** → both parties call `confirmCompletion()` (2-of-2
   signoff) or, if the landlord goes unresponsive, anyone can trigger
   `autoReleaseAfterWindow()` once the dispute window has elapsed.
6. **Tenancy ends in dispute** → either party uploads evidence (photos +
   condition report), which is pinned to IPFS; the resulting hash is
   anchored on-chain via `raiseDispute()`. An arbitrator reviews both
   bundles and calls `resolveDispute()` with a basis-point split, which
   pays out both parties atomically in the same transaction.

---

## Trust score formula

```
score = 0.25 · KYC_score
      + 0.15 · liveness_score (decayed if stale)
      + 0.35 · history_score (completion rate, punctuality, volume bonus)
      + 0.25 · reputation_score (ratings, linked accounts, account age)
```

Tiers: `unrated` (0) → `low` (1–39) → `medium` (40–64) → `high` (65–84) →
`excellent` (85–100). See `backend/services/trustScoreEngine.js`.

---

## Security notes / production hardening checklist

- Add role-based access control for the `/dispute/:id/resolve` route
  (currently gated only by "any authenticated user" in this demo — should
  require an `arbitrator` role or DAO-multisig-triggered call).
- Replace the simulated KYC provider callback (`setTimeout` in
  `routes/kyc.js`) with a real webhook from a licensed KYC vendor
  (DigiLocker/Aadhaar eKYC/passport OCR).
- Replace the simulated liveness score in the frontend with an actual
  face-match SDK challenge (blink/head-turn) run client-side or via a
  vendor API.
- Move the ETH/INR conversion rate off a static env var onto a live price
  oracle (e.g. Chainlink) before handling real funds.
- Add a circuit breaker / pausable pattern to `RentalEscrow.sol` for
  emergency stops, and consider a timelock on arbitrator key rotation.
- Run a professional audit before mainnet deployment — this contract has
  not been audited.
