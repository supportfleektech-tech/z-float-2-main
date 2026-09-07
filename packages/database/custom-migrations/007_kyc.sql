-- KYC / AML: watchlist, profiles, documents, screenings and case management.
-- Tables are created by drizzle schema sync? No — created here for the demo DBs.

CREATE TABLE IF NOT EXISTS aml_watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(20) NOT NULL,
  name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]',
  country varchar(80),
  reference varchar(120),
  source varchar(80) NOT NULL DEFAULT 'internal',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aml_watchlists_name_idx ON aml_watchlists(name);

CREATE TABLE IF NOT EXISTS kyc_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  business_name varchar(200),
  registration_number varchar(80),
  verification_level varchar(20) NOT NULL DEFAULT 'NONE',
  status varchar(20) NOT NULL DEFAULT 'NOT_SUBMITTED',
  submitted_at timestamptz,
  reviewed_by_id uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_profiles_tenant_idx ON kyc_profiles(tenant_id);

CREATE TABLE IF NOT EXISTS kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  profile_id uuid REFERENCES kyc_profiles(id) ON DELETE CASCADE,
  doc_type varchar(40) NOT NULL,
  file_id uuid REFERENCES file_objects(id),
  status varchar(20) NOT NULL DEFAULT 'SUBMITTED',
  notes text,
  uploaded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_documents_tenant_idx ON kyc_documents(tenant_id);

CREATE TABLE IF NOT EXISTS kyc_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  subject_type varchar(20) NOT NULL,
  subject_name text NOT NULL,
  subject_ref text,
  result varchar(20) NOT NULL,
  score integer NOT NULL DEFAULT 0,
  matched_entries jsonb NOT NULL DEFAULT '[]',
  payment_id uuid,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_screenings_tenant_idx ON kyc_screenings(tenant_id);
CREATE INDEX IF NOT EXISTS kyc_screenings_payment_idx ON kyc_screenings(payment_id);

CREATE TABLE IF NOT EXISTS kyc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  screening_id uuid REFERENCES kyc_screenings(id),
  payment_id uuid,
  kind varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'OPEN',
  risk_level varchar(20) NOT NULL DEFAULT 'MEDIUM',
  note text,
  decided_by_id uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_cases_tenant_idx ON kyc_cases(tenant_id);
CREATE INDEX IF NOT EXISTS kyc_cases_status_idx ON kyc_cases(status);
CREATE INDEX IF NOT EXISTS kyc_cases_payment_idx ON kyc_cases(payment_id);

-- Demo watchlist entries — fictional names for the sandbox demo only. In
-- production these lists are replaced by licensed provider data.
INSERT INTO aml_watchlists (kind, name, aliases, country, reference, source) VALUES
  ('SANCTIONS', 'Grace Wambui', '["Grace N. Wambui", "G. Wambui"]', 'KE', 'DEMO-SAN-0001', 'demo'),
  ('SANCTIONS', 'Omar Hassan Abdi', '["Omar H. Abdi", "Omar Abdi"]', 'KE', 'DEMO-SAN-0002', 'demo'),
  ('PEP', 'Kiprop Keter', '["K. Keter", "Kiprop K. Keter"]', 'KE', 'DEMO-PEP-0001', 'demo'),
  ('ADVERSE', 'Halima Yusuf Noor', '["Halima Noor"]', 'KE', 'DEMO-ADV-0001', 'demo')
ON CONFLICT DO NOTHING;
