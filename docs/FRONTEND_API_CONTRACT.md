# OyaEat frontend API contract

Derived from the Express routes, controllers, middleware, Prisma schema and serializers on 2026-11-17. This describes implemented behavior, including compatibility quirks. It is not a proposal.

## 1. Conventions

- The API has no hard-coded `/api` root. Paths below are relative to the deployed backend origin.
- Send `Authorization: Bearer <access-token>` on protected routes.
- JSON normally uses `{ "success": true, "data": ... }`, but legacy vendor/rider/admin endpoints sometimes return top-level `token`, `dashboard`, `message`, `business`, `order`, or arrays. Do not assume one global envelope.
- Protected identity comes from the token/database, never a submitted `userId`. Owner routes containing `:userId` require it to equal the authenticated owner.
- BigInt kobo fields serialize as decimal strings. Compatibility naira fields remain JSON numbers. Never parse kobo strings through floating point.
- Account numbers are masked globally; encryption fields and configuration fingerprints are removed from JSON.
- Dates are ISO-8601 JSON strings.
- Common `500`: `{ "success": false, "message": "..." }`; some legacy endpoints additionally return `error` outside production.
- Common `404`: `{ "success": false, "message": "Route not found" }` or a resource-specific equivalent.

### Authentication failures

| Status | Meaning and client action |
|---|---|
| `401` | Missing, invalid, expired, revoked, stale-version, deleted-user or role-changed session. Clear the token and sign in again. `ROLE_CHANGED` and `LEGACY_TOKEN_RETIRED` may be returned. |
| `403` | Identity is valid but role, account status, business status or admin permission forbids the action. Do not loop login. Render the status/onboarding/appeal UI. Common codes: `ACCOUNT_INACTIVE`, `EMAIL_NOT_VERIFIED`, `RIDER_NOT_APPROVED`, `ADMIN_DISABLED`, `ADMIN_PERMISSION_DENIED`, `BUSINESS_STATUS_FORBIDDEN`. |
| `404` on owned resources | May deliberately hide another user's resource. Treat it as unavailable, not proof it exists. |
| `409` | State/idempotency/concurrency conflict. Refresh the resource before retrying. |
| `429` | Rate limit. Honor `Retry-After`; JSON includes `retryAfter`. |
| `503 RATE_LIMIT_UNAVAILABLE` | Shared request-protection store unavailable; retry later. |

### Status enums

- Role: `customer | owner | rider | admin`.
- User: `pending | verified | active | inactive`.
- Business: `draft | pending_review | approved | rejected | suspended`.
- Order: `pending | preparing | ready | out_for_delivery | delivered | cancelled`.
- Refund: `requested | awaiting_review | approved | submitted | processing | needs_attention | succeeded | failed | rejected | reconciliation_required`.
- Payout: `requested | reserved | queued | submitted | processing | succeeded | failed | reversed | reconciliation_required | cancelled`.
- Chat thread: `open | closed`.
- Provider/financial operations additionally expose implementation states such as `pending`, `processing`, `unknown`, `failed`, `succeeded`, and `reconciliation_required`. Render unknown values defensively.

### Money

- Order/menu compatibility prices, delivery fees, wallet balances and payout request `amount` are naira numbers.
- Provider-facing `amountKobo`, `priceKobo`, `totalKobo`, and similar fields are integer kobo serialized as strings when sourced from Prisma BigInt. Refund request `amountKobo` accepts a positive integer/string.
- Provider currency is currently `NGN`.
- Rider earnings display fields may be preformatted naira strings such as `₦5,000`; wallet summary remains numeric naira.

## 2. Customer authentication and account

| Method/path | Auth | Input | Success | Important errors/behavior |
|---|---|---|---|---|
| `POST /customer/auth/register` | Public | JSON required `firstName,lastName,email,phone,password` | `201`, `{success,message,data:{user,token}}` | `400` missing; `409` email/phone used. Signs customer in immediately. |
| `POST /customer/auth/login` | Public | Required `emailOrPhone,password` | `200`, `{success,message,data:{user,token}}` | `401` credentials; `403` non-customer or `ACCOUNT_INACTIVE`. |
| `GET /customer/auth/me` | Customer | — | `200`, `{success,data:{user}}` | `404` deleted user. |
| `PATCH /customer/auth/me` | Customer | Optional `firstName,lastName,phone`; password change requires `currentPassword,newPassword` | `200`, `{success,message,data:{user,token?}}` | `400` empty/nothing/short password; `401` wrong current password; `409` phone used. Password change increments token version and returns a replacement token. |
| `POST /customer/auth/logout` | Customer bearer | — | `200`, `{success:true,message}` | Selectively revokes presented token; repeated logout is safe. Clear local token regardless of response. |
| `POST /api/v1/auth/google` | Public | Required `credential`; optional `clientType` (`web` default, `android`, `ios`) | `200` existing or `201` created, `{success,message,data:{user,token}}` | Provider/identity errors include a stable `code`; rate limited. |
| `POST /api/v1/auth/google/link` | Customer | Required `credential`; optional `clientType` | `200`, `{success,message,data:{user}}` | Conflicting/invalid Google identity returns coded `4xx`. |
| `POST /customer/auth/forgot-password` | Public | Required `email` | `200`, generic `{success:true,message}` | `400` missing. Response intentionally does not reveal account existence. |
| `POST /customer/auth/reset-password` | Public | Required `token,password` (minimum 6 characters) | `200`, `{success:true,message}` | `400` missing, weak, expired or used token. Invalidates all sessions. |

