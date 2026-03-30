-- migration-v22-stripe-billing.sql
-- Add subscription_status to tenants for Stripe billing integration

ALTER TABLE tenants ADD COLUMN subscription_status TEXT DEFAULT 'none';
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);
CREATE INDEX IF NOT EXISTS idx_tenants_stripe ON tenants(stripe_customer_id);

INSERT INTO schema_version (version) VALUES (22);
