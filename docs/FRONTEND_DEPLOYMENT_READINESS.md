# OyaEat frontend deployment readiness

Date: 2026-11-17

## 1. Changes implemented

- Preserved the existing dirty worktree and built on the customer/cart work already present.
- Added tab-local, role-specific customer/vendor/rider/admin session storage and removed cross-role chat-token fallback.
- Centralized role request handling with 401 session clearing and preserved 403 business/permission responses for UI handling.
- Kept customer Google sign-in on `POST /api/v1/auth/google` and customer cart ownership keyed by stable customer ID.
- Replaced vendor phone verification calls with the email challenge endpoints.
- Replaced the retired unscoped compliance appeal endpoint with the business-scoped route.
- Persisted pending payments by customer ID, order ID and Paystack reference. Payment returns now verify through `GET /orders/verify-payment/:reference`; carts are cleared only when that exact order is returned as paid.
- Added a retained `Idempotency-Key` for payout transport retries.
- Disabled the unsupported email-based bank-account onboarding UI and removed public demo credentials.
- Explicitly labelled landing-page restaurant cards as preview data and removed fake newsletter success behavior.
- Replaced broken public support/legal navigation with working email support and an honest pending-policy notice; no policy text was invented.
- Removed network-fetched Google fonts from the production build.
- Restored ESLint and added production security headers compatible with HTTPS APIs, WebSockets, Google Identity/Maps and Paystack frames/scripts.
- Documented required public environment variables in `.env.example`.

## 2. Files modified

Primary implementation files include `lib/customer.ts`, `lib/cartStorage.ts`, `lib/roleSession.ts`, `lib/api/chat.ts`, `lib/api/adminHttp.ts`, `lib/api/vendor.ts`, `lib/api/walletService.ts`, customer checkout/orders/auth components, vendor onboarding and appeal screens, rider/admin authentication shells, `next.config.mjs`, `app/layout.tsx`, `eslint.config.mjs`, `package.json`, `package-lock.json`, and regression tests under `tests/`.

The repository already contained many unrelated modified/untracked UI and branding files before this pass; they were preserved and not reverted.

## 3. Backend contracts integrated

- Customer auth/profile/logout, Google auth, addresses, order creation, payment initialization and payment verification.
- Owner registration, email verification/resend, login, onboarding status and business-scoped appeals.
- Strict owner/rider/admin bearer isolation and documented session-expiry behavior.
- Vendor operations already represented by the existing menu/staff/orders/reviews/earnings clients.
- Rider dashboard/profile/delivery/wallet routes already represented by existing screens, with tab-local bearer selection.
- Admin business/rider/broadcast/settings and compatibility wallet routes already represented by existing screens.

## 4. Features working

- Customer email and Google sessions, account-isolated carts, checkout, cash-order cart clearing, and verified online-payment cart clearing.
- Vendor email challenge onboarding and role-isolated dashboard access.
- Rider/admin role-isolated login and dashboard access.
- Production compilation without remote font downloads.

## 5. Features intentionally disabled

- Manual email-based bank account onboarding.
- Any claim or UI implication that queued provider/refund/payout work is completed before a `succeeded` state.
- Newsletter submission until a documented subscription endpoint exists.
- Unpublished legal-policy links.
- Live provider execution flags; this frontend does not enable real financial execution.

## 6. Test results

- TypeScript: PASS (`tsc --noEmit`).
- ESLint: PASS with 54 non-blocking warnings and zero errors.
- Unit tests: PASS, 19/19.
- `git diff --check`: PASS (line-ending conversion warnings only; no whitespace errors).
- Dependency audit: 12 advisories reported by npm (2 moderate, 9 high, 1 critical); these require dependency-owner review before deployment.

## 7. Production build result

PASS. Next.js 16.0.10 completed the optimized build and generated all 62 routes. The previous Google Fonts network failure is removed.

## 8. Remaining deployment blockers

- npm reports one critical and nine high dependency advisories. Do not use `npm audit fix --force` without reviewing breaking changes.
- Backend/provider behavior was not exercised from this repository. Paystack, Google, Maps, signed-document access, provider-account polling, refunds, payouts and reconciliation queues still require a configured staging environment and role fixtures.
- Dedicated admin refund/reconciliation queue UI and just-in-time signed private-document access are not fully represented in the current frontend. They must be completed or explicitly excluded from the release scope.
- Approved Privacy, Terms and Cookie policies have not been supplied; links remain intentionally unpublished.
- Production values for API origin, frontend origin, Google client ID, Maps key and map ID must be supplied and allow-listed.
- The CSP currently permits `'unsafe-inline'` and `'unsafe-eval'` because Next.js and the existing Google/Paystack integrations need compatibility validation. Tighten it with nonces after staging verification.
- ESLint warnings should be reduced, especially stale hook dependency warnings, but there are no lint errors.

## 9. Recommendation

**NO-GO for public production/VPS deployment today.** The frontend build itself is releasable to a controlled staging environment, but the dependency advisories, missing approved legal documents, incomplete finance/reconciliation/document screens, and unverified provider/backend integration remain production blockers.

Provider integration is not claimed as verified.