The same forgot/reset implementation is mounted at `/auth/*`, `/auth/rider/*`, and `/admin/auth/*`; use the role-appropriate frontend path. Customer authenticated password changes should use `PATCH /customer/auth/me`, not an invented `/change-password` route.

## 3. Owner/vendor authentication and onboarding

| Method/path | Auth/status | Input | Success | Errors/notes |
|---|---|---|---|---|
| `POST /auth/register` | Public | Required `firstName,lastName,email,phone,password` | `201`, `{success,message,userId,verification,nextStep}` | `409` duplicate. Account remains pending/unverified if mail delivery fails. |
| `POST /auth/verify-email` | Public challenge | Challenge fields issued by backend, including `challengeId` and OTP/code | `200`, `{success,message,userId,token,nextStep}` | Coded challenge missing/expired/used/attempt-limit errors. Token is issued only after verification. |
| `POST /auth/request-email-otp` | Public | Required `email` | `200` with `verification`, or enumeration-safe `202` | `409 ALREADY_VERIFIED`; rate limited. |
| `POST /auth/resend-email-otp` | Public | Required `challengeId` | `200`, `{success,message,verification}` | `400 CHALLENGE_INVALID`, `409 ALREADY_VERIFIED`; rate limited. |
| `POST /auth/login` | Public | Required `email,password` | `200`, `{message,token,dashboard:{userId,role,emailVerified,phoneVerified,businesses},nextStep}` | `403 EMAIL_NOT_VERIFIED` or `ACCOUNT_INACTIVE`; owner token lasts 7 days. |
| `POST /auth/logout` | Owner | — | `200`, `{success,message}` | Selective revocation. |
| `POST /auth/change-password` | Owner | Required `currentPassword,newPassword` | `200`, `{success,message}` | Invalidates all tokens; frontend must sign in again. |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | Public | As customer reset above | Same generic/reset contracts | Shared User account flow. |
| `POST /auth/verify-phone`, `POST /auth/resend-otp` | Public, **deprecated** | Any | `410`, `{success:false,code:"ENDPOINT_RETIRED",replacement:"/auth/verify-email"}` | Remove frontend usage. |
| `POST /vendor/:userId/business-details` | Owner, verified email; self `userId` | Required `businessName,businessType,streetAddress,city,state,zipCode,businessPhone,businessEmail,description`; optional `websiteUrl,latitude,longitude` | `201`, `{message,businessId,status:"pending_review",nextStep}` | `409 RESTAURANT_ALREADY_EXISTS`; only one business per owner. |
| `POST /vendor/:businessId/upload-documents` | Owner/business; onboarding status | Multipart fields `business_license,tax_id,food_certificate,owner_id,bank_document`; each max one. Existing types may satisfy missing fields. | `200`, `{message,businessId,status:"pending_review",documents:[metadata]}` | `400` missing required type/file validation; `409 BUSINESS_STATE_CHANGED`. Private document URLs are never returned. |
| `POST /vendor/:businessId/upload-gallery` | Owner/business editable | Multipart `gallery`, max 5 | `201`, gallery metadata | Public marketing images. |
| `DELETE /vendor/gallery/:imageId` | Owner of image; editable business | — | `200`, `{success:true,message}` | `404` hides other owner's image. |
| `GET /vendor/status` | Owner | — | `200`, compatibility payload containing top-level and `data` copies of `userId,phoneVerified,business` | `business` is null before onboarding. Current response also contains legacy `debug:true`; do not depend on it. |
| `GET /vendor/:userId/status` | Owner/self, compatibility | — | Same as `/vendor/status` | Prefer canonical `/vendor/status`. |
| `GET /vendor/:userId/businesses?status=` | Owner/self | Optional BusinessStatus filter | `200`, `{userId,businesses}` | Document locations removed. One business maximum, but response remains an array. |
| `GET /vendor/business/:businessId` | Owner/business | — | `200`, `{business}` | Document locations removed. |
| `GET /vendor/dashboard` | Owner; missing business allowed | — | `200`, `{success,dashboard,data:{dashboard}}` or onboarding dashboard | Status-sensitive. |
| `POST /vendor/:businessId/bank` | Owner/business eligible | Required `bankName,accountName,accountNumber`; optional `routingNumber` | `200`, `{message,businessId,bankDetail}` | Account number is masked; provider-managed accounts return `403`. |
| `POST /vendor/bank` | Owner, compatibility | Same plus required `businessId` body | Same | Prefer business-scoped route. |
| `POST /compliance/businesses/:businessId/appeal` | Owner of rejected/suspended business | Multipart optional `evidence`; required `statement` | `200`, `{success,message,data:{businessStatus}}` | `409 APPEAL_NOT_ELIGIBLE` or `APPEAL_STATE_CHANGED`. |
| `POST /compliance/appeal` | Owner, **deprecated** | — | `410 ENDPOINT_RETIRED` with replacement path | Remove usage. |

