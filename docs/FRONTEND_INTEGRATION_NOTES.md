# OyaEat frontend integration notes — Phases 1–6B

Use [FRONTEND_API_CONTRACT.md](./FRONTEND_API_CONTRACT.md) as the implemented endpoint reference. These are the migration items most likely to affect the Next.js application.

## Authentication and sessions

- Store one bearer access token and send it in `Authorization: Bearer ...`; roles are strictly isolated. Admin tokens no longer work accidentally on vendor/rider routes.
- On `401`, clear the session and return to the role's login page. This includes expiration, logout revocation, password reset/change, role change and deleted users.
- Do not treat all `403` as login failure. Branch on `EMAIL_NOT_VERIFIED`, `ACCOUNT_INACTIVE`, `RIDER_NOT_APPROVED`, `ADMIN_DISABLED`, `ADMIN_PERMISSION_DENIED`, and `BUSINESS_STATUS_FORBIDDEN`.
- Owner/rider tokens normally expire after 7 days; admin after 1 day; customer uses configured default. Do not decode JWT claims as authorization truth.
- Customer password changes on `PATCH /customer/auth/me` return a replacement token. Owner/rider/admin change-password requires reauthentication.
- Google web auth is `POST /api/v1/auth/google` with `{credential,clientType:"web"}`. Linking uses `/api/v1/auth/google/link`.
- Remove phone-OTP vendor calls. `/auth/verify-phone` and `/auth/resend-otp` return `410`; vendor verification is email challenge based.

## Vendor onboarding and status

- One owner can create only one restaurant. Handle `409 RESTAURANT_ALREADY_EXISTS` and use the returned/existing business.
- Registration does not authenticate until email verification returns a token.
- Upload the five compliance files under their exact multipart names. Document APIs never return permanent private URLs.
- Drive screens from BusinessStatus and backend `BUSINESS_STATUS_FORBIDDEN`, not from locally assumed approval.
- Rejected/suspended businesses retain status, permitted historical earnings, and eligible appeal access; operational UI must be disabled.
- Replace `/compliance/appeal` with `/compliance/businesses/:businessId/appeal`.

## Orders and payments

- The backend has no cart API. Keep the cart client-side and submit only `menuItemId/quantity`; never trust cached prices as authoritative.
- Payment initialization creates the order before Paystack. Persist returned `order.id` and `reference` before redirecting.
- A Paystack callback/return is not payment confirmation. Call `GET /orders/verify-payment/:reference` and show success only after verified payment/order state.
- On `PAYMENT_OUTCOME_UNKNOWN`, do not generate a second order/payment automatically. Show pending reconciliation and retain the supplied order/reference.
- Provider amounts and all `*Kobo` values are integer kobo; BigInt values arrive as strings. Naira compatibility fields remain numbers.
- Rider delivery completion for cash requires `cashCollected:true`; online orders must already be verified paid.

## Refunds

- Refund requests/statuses are now durable objects. `approved`, `submitted`, and `processing` do not mean the customer has received funds.
- Display success only for `succeeded`. Provide support states for `needs_attention`, `failed`, and `reconciliation_required`.
- Partial refund amounts are positive integer kobo strings/numbers and require admin review.
- Automatic cancellation refunds may be returned inside the order cancellation response, but remain pending/provider-processed afterward.

## Wallets, payouts and bank accounts

- Wallet amounts are currently naira numbers; financial/provider record amounts use integer kobo. Avoid floating-point calculations in the UI.
- Add a stable `Idempotency-Key` header to payout requests and retain it across safe transport retries.
- Payout account creation/replacement is asynchronous. Handle `202`, retain `operationId`, and poll `/admin/provider-account-operations/:operationId`.
- Do not mark a bank destination usable until provider status is `verified`; a pending replacement blocks new payouts.
- Account numbers are masked. Never ask APIs to return full stored numbers; full input is write-only during authorized configuration.
- Transfer/refund/provider mutations remain operationally disabled until sandbox/production certification. Queued or reconciliation states are expected.

## Documents and uploads

- Public restaurant/menu images stay public. Identity, compliance, bank and appeal documents require authorized signed access.
- Signed document URLs expire after 300 seconds and must not be placed in persistent state, analytics, logs or error reporting.
- Handle `LEGACY_DOCUMENT_MIGRATION_REQUIRED` by showing a support/remediation state, not attempting the old URL.
- Upload errors enforce type/count and a 5 MB size ceiling.

## Rider and realtime behavior

- Pending riders can authenticate and update onboarding profile but operational APIs return `RIDER_NOT_APPROVED` until approved.
- Authenticate Socket.IO with `auth: {token}`. Do not request/join role or rider rooms manually.
- Listen for `NEW_DELIVERY_REQUEST` and `broadcast`. Continue using HTTP for accept/decline/complete, location and chat actions.
- Reconnect sockets after token replacement. Existing sockets are not a durable source of current authorization state.

## Admin UI

- Admins require explicit capabilities. Render `ADMIN_PERMISSION_DENIED` rather than falling back to vendor behavior.
- Business/rider decisions may return `409 ADMIN_CONFLICT`; refresh state instead of blind retry.
- Finance screens need queues for provider operations, refunds, payouts and reconciliation-required records.
- `/admin/operations/metrics` returns Prometheus text, not JSON; it is primarily an operations integration.

## Compatibility and cleanup

- Prefer `/chat`; `/api/chat` remains an alias.
- Prefer `/vendor/broadcasts/*`; `/public/vendor/broadcasts/*` remains an authenticated alias.
- Both POST and PUT admin payout-resolution variants remain accepted; choose one canonical client method (`PUT` recommended for current `/api/wallet/admin/...` route).
- Some legacy endpoints do not include `success` or use top-level `token/dashboard/order`. Use per-endpoint parsing from the contract rather than a global response interceptor that requires `data`.
- `GET /vendor/status` currently duplicates values at top level and under `data`; read `data` first and tolerate the legacy shape.

## Recommended frontend migration order

1. Centralize bearer handling and role/status-aware `401/403/409/429` errors.
2. Update vendor email verification and onboarding state machine.
3. Update payment redirect/verification and `PAYMENT_OUTCOME_UNKNOWN` handling.
4. Add durable refund and provider-operation state UIs.
5. Update payout idempotency, masked bank display and asynchronous polling.
6. Replace private document links with just-in-time signed access.
7. Update rider operational gating and Socket.IO authentication.
8. Remove deprecated phone OTP/compliance calls and normalize compatibility response parsers.

The backend is locally validated but not production-approved. Frontend integration work must not enable provider execution flags or imply production financial readiness.
