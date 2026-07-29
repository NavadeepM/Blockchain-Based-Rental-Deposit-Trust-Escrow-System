# API Reference

Base URL: `http://localhost:5000/api`. All routes except `/auth/onboard`'s
initial call and `/payment/webhook` require an `Authorization: Bearer <Firebase ID token>` header.

## Auth
| Method | Route | Description |
|---|---|---|
| POST | `/auth/onboard` | Create/update the Mongo profile for the signed-in Firebase user |
| GET | `/auth/me` | Fetch the current user's profile |

## KYC
| Method | Route | Description |
|---|---|---|
| POST | `/kyc/submit` | Upload ID document (`multipart/form-data`: `idType`, `idNumber`, `idDocument`) |
| POST | `/kyc/liveness` | Submit a liveness confidence score (0-100) |
| GET | `/kyc/status` | Get current KYC + trust score state |

## Trust score
| Method | Route | Description |
|---|---|---|
| GET | `/trust/me` | Recompute and return the caller's trust score + suggested deposit multiplier |
| GET | `/trust/:userId` | View another user's public trust summary |

## Escrow
| Method | Route | Description |
|---|---|---|
| POST | `/escrow/agreements` | Landlord drafts an agreement; returns on-chain call params |
| PATCH | `/escrow/agreements/:id/confirm-created` | Confirm the on-chain `createAgreement` tx |
| GET | `/escrow/agreements` | List agreements for the current user |
| GET | `/escrow/agreements/:id` | Get one agreement, merged with live on-chain state |
| PATCH | `/escrow/agreements/:id/confirm-funded` | Confirm the on-chain `fundDeposit` tx |
| POST | `/escrow/agreements/:id/complete` | Mark completed + update reputation/trust score |

## Payment (Razorpay)
| Method | Route | Description |
|---|---|---|
| POST | `/payment/create-order` | Create a Razorpay order for the deposit |
| POST | `/payment/verify` | Verify checkout signature (HMAC) |
| POST | `/payment/refund` | Refund the captured payment (on escrow release) |
| POST | `/payment/webhook` | Razorpay server-to-server webhook (raw body, signature-verified) |

## Dispute
| Method | Route | Description |
|---|---|---|
| POST | `/dispute/:agreementId/raise` | Upload evidence, get back a hash + IPFS URI to anchor on-chain |
| POST | `/dispute/:agreementId/counter-evidence` | Other party submits counter-evidence |
| POST | `/dispute/:agreementId/resolve` | Arbitrator submits a basis-point verdict; relays `resolveDispute()` on-chain |

---

## Example: full happy-path curl sequence (illustrative — needs real tokens)

```bash
# 1. Onboard
curl -X POST $BASE/auth/onboard -H "Authorization: Bearer $TOKEN" \
  -d '{"fullName":"Asha Rao","role":"tenant","walletAddress":"0xabc..."}'

# 2. Submit KYC
curl -X POST $BASE/kyc/submit -H "Authorization: Bearer $TOKEN" \
  -F idType=aadhaar -F idNumber=123412341234 -F idDocument=@id.jpg

# 3. Liveness check
curl -X POST $BASE/kyc/liveness -H "Authorization: Bearer $TOKEN" \
  -d '{"livenessScore": 91}'

# 4. Landlord creates agreement
curl -X POST $BASE/escrow/agreements -H "Authorization: Bearer $LANDLORD_TOKEN" \
  -d '{"tenantId":"...","assetType":"property","assetDescription":"2BHK Koramangala","depositAmountINR":50000,"rentalStartsAt":"2026-08-01","rentalEndsAt":"2027-08-01"}'
```