Business permission policy: draft allows onboarding/documents/initial bank edits; pending review allows status and requested document corrections; approved enables operations; rejected allows remediation, historical earnings and appeals; suspended allows status, historical earnings and appeals only.

## 4. Vendor business operations

All routes below require owner authentication and ownership; admin tokens do not inherit vendor access.

| Endpoints | Input | Success | Restrictions/errors |
|---|---|---|---|
| `GET /vendor/business/:businessId/settings` | — | Settings/business object | Editable status required. |
| `PATCH|PUT /vendor/business/:businessId/settings` | Partial business settings | `200`, `{success,message,businessId}` | `404/403`; fields are controller-defined existing business settings. |
| `PATCH|PUT /vendor/business/:businessId/settings/:section` | Same partial body; `section` compatibility selector | Same | `section` does not create a distinct response contract. |
| `POST /vendor/business/:businessId/settings/thumbnail` | Multipart `thumbnail` | `{success,message,thumbnailUrl}` | Public image; `400` missing. |
| `POST /vendor/business/:businessId/settings/profile-pic` | Multipart `profilePic` | `{success,message,profilePicUrl}` | Public image; `400` missing. |
| `GET /vendor/menu` | — | `{success,data:{menu}}` | Approved business operational permission. |
| `POST /vendor/menu` | Multipart optional `image`; required `name,category,price`; optional `description,available` | `201`, `{success,data:{menuItem}}` | Price validated and dual-written; invalid precision is `400` with code. |
| `PATCH /vendor/menu/:itemId` | Any menu fields and optional `image` | `{success,data:{menuItem}}` | `404` for cross-business. |
| `DELETE /vendor/menu/:itemId` | — | `{success,message}` | `404` for cross-business. |
| `GET /vendor/staff` | — | `{success,data:{staff}}` | Approved business only. |
| `POST /vendor/staff` | Required `fullName,role`; optional `email,phone,status` | `201`, `{success,data:{staff}}` | — |
| `PATCH /vendor/staff/:staffId` | Optional staff fields | `{success,data:{staff}}` | `404` for cross-business. |
| `DELETE /vendor/staff/:staffId` | — | `{success,message}` | — |
| `GET /vendor/orders?status=&page=1&limit=20` | Query filters | `{success,data:{orders,pagination}}` | Only paid online orders are visible to kitchen. |
| `PATCH /vendor/orders/:orderId/status` | Required `status`; optional cancellation `reason` | `{success,data:{order}}` | Vendor allowed statuses exclude delivered; `402` unpaid; `403 BUSINESS_STATUS_FORBIDDEN`; `409` stale transition. Cancellation can create a refund asynchronously. |
| `GET /vendor/reviews?page=&limit=` | — | Reviews, rating aggregate and pagination | Limit max 50. |
| `GET /vendor/earnings` | — | `{success,data:{...}}` earnings/history | Rejected/suspended retain historical read access. |
| `POST /vendor/advert/submit` | Required advert content fields used by controller (`subject/content/targetRole`) | `201` advert/thread result | Approved/promotions permission. |
| `GET /vendor/broadcasts/my-active` | — | `{success,data:[...]}` | — |
| `POST /vendor/broadcasts/request-approval` | Multipart `image`; `title`, optional `desc,code,discount,durationHours` | `201`, approval request | Asynchronous admin review, not provider processing. |
| `PATCH /vendor/broadcasts/:id/toggle` | `isActive` boolean | `{success,data:promo}` | Ownership enforced. |
| `GET /vendor/notifications` | — | `{success,data:[notifications]}` | — |
| `POST /vendor/notifications/mark-read` | — | `{success,message}` | Marks all owner-business notifications read. |

