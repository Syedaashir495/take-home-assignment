# Kontrora — Staff Engineer Assignment (Revenue & Billing)

PSA platform (Next.js App Router + Supabase). Implementation of **Estimates** scoped to accounts — shipped end-to-end with enterprise financial correctness, strict tenancy boundaries, and RBAC enforcement.

---

## Quick Setup & Running Tests

### 1. Database Setup
In your Supabase project's **SQL Editor**:
1. Run `supabase/schema.sql` (if on a brand-new Supabase project).
2. Run `supabase/estimates.sql` (creates `estimates`, `estimate_line_items`, `idempotency_keys`, triggers, indexes, and merges financial permissions into existing roles).

### 2. Environment Setup
```bash
cp .env.local.template .env.local
# Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are populated
```

### 3. Run the Test Suite
```bash
npm test
```
All 24 unit and integration tests across money math, lifecycle state machine, idempotency, and tenancy/RBAC run in **< 1 second** via Vitest:
- `__tests__/estimates/money-math.test.ts` (8 tests)
- `__tests__/estimates/lifecycle.test.ts` (7 tests)
- `__tests__/estimates/idempotency.test.ts` (4 tests)
- `__tests__/estimates/tenancy-rbac.test.ts` (5 tests)

### 4. Start Development Server
```bash
npm run dev
# Open http://localhost:3000/accounts/[accountId]
```

---

## Architecture Decisions

### 1. Minor Units for Money Representation
- **Why**: IEEE 754 floating-point numbers cannot accurately represent base-10 decimals, resulting in rounding drift ($0.1 + 0.2 \neq 0.3$).
- **Implementation**: All currency amounts (`subtotal_minor`, `tax_minor`, `total_minor`, `unit_price_minor`, `amount_minor`) are stored strictly as `BIGINT` integers representing minor units (e.g., cents, pence: $100.00 = 10,000 minor units).
- **Zero-Trust Server Validation**: The server never trusts client-computed financial totals. Every mutation computes:
  $$\text{amount\_minor} = \text{round}(\text{quantity} \times \text{unit\_price\_minor})$$
  $$\text{subtotal\_minor} = \sum \text{amount\_minor}$$
  $$\text{tax\_minor} = \text{round}(\text{subtotal\_minor} \times \text{tax\_rate})$$
  $$\text{total\_minor} = \text{subtotal\_minor} + \text{tax\_minor}$$
  PostgreSQL enforces: `CHECK (total_minor = subtotal_minor + tax_minor)`.

### 2. Production-Grade Idempotency Protocol
- **Header**: Mutating requests require an `Idempotency-Key` header (e.g. `Idempotency-Key: <UUID>`).
- **Storage**: Dedicated `idempotency_keys` table scoped to `(account_id, key)` with a 24-hour expiration index.
- **Payload Verification**: Computes a canonical SHA-256 hash of the incoming JSON body (using recursive, key-order-invariant serialization).
- **Semantics**:
  - **Cache Hit (Same Payload)**: Replays the cached 201 response with an `Idempotent-Replay: true` header.
  - **Conflict (Different Payload)**: Returns `409 Conflict` to prevent accidental double-billing or parameter drift.

### 3. Finite Lifecycle State Machine & Immutability
- **Lifecycle**: `draft` $\rightarrow$ `sent` $\rightarrow$ `accepted` | `rejected`.
- **Invariants**:
  - `draft -> sent`: Requires $\ge 1$ line item and `total_minor > 0`. Sets `sent_at = NOW()`.
  - `sent -> accepted`: Terminal state. Sets `accepted_at = NOW()`.
  - `sent -> rejected`: Terminal state. Sets `rejected_at = NOW()` and records `rejection_reason`.
  - **Mutation Lock**: Any attempt to modify headers or line items when `status != 'draft'` returns `422 Unprocessable Entity`.
  - **Hard-Delete Block**: Soft deletion only (`deleted_at = NOW()`). Accepted estimates can never be deleted.

