-- 021_supplier_bank_details.sql
--  Add bank name, paybill name, and till name to beneficiaries so suppliers
--  can be paid via bank transfer, paybill, or till with full details.

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS bank_name varchar(200);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS paybill_name varchar(200);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS till_name varchar(200);