Compatibility duplicates also exist at `/public/vendor/broadcasts/my-active`, `/public/vendor/broadcasts/request-approval`, and `/public/vendor/broadcasts/:id/toggle` with identical owner middleware. Prefer `/vendor/...`.

## 5. Rider

| Method/path | Auth/status | Input | Success | Errors/notes |
|---|---|---|---|---|
| `POST /auth/rider/register` | Public | Multipart required `firstName,lastName,email,phone,password,vehicleType,idDocument`; optional `plateNumber` | `201`, `{message,userId,role}` | Private authenticated document; no URL returned. |
| `POST /auth/rider/login` | Public | `email,password` | `{message,token,dashboard:{userId,role,riderProfile}}` | `403 ACCOUNT_INACTIVE`; pending riders can authenticate but cannot use operational routes. |
| `POST /auth/rider/logout` | Rider | — | `{success,message}` | Selective revocation. |
| `POST /auth/rider/change-password` | Rider | `currentPassword,newPassword` | `{success,message}` | Invalidates sessions. |
| `POST /auth/rider/forgot-password` | Public | Required `email` | Generic shared forgot-password response | Enumeration-safe and rate limited. |
| `POST /auth/rider/reset-password` | Public | Required `token,password` | Shared reset-password response | Invalidates all sessions. |
| `PUT /rider/profile/update` | Rider, onboarding allowed | Multipart optional `avatar`; optional `firstName,lastName,phone,vehicleType,plateNumber` | `{message,profile}` | Only route before operations capability gate. |
| `GET /rider/profile/identity-document/access` | Rider | — | Signed-document contract below | Onboarding access allowed; current DB identity required. |
| `GET /rider/dashboard` | Approved operational rider | — | Dashboard object (legacy top-level, no guaranteed `success`) | Contains only authorized available/assigned delivery data. |
| `POST /rider/shift/toggle` | Approved rider | — | Online/offline message/state | `403 RIDER_NOT_APPROVED`. |
| `PUT /rider/location/ping` | Approved online rider | Required numeric `latitude,longitude` | `200`, status/location acknowledgement | `409 RIDER_OFFLINE`. |
| `PUT /rider/orders/:orderId/accept` | Approved online rider | — | `{message,order}` | Atomic claim; `409` unavailable, payment/restaurant eligibility enforced. |
| `POST /rider/orders/:orderId/decline` | Approved rider | — | `{success,message}` | Rider-specific dismissal; does not globally cancel order. |
| `PUT /rider/orders/:orderId/complete` | Assigned approved rider | For cash orders required `cashCollected:true`; prepaid no body | `{message,order}` | `402` unverified payment; `409` already completed; settlement idempotent. |
| `GET /rider/support/threads` | Approved rider | — | `{success,threads}` | Rider-owned threads only. |
| `POST /rider/support/message` | Approved rider | Required `threadId,text` | `201`, `{success,message:<message-row>}` | `404` hides another rider's thread; text max 4000. |
| `GET /rider/earnings/summary` | Approved rider | — | `{success,metrics,transactions}` | Metrics mix numeric balance and formatted naira strings. |
| `GET /rider/operations-alerts` | Approved rider | — | `{success,data:[...]}` | Alias also at `/chat/operations-alerts`. |

## 6. Public restaurants, customer addresses, favourites, orders and reviews

