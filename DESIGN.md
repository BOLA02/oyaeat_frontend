# OyaEat design system (green + orange)

One system for the public site, customer app, restaurant, rider and superadmin dashboards, matching the mobile app.
Tokens live in `app/globals.css` (`:root`, `.dark`, `@theme inline`). Never hardcode hex in new code;
use the semantic Tailwind classes below. Note: the legacy class names `violet-*` and `mango-*` are kept so existing
screens did not need rewriting; `violet-*` now resolves to the brand GREEN scale and `mango-*` to the ORANGE scale.

## Color roles
| Role | Token / class | Hex | Use |
|---|---|---|---|
| Brand / structure | `primary`, `violet-700` | `#066432` | headings accents, primary buttons, links, selected tabs, focus |
| Deep green | `sidebar`, `violet-900` | `#03381c` | sidebars, hero bands, dark surfaces |
| Soft green | `accent`, `secondary`, `muted`, `violet-50/100` | `#e6f2ea` | tinted cards, hover, chips |
| Orange (action) | `cta` / `cta-foreground`, `mango-400/500` | `#f25f00` | THE one key action per screen (Order now, Accept, Pay), promos, active sidebar marker |
| Orange deep | `mango-600/700` | `#c94d00` | orange text on light backgrounds (contrast safe) |
| Cream | `cream`, `mango-50/100` | `#fff1e4` | warm section backgrounds, warning chips |
| Ink | `foreground` / `muted-foreground` | `#10231a` / `#5f7066` | text |
| Success | `success`, `success-soft` | `#15803d` | delivered / approved / online status |
| Danger | `destructive` | `#c8372d` | errors, reject, cancel |

## Rules
1. Green is the default. Orange is scarce: at most one orange button per view, plus promo badges.
2. Orange buttons use `bg-cta text-cta-foreground` (white text). `accent` is NOT orange: it is the soft green hover surface shadcn components rely on.
3. The status "success" green (`success`) is only for delivered/approved/online chips; brand green is `primary`.
4. Headings use `font-display` (Baloo 2); body uses Geist. Radius `rounded-xl` for cards, `rounded-full` for pills/CTAs.
5. Every list/table screen needs a loading skeleton, an empty state and an error state.
6. Cards use `shadow-card`; popovers/menus use `shadow-pop`. No flat bordered-only layouts on dashboards.
7. Keep the same sidebar pattern across roles: deep green sidebar, orange active marker, cream/green-50 content area.

## Rollout order
1. Foundation (tokens, palette remap): done.
2. Shared components (`components/ui`: button, badge, card, table, tabs, stat-card, empty-state, skeleton).
3. Public pages: About, Features, How it works, Careers.
4. Customer app, then Restaurant, Rider, Superadmin, Partner signup.

## Customer app patterns (done)
- One shell (`components/customer/CustomerShell.tsx`): sticky top bar (logo, location, search, cart total, account) on all sizes,
  plus a 5-tab bottom bar on mobile (Home, Orders, Cart, Saved, Account). No sidebar. Auth guard lives here.
- One cart (`hooks/useCart.ts`), one restaurant view, one cart view: the `/customer/*` and `/customer/dashboard/*` routes render the same components.
- Every data screen has skeleton, empty (`EmptyState`) and error-with-retry (`ErrorState`) states: `components/customer/ui.tsx`.
- Home hierarchy: greeting, live order, promos, cuisine filter, order again, restaurants.
- Never show data the API did not send (no invented ratings, fees or rider details).

## Superadmin patterns (done)
- One shell in `app/superadmin/dashboard/layout.tsx` (`components/superadmin/AdminShell.tsx`): grouped deep-violet sidebar with a mango active marker and a live pending-approvals badge; on mobile a top bar with a slide-over drawer. It also owns the auth guard. Pages must NOT render their own sidebar or page padding.
- Shared pieces: `components/superadmin/ui.tsx` (AdminStat, Panel, Badge, OrderBadge) and `components/shared/states.tsx` (PageHeader, EmptyState, ErrorState, TableSkeleton).
- Tables become stacked cards below `md`. The primary action in a view (Approve, Save) is the single mango button.
- Admin pages read only `admin_token`; never fall back to another role's token.

## Restaurant (vendor) patterns (done)
- One shell (`components/restaurant/VendorShell.tsx`): sidebar on desktop; on mobile a top bar plus a bottom tab bar (Dashboard, Orders, Menu, Wallet, More). Owns the auth guard and the global new-order polling, sound and badge. Pages must not play their own order alerts.
- Orders is a kitchen view: items visible without expanding, one big mango next-step button, urgency for orders waiting 3+ minutes, destructive actions behind a confirmation. Auto-advance is a visible switch the vendor controls.
- Money and destructive actions (payout, delete dish, cancel order) always use a confirmation dialog and toast feedback, never `alert()` / `window.confirm`.
- Menu has a one-tap Available / Sold out switch per dish.

## Partner signup (done)
- Landing (`/partner-signup`) reuses the public `Navbar`/`Footer` inside `.landing`. Every later step uses `components/partner-signup/FlowShell.tsx` (header, 4-step stepper, one focused card) with `components/partner-signup/ui.tsx` (Field, FormError, PrimaryButton).
- Forms use real labels, inline validation and `autoComplete`; the password is never written to storage.
- Do not publish unverified social proof (named testimonials, "thousands of partners", invented tracking IDs).

## Rider portal patterns (done)
- `components/rider/RiderProvider.tsx` owns everything that must survive navigation: dashboard polling, GPS streaming, the order-request socket, and the shift/accept/complete actions (with toast errors). Pages read it with `useRider()`; they must not start their own watchers or sockets.
- `RiderShell`: the online/offline switch is in the top bar on every screen; mobile gets a bottom tab bar (Home, Trips, Earnings, Profile, More). New order offers (`IncomingRequestSheet`) appear on any screen with a vibrate + chime.
- Money and irreversible actions (confirm delivery, payout) use a confirmation dialog. No `alert()`.
- Marketing copy must come from what the product does. No invented earnings figures, ratings or insurance promises.

## Logo
Files live in `public/brand/` (PNG exports of the master artwork, same as the mobile app's `assets/brand/`). Use `components/brand/Logo.tsx` in the UI, never retype "oyaeat" as text.
- `oyaeat-logo.png` (horizontal, mark + wordmark) for light backgrounds; `oyaeat-logo-white.png` for green / dark backgrounds (the green letters turn white, the orange stays).
- `oyaeat-stacked.png` / `oyaeat-stacked-white.png`: tall version with the tagline "Great Food. Delivered.", via `<Logo layout="stacked" />`, for big hero spots (auth side panels).
- `oyaeat-icon-192/512.png`, `apple-touch-icon.png`; `app/icon.png` and `app/apple-icon.png` are what Next.js serves as the favicon.
- Rules: keep clear space around the logo; never stretch or recolour it; use the white variant on green.
