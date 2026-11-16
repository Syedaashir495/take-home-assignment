-- =============================================================
-- ESTIMATES, LINE ITEMS & IDEMPOTENCY KEYS MIGRATION
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
-- =============================================================

-- 0. Ensure projects table has unique constraint on (id, account_id)
--    This enables composite foreign key verification for tenant isolation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_projects_id_account'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT uk_projects_id_account UNIQUE (id, account_id);
  END IF;
END $$;

-- =============================================================
-- 1. ESTIMATES TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS estimates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id        UUID,
  estimate_number   TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  currency          TEXT NOT NULL DEFAULT 'USD',
  subtotal_minor    BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  tax_minor         BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor       BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  valid_until       DATE,
  sent_at           TIMESTAMPTZ,
  accepted_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,
  idempotency_key   TEXT,
  CONSTRAINT uk_estimates_account_number UNIQUE (account_id, estimate_number),
  CONSTRAINT chk_estimates_total_consistency CHECK (total_minor = subtotal_minor + tax_minor),
  CONSTRAINT fk_estimates_project_account FOREIGN KEY (project_id, account_id)
    REFERENCES projects(id, account_id) ON DELETE SET NULL
);

-- Updated_at trigger
DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes for estimates
CREATE INDEX IF NOT EXISTS idx_estimates_account_status
  ON estimates(account_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_account_created
  ON estimates(account_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_project
  ON estimates(project_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_created_by
  ON estimates(created_by);

-- =============================================================
-- 2. ESTIMATE LINE ITEMS TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS estimate_line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id       UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  description       TEXT NOT NULL,
  quantity          NUMERIC(12, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor  BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  amount_minor      BIGINT NOT NULL CHECK (amount_minor >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

-- Updated_at trigger
DROP TRIGGER IF EXISTS trg_estimate_line_items_updated_at ON estimate_line_items;
CREATE TRIGGER trg_estimate_line_items_updated_at
  BEFORE UPDATE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes for estimate line items
CREATE INDEX IF NOT EXISTS idx_estimate_line_items_estimate
  ON estimate_line_items(estimate_id, position)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_account
  ON estimate_line_items(account_id)
  WHERE deleted_at IS NULL;

-- =============================================================
-- 3. HARD DELETE PROHIBITION TRIGGER
-- =============================================================
CREATE OR REPLACE FUNCTION prevent_hard_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.allow_hard_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Hard deletes are prohibited on financial records. Use soft delete (deleted_at) instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_hard_delete_estimates ON estimates;
CREATE TRIGGER trg_prevent_hard_delete_estimates
  BEFORE DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

DROP TRIGGER IF EXISTS trg_prevent_hard_delete_estimate_line_items ON estimate_line_items;
CREATE TRIGGER trg_prevent_hard_delete_estimate_line_items
  BEFORE DELETE ON estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- =============================================================
-- 4. IDEMPOTENCY KEYS TABLE
-- =============================================================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  request_path    TEXT NOT NULL,
  params_hash     TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT uk_idempotency_account_key UNIQUE (account_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup
  ON idempotency_keys(account_id, key);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
  ON idempotency_keys(expires_at);

-- =============================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- =============================================================
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimates_service_role_all" ON estimates;
CREATE POLICY "estimates_service_role_all" ON estimates
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "estimate_line_items_service_role_all" ON estimate_line_items;
CREATE POLICY "estimate_line_items_service_role_all" ON estimate_line_items
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "idempotency_keys_service_role_all" ON idempotency_keys;
CREATE POLICY "idempotency_keys_service_role_all" ON idempotency_keys
  USING (TRUE) WITH CHECK (TRUE);

-- =============================================================
-- 6. MERGE FINANCIAL PERMISSIONS INTO DEMO ROLES
-- =============================================================
UPDATE roles
SET permissions = permissions || '{"view_estimates": true}'::jsonb
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; -- Client

UPDATE roles
SET permissions = permissions || '{"view_all_estimates": true}'::jsonb
WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'; -- Executive Director

UPDATE roles
SET permissions = permissions || '{"manage_estimates": true, "view_all_estimates": true, "view_estimates": true}'::jsonb
WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'; -- Account Manager

UPDATE roles
SET permissions = permissions || '{"manage_estimates": true, "view_estimates": true}'::jsonb
WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'; -- Project Manager

UPDATE roles
SET permissions = permissions || '{"manage_all_estimates": true, "view_all_estimates": true}'::jsonb
WHERE id = '77777777-7777-7777-7777-777777777777'; -- Admin

-- =============================================================
-- 7. SEED INITIAL DEMO ESTIMATES (Optional / Idempotent)
-- =============================================================
DO $$
DECLARE
  v_account_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001'; -- Meridian Financial
  v_project_id UUID := 'ffffffff-0001-0002-0003-000000000001'; -- Client Portal Redesign
  v_user_id    UUID := '11111111-1111-1111-1111-000000000003'; -- Account Manager Alex
  v_est_1_id   UUID := 'eeeeeeee-0001-0000-0000-000000000001';
  v_est_2_id   UUID := 'eeeeeeee-0002-0000-0000-000000000002';
BEGIN
  -- Only seed if demo account exists
  IF EXISTS (SELECT 1 FROM accounts WHERE id = v_account_id) THEN
    -- Estimate 1: Draft
    INSERT INTO estimates (
      id, account_id, project_id, estimate_number, title, description,
      status, currency, subtotal_minor, tax_minor, total_minor,
      valid_until, created_by
    ) VALUES (
      v_est_1_id,
      v_account_id,
      v_project_id,
      'EST-2026-001',
      'Client Portal Architecture & Core Scoping',
      'Comprehensive discovery, architecture planning, and high-fidelity wireframing for the customer portal.',
      'draft',
      'USD',
      1850000, -- $18,500.00
      0,
      1850000,
      CURRENT_DATE + INTERVAL '30 days',
      v_user_id
    ) ON CONFLICT (id) DO NOTHING;

    -- Line items for Estimate 1
    INSERT INTO estimate_line_items (
      id, estimate_id, account_id, position, description, quantity, unit_price_minor, amount_minor
    ) VALUES
      ('11111111-e001-0000-0000-000000000001', v_est_1_id, v_account_id, 0, 'Discovery workshops and technical architecture document', 1, 850000, 850000),
      ('11111111-e001-0000-0000-000000000002', v_est_1_id, v_account_id, 1, 'UX wireframing and design token specification', 80, 12500, 1000000)
    ON CONFLICT (id) DO NOTHING;

    -- Estimate 2: Sent
    INSERT INTO estimates (
      id, account_id, project_id, estimate_number, title, description,
      status, currency, subtotal_minor, tax_minor, total_minor,
      valid_until, sent_at, created_by
    ) VALUES (
      v_est_2_id,
      v_account_id,
      v_project_id,
      'EST-2026-002',
      'Security Hardening & Penetration Testing',
      'End-to-end security compliance audit and remediation sprints.',
      'sent',
      'USD',
      1200000, -- $12,000.00
      120000,  -- $1,200.00 (10% tax)
      1320000, -- $13,200.00
      CURRENT_DATE + INTERVAL '14 days',
      NOW() - INTERVAL '2 days',
      v_user_id
    ) ON CONFLICT (id) DO NOTHING;

    -- Line items for Estimate 2
    INSERT INTO estimate_line_items (
      id, estimate_id, account_id, position, description, quantity, unit_price_minor, amount_minor
    ) VALUES
      ('11111111-e002-0000-0000-000000000001', v_est_2_id, v_account_id, 0, 'Third-party penetration testing engagement', 1, 750000, 750000),
      ('11111111-e002-0000-0000-000000000002', v_est_2_id, v_account_id, 1, 'Vulnerability remediation and audit report sign-off', 30, 15000, 450000)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