| Method/path | Auth | Input | Success/errors |
|---|---|---|---|
| `GET /public/restaurants?page=1&limit=20&q=` | Public | Search/pagination query | `{success,data:{restaurants,pagination}}`; only approved businesses. |
| `GET /public/restaurants/:businessId/menu` | Public | — | `{success,data:{restaurant,menu}}`; `404` unavailable restaurant. Prices are naira numbers. |
| `GET /public/restaurants/:businessId/reviews?page=&limit=` | Public | — | `{success,data:{reviews,averageRating,reviewCount,totalReviews,distribution,pagination},pagination}`. |
| `GET /public/promos/public-feed` | Public | — | `{success,data:[...]}` active approved promos. |
| `GET /customer/addresses` | Customer | — | `{success,data:{addresses}}`. |
| `POST /customer/addresses` | Customer | Required `label,address`; optional `latitude,longitude,isDefault` | `201`, `{success,data:{address}}`; maximum 10. |
| `PATCH /customer/addresses/:id` | Customer | Partial address fields | `{success,data:{address}}`; `404` cross-customer. |
| `DELETE /customer/addresses/:id` | Customer | — | `{success,message}`. |
| `GET /customer/favorites` | Customer | — | `{success,data:{favorites,ids}}`. |
| `PUT /customer/favorites/:businessId` | Customer | — | Idempotent `{success,message}`. |
| `DELETE /customer/favorites/:businessId` | Customer | — | Idempotent `{success,message}`. |
| `POST /orders/delivery-quote` | Customer | Required `businessId`; optional `customerLatitude,customerLongitude` | `{success,data:{deliveryFee,distanceKm}}`. |
| `POST /orders` | Customer | Required `businessId,customerName,items:[{menuItemId,quantity}]`; optional `customerPhone,address,paymentMethod,notes,customerLatitude,customerLongitude` | `201`, `{success,data:{order}}`; server prices items/delivery. Use for cash/local order creation. |
| `GET /orders/my` | Customer | — | `{success,data:{orders}}` (customer-owned). |
| `POST /orders/:id/cancel` | Customer owner | Optional `reason` | `{success,message,data:{order,refund?}}`; only permitted states; paid eligible cancellation creates refund record, not completed money return. |
| `POST /orders/:id/review` | Customer owner | Required integer `rating` 1–5; optional `comment` max 1000 | `201`, `{success,data:{review}}`; delivered order once. |
| `GET /orders/:id/track-rider` | Customer owner | — | Authorized tracking data; `404` cross-customer, unavailable until assigned. |
| `POST /orders/:id/dispatch` | Owner of approved restaurant | — | Dispatch acknowledgement and rider socket notifications | Order/business eligibility enforced. |

**Cart API: NOT IMPLEMENTED.** The frontend must maintain its cart locally and submit item IDs/quantities to order or payment initialization. The backend always reprices from current menu data.

**Separate inventory API: NOT IMPLEMENTED.** Availability is the menu item's `available` boolean managed through vendor menu endpoints; stock quantities/reservations do not exist.

## 7. Payments and webhook

| Method/path | Auth | Contract |
|---|---|---|
| `POST /orders/initialize-payment` | Customer | Same required order fields as create order plus optional `callbackUrl`. Callback origin must be in `FRONTEND_URL`. Creates Order, Payment and FinancialOperation before provider call. Success `200`: `{success:true,data:{order,reference,authorization_url,access_code}}`. `409` if restaurant cannot take online payment. |
| `GET /orders/verify-payment/:reference` | Customer owning reference | Idempotent verification. Success `{success:true,data:{order,status:"success",reference,channel?,amount?}}`; provider `amount` is kobo. `404` cross-customer; `400` pending/mismatch; `502` provider unreachable. |
| `POST /webhooks/paystack` | Public provider signature, not frontend | Exact raw-body HMAC verification, durable ProviderEvent receipt, duplicate-safe acknowledgement. Frontend must never call it. |

`PAYMENT_OUTCOME_UNKNOWN` is returned as `502` when initialization times out after the durable local reference exists:

```json
{
  "success": false,
  "code": "PAYMENT_OUTCOME_UNKNOWN",
  "message": "Payment initialization is awaiting reconciliation. Do not retry with a new order yet.",
  "data": { "orderId": 123, "reference": "order_123_..." }
}
```

Store the `orderId/reference`, show a pending/reconciliation state, and poll existing order/verification only when instructed. Do not create a new order automatically.

Paystack redirect/return means only that the browser returned. It is not proof of payment. Show paid only after `/verify-payment/:reference` or a subsequently fetched order reports `paymentStatus: "paid"`.

Provider execution is controlled operationally. `FINANCIAL_PROVIDER_CALLS_ENABLED` and operation-specific transfer/refund/account flags default off; disabled asynchronous operations remain queued/reconciliation-visible rather than implying success.

## 8. Refunds

| Method/path | Auth | Input/success/errors |
|---|---|---|
| `POST /orders/:id/refunds` | Customer owning order | Required `category: late_cancellation|dispute|partial_refund`, `reason`; `amountKobo` required for partial and otherwise optional positive integer. `201`, `{success,data:{refund}}`; cash returns `400 CASH_ORDER_NO_PROVIDER_REFUND`; unsafe historical cases return reconciliation error. |
| `GET /orders/refunds` | Customer | `{success,data:{refunds}}`. |
| `GET /orders/refunds/:refundId` | Customer owner | Refund plus immutable `history`; `404` hides cross-customer. |
| `GET /admin/refunds?status=` | Admin `finance.manage` | Up to 200 refunds. |
| `GET /admin/refunds/:refundId` | Admin `finance.manage` | Refund plus history. |
| `POST /admin/refunds/:refundId/approve` | Admin `finance.manage` | Required `reason`; `{success,data:{refund}}`; concurrent invalid states conflict. |
| `POST /admin/refunds/:refundId/reject` | Admin `finance.manage` | Required `reason`; same envelope. |