### 4. Tenancy & Cross-Tenant Isolation
- **Dual-Bound Line Items**: Both `estimates` and `estimate_line_items` carry `account_id` directly, allowing fast, index-backed tenant scans and isolated RLS policies.
- **Cross-Tenant Project Link Prevention**: In addition to API-level boundary checks, PostgreSQL enforces tenant isolation through a composite foreign key:
  `FOREIGN KEY (project_id, account_id) REFERENCES projects(id, account_id) ON DELETE SET NULL`
  This guarantees that an estimate in Account A can never reference a project in Account B at the database level.
- **Hard-Delete Prohibition**: A PostgreSQL trigger `prevent_hard_delete` raises an exception on `BEFORE DELETE` to protect auditability and accounting records.

---

## Security & Tenancy Review

### Multi-Layer Defense in Depth
1. **Database Layer (Storage & RLS)**:
   - Row Level Security (RLS) enabled on `estimates`, `estimate_line_items`, and `idempotency_keys`.
   - Hard-delete trigger blocks SQL `DELETE`.
   - Composite foreign keys and check constraints guarantee mathematical and tenant integrity.
2. **Application Layer (API Middleware & RBAC)**:
   - `requireAuthAndPermission`: Every route validates session token and RBAC permission.
   - Context-Aware RBAC: `hasAccountAccess` verifies user membership, account manager role, or assigned account projects.
   - Client Portal Isolation: Users flagged with `is_client: true` are strictly confined to their `client_account_id`. Clients can only view their own account's estimates and can only perform `accepted` or `rejected` transitions on `sent` estimates.
3. **IDOR & Path Enumeration Prevention**:
   - Every fetch query enforces: `WHERE id = $estimateId AND account_id = $accountId AND deleted_at IS NULL`.
   - Accessing an estimate ID belonging to another account returns `404 Not Found` (preventing IDOR enumeration).

---

## What We Built

| Requirement | Implementation Details |
| :--- | :--- |
| **1. Schema** | `estimates` + `estimate_line_items` (`BIGINT` minor units, account-bound, optional project link with composite FK). |
| **2. Lifecycle** | `draft -> sent -> accepted \| rejected`. PostgreSQL trigger blocking hard deletes; soft deletes via `deleted_at`. |
| **3. RBAC** | `VIEW_ESTIMATES`, `MANAGE_ESTIMATES`, `VIEW_ALL_ESTIMATES`, `MANAGE_ALL_ESTIMATES`. Account boundary checks on all routes; client user isolation. |
| **4. API** | `GET /api/accounts/[id]/estimates` (server-side list, filters, search, pagination), `POST` (create with `Idempotency-Key`), `GET/PATCH/DELETE [estimateId]`, `POST [estimateId]/transition`. |
| **5. UI** | Responsive Estimates tab in `/accounts/[accountId]`: Metrics cards, search/filter data table, Create Draft dialog, interactive Line-Item Editor, Detail dialog with state transition buttons. |

---

## What to Ship Next (Production Roadmap)

1. **Stripe Billing / Invoice Conversion**:
   - When an estimate transitions to `accepted`, automatically invoke Stripe's Invoicing API to generate a draft or finalized Stripe Invoice (`stripe.invoices.create({ customer: stripeCustomerId })`).
   - Store `stripe_invoice_id` and payment link on the `estimates` record.
2. **Automated Webhooks & Payment Reconciliation**:
   - Implement `/api/webhooks/stripe` handling `invoice.paid`, `payment_intent.succeeded`, and `invoice.payment_failed`.
   - Reconcile payments against the estimate and update account revenue metrics in real-time.
3. **Escrow Funding Integration**:
   - Link accepted estimate line items to Kontrora's `escrows` table, automatically funding milestone escrow buckets upon agreement.
4. **Versioning & Revision Trees**:
   - Enable clients to request revisions on `sent` estimates, branching `EST-2026-001.v1` into `EST-2026-001.v2` with audit history.
5. **PDF Export & Client Signature**:
   - Server-side PDF generation (e.g. `@react-pdf/renderer`) and lightweight digital signature confirmation for external client portal view.
