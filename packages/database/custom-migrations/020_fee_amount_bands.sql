-- 020_fee_amount_bands.sql
--  Amount-band columns on fee_rules so a rule can be scoped to a payment
--  amount range (minor units). NULL = unbounded on that side.

ALTER TABLE fee_rules ADD COLUMN IF NOT EXISTS amount_minor_min bigint;
ALTER TABLE fee_rules ADD COLUMN IF NOT EXISTS amount_minor_max bigint;