Refund view fields: `id,orderId,paymentId,amountKobo` (string), `currency,reason,category,status,decisionType,reviewReason,accountingStatus,createdAt,updatedAt`, and optional history. `approved`, `submitted`, and `processing` do **not** mean funds arrived; only `succeeded` is provider-confirmed completion. `needs_attention`, `failed`, and `reconciliation_required` need support/admin handling.

Live refund execution remains disabled by default (`FINANCIAL_PROVIDER_CALLS_ENABLED` plus `PAYSTACK_REFUND_EXECUTION_ENABLED` would both be required).

## 9. Wallets, payout accounts and payouts

| Method/path | Auth | Contract |
|---|---|---|
| `GET /api/wallet/summary` | Operational owner/rider; admin technically allowed | `{success,data:{wallet:{balance,pendingPayouts,transactions},hasBankDetails,bankVerified,linkedBankAccount}}`. Balances are naira numbers; linked account text is masked. |
| `POST /api/wallet/request-payout` | Approved owner/rider | Required naira `amount`; optional `Idempotency-Key` header strongly recommended. Success `{success,message,data:{payoutId,status}}`. Manual reservation is synchronous; external resolution is later. Errors include insufficient balance, threshold, `PAYOUT_DESTINATION_UNVERIFIED`, `PAYOUT_DUPLICATE`, status restrictions. |
| `GET /admin/banks` | Admin `finance.manage` | `{success,data:[{name,code}]}`; provider availability dependent. |
| `GET /admin/payment-accounts` | Admin finance | Approved businesses with masked `account` or `submittedBank`. |
| `POST /admin/payment-accounts/resolve` | Admin finance | Required 10-digit `accountNumber,bankCode`; returns masked number and `accountName`. Synchronous provider read. |
| `GET /admin/businesses/:businessId/payment-account` | Admin finance | `{success,data:account|null}` masked. |
| `PUT /admin/businesses/:businessId/payment-account` | Admin finance | Required `bankCode,bankName,accountNumber`; optional `commissionPercent` 0–<100. `202`, `{success,data:{...,status,operationId,replay}}`. |
| `DELETE /admin/businesses/:businessId/payment-account` | Admin finance | `202`, queued deactivation with `operationId`. |
| `GET /admin/rider-payout-accounts` | Admin finance | Masked recipient configuration list. |
| `PUT /admin/riders/:userId/payout-account` | Admin finance | Required `bankCode,bankName,accountNumber`; `202` queued with status/operationId/configVersion/replay. |
| `GET /admin/provider-account-operations/:operationId` | Admin finance | `{success,data:{id,operationType,resourceType,resourceId,environment,status,attemptCount,lastErrorCode,createdAt,updatedAt}}`. Poll this after `202`. |
| `GET /admin/cash-commissions` | Admin finance | Negative vendor receivables as `{userId,businessId,name,owed}` naira. |
| `POST /admin/cash-commissions/:userId/settle` | Admin finance | Required naira `amount`; updates ledger atomically. |
| `GET /api/wallet/admin/financial-queue-logs` | Admin finance | Financial/payout queue diagnostics. |
| `POST /api/wallet/admin/onboard-bank` | Admin finance | Required `userEmail,userType:restaurant|rider,bankName,accountNumber,accountName`; compatibility/manual configuration, masked/encrypted storage. Canonical alias also `POST /admin/onboard-bank`. |
| `PUT|POST /api/wallet/admin/resolve-payout/:transactionId` | Admin finance | Required `resolutionReference,reason`; auditable manual resolution. Aliases also under `/admin/resolve-payout/:transactionId`. |
| `GET /admin/financial-reconciliation` | Admin finance | `{success,data:{operations,events,issues,...}}` bounded reconciliation view. |

For every `202`, retain `operationId` and poll the operation endpoint. UI states must distinguish `pending/processing`, `failed`, `unknown`, and `reconciliation_required`; never convert queued to verified optimistically. A replacement bank destination makes the old destination ineligible for new payouts until the new configuration is verified.

Real transfers require both global and transfer execution flags and remain disabled by default. Automatic rider transfers are separately disabled.

## 10. Private documents

| Method/path | Auth | Success/errors |
|---|---|---|
| `GET /vendor/business/:businessId/documents/:documentId/access` | Owning owner; allowed business status | `200`, `{success:true,data:{url,expiresIn:300}}`. |
| `GET /rider/profile/identity-document/access` | Current rider | Same. |
| `GET /admin/businesses/:businessId/documents/:documentId/access` | Admin `documents.read_sensitive` | Same. |

Responses set `Cache-Control: private, no-store`. Fetch a URL immediately and never persist/log it. Request another after expiry. `404` hides unauthorized IDs; `409 LEGACY_DOCUMENT_MIGRATION_REQUIRED` means the old asset cannot be safely delivered; `503 DOCUMENT_SIGNING_FAILED` is retryable. Sensitive documents are not served from `/uploads`; only `/uploads/public/*` is static and intended for public legacy marketing assets.

Uploads enforce file-type/size rules; the global size error says maximum 5 MB. Vendor compliance accepts the five named fields above; rider identity uses `idDocument`; appeal evidence uses `evidence`.

## 11. Chat, notifications, tracking and WebSocket

`/chat/*` is canonical; every route is also mounted as `/api/chat/*` for compatibility.

| Method/path | Auth | Input/success |
|---|---|---|
| `GET /chat/threads` | Any authenticated role | `{success,data:[threads]}` participant-scoped. |
| `POST /chat/threads` | Authenticated | Required `subject`; optional permitted `type,targetUserId` depending on role | `201`, `{success,data:thread}`; arbitrary unrelated membership rejected. |
| `GET /chat/threads/:threadId/messages` | Participant/admin as implemented | `{success,data:[messages]}`; unauthorized reference returns `404`. |
| `POST /chat/threads/:threadId/messages` | Participant | Required nonblank `content` | `201`, `{success,data:message}`. |
| `PATCH /chat/threads/:threadId/status` | Authorized participant/admin | Required `status: open|closed` | `{success,data:thread}`. |
| `DELETE /chat/threads/:threadId` | Admin | `{success,message}`. |
| `GET /chat/operations-alerts` | Approved rider | `{success,data:[...]}`. |

Socket.IO authentication uses `handshake.auth.token` (preferred) or `Authorization: Bearer`. The same database identity, token version, revocation, role and account-status checks apply. Rooms are server-derived: `role_<role>`, `rider_<userId>`, and admin operations room. Clients cannot choose privileged rooms.

Server-to-client events currently implemented:

- `NEW_DELIVERY_REQUEST` to an eligible rider's private room; payload is minimized order discovery data.
- `broadcast` to a database-derived role audience or all authenticated sockets.

There are no client-to-server business event handlers beyond Socket.IO disconnect; use HTTP for chat, location, order actions and status changes. Already-connected sockets are not guaranteed to be instantly disconnected on token revocation; sensitive HTTP/event-producing actions revalidate state.

## 12. Administrator

### Authentication

| Method/path | Input/success | Notes |
|---|---|---|
| `POST /admin/auth/login` | `email,password`; `{success,message,token,admin:{id,email,role}}` | `403 ADMIN_DISABLED`; admin token lasts 1 day. |
| `POST /admin/auth/logout` | `{success,message}` | Selective revocation. |
| `POST /admin/auth/change-password` | `currentPassword,newPassword` | Invalidates all tokens. |
| `POST /admin/auth/forgot-password` | Required `email`; generic shared response | Enumeration-safe and rate limited. |
| `POST /admin/auth/reset-password` | Required `token,password`; shared reset response | Invalidates all admin sessions. |

All remaining `/admin` and `/admin/dashboard` routes require current admin database identity and active/verified status. Permission-protected routes return `403 ADMIN_PERMISSION_DENIED`.

### Business, rider and dashboard

| Endpoints | Input/success | Permission/notes |
|---|---|---|
| `GET /admin/businesses/stats` | Business status counts | Admin. |
| `GET /admin/businesses/pending` | Pending business list in the controller data envelope | Admin. |
| `GET /admin/businesses/approved` | `{success,data:{businesses}}` | Admin. |
| `GET /admin/businesses/rejected` | `{success,data:{businesses}}` | Admin. |
| `GET /admin/businesses/suspended` | `{success,data:{businesses}}` | Admin. |
| `GET /admin/businesses?status=&page=1&limit=20` | Paginated list | Admin. |
| `GET /admin/businesses/:businessId` | Detailed business | `documents.read_sensitive`. Document storage URLs still removed/signed separately. |
| `POST /admin/businesses/:businessId/approve` | No required body | `business.review`; `409 ADMIN_CONFLICT`. |
| `POST /admin/businesses/:businessId/reject` | Required `reason` | `business.review`. |
| `POST /admin/businesses/:businessId/suspend` | Required `reason`; optional `suspensionType` (`shadow` default) | `business.review`; coordinates with operations/payout locks. |
| `PATCH /admin/businesses/:businessId/status` | `status: approved|rejected|suspended`, plus relevant reason fields | Dispatches to same handlers; other status is `400`. |
| `GET /admin/orders?status=&page=1&limit=200` | Global orders/pagination | Admin. |
| `GET /admin/dashboard/metrics` | Dashboard metrics | Admin. |
| `GET /admin/dashboard/live-riders` | Legacy top-level formatted fleet array | Admin. |
| `GET /api/rider/admin/all` | Rider list | `rider.manage`. |
| `PATCH /api/rider/admin/:id/status` | `status` accepted by controller (`pending|verified|active|inactive`) | `rider.manage`; auditable. |
| `PATCH /api/rider/admin/:id` | Optional `firstName,lastName,phone,vehicleType,plateNumber` | `rider.manage`. |
| `DELETE /api/rider/admin/:id` | — | `rider.manage`; conflicts if protected history prevents removal. |

### Broadcasts, settings and operations

| Endpoints | Contract |
|---|---|
| `GET /admin/broadcasts/approved-list` | `{success,data,businesses}`; `businesses` is compatibility duplicate. |
| `GET /admin/broadcasts/pending-reviews` | Pending promo array. |
| `GET /admin/broadcasts/active` | Active promo array. |
| `GET /admin/broadcasts/rejected-history` | Rejected promo history array. |
| `PATCH|POST /admin/broadcasts/:id/approve` | Optional sanitized `title,desc`; `broadcast.manage`. |
| `PATCH|POST /admin/broadcasts/:id/reject` | Required `reason`; `broadcast.manage`. |
| `PATCH|POST /admin/broadcasts/:id/toggle` | `isActive`; `broadcast.manage`. |
| `DELETE /admin/broadcasts/:id` | Deletes promo instance; `broadcast.manage`. |
| `POST /admin/broadcast` | Required broadcast content and target role as controller expects | `broadcast.manage`; emits socket `broadcast`. |
| `GET /admin/settings` | `{success,data:...}` | `settings.manage`. |
| `PATCH|PUT /admin/settings` | Allowed setting key/value updates | `settings.manage`; invalid keys `400 INVALID_SETTING`. |
| `GET /admin/operations/health` | Protected structured worker/financial health | `finance.manage`. |
| `GET /admin/operations/metrics` | Prometheus text, not JSON | `finance.manage`. |

`GET /public/promos` is a backward-compatible admin-authenticated alias for active promos. Do not treat it as public.

## 13. Health and non-product routes

- `GET /health` and `GET /health/live`: `200 {success:true,status:"alive",service:"http"}`.
- `GET /health/ready`: `200` or `503`, `{success,status:"ready|not_ready",checks}`.
- `GET /api-docs`: Swagger UI; may lag this source-derived contract.
- `GET /docs-test`: `{ok:true}` diagnostic compatibility route; not a product API.

## 14. Representative sanitized examples

Customer login:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": 42, "firstName": "Ada", "lastName": "User", "email": "ada@example.test", "phone": "+234000000000", "role": "customer" },
    "token": "<access-token>"
  }
}
```

Queued provider account:

```json
{
  "success": true,
  "data": {
    "bankName": "Example Bank",
    "accountNumber": "******6789",
    "status": "pending",
    "operationId": "<uuid>",
    "configVersion": 2,
    "replay": false
  }
}
```

Refund:

```json
{
  "id": "<uuid>",
  "orderId": 123,
  "paymentId": "<uuid>",
  "amountKobo": "125000",
  "currency": "NGN",
  "status": "processing",
  "decisionType": "manual",
  "accountingStatus": "reserved"
}
```

Signed document access:

```json
{ "success": true, "data": { "url": "<short-lived-signed-url>", "expiresIn": 300 } }
```

## 15. Explicitly not implemented

- Backend cart persistence/API.
- Stock-count inventory/reservation API.
- Customer-facing payout-account editing.
- Customer wallet routes.
- General frontend endpoint to poll payment-initialization reconciliation by operation ID; retain order/reference and use existing order/verification/support flows.
- Live refund/transfer/provider-account execution by default; operational flags are off.
- Client-originated Socket.IO chat/order/location actions.
- A public legacy-document migration endpoint.
- Full automatic refund policy for unresolved post-settlement/split liability cases; those fail closed to review/reconciliation.
