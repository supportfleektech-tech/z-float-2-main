-- Payroll tables migration
-- Creates payroll_runs, payroll_employees, payroll_deductions, payslips

CREATE TYPE payroll_run_status AS ENUM (
  'DRAFT',
  'CALCULATED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  pay_date timestamptz NOT NULL,
  status payroll_run_status NOT NULL DEFAULT 'DRAFT',
  total_gross_minor bigint NOT NULL DEFAULT 0,
  total_net_minor bigint NOT NULL DEFAULT 0,
  total_paye_minor bigint NOT NULL DEFAULT 0,
  total_shif_minor bigint NOT NULL DEFAULT 0,
  total_nssf_minor bigint NOT NULL DEFAULT 0,
  total_housing_minor bigint NOT NULL DEFAULT 0,
  employee_count integer NOT NULL DEFAULT 0,
  approved_by_id uuid REFERENCES users(id),
  approved_at timestamptz,
  created_by_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payroll_runs_tenant_idx ON payroll_runs (tenant_id);
CREATE INDEX payroll_runs_period_idx ON payroll_runs (tenant_id, period_start, period_end);

CREATE TABLE payroll_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES users(id),
  employee_number varchar(50),
  department_id uuid REFERENCES departments(id),
  branch_id uuid REFERENCES branches(id),
  basic_salary_minor bigint NOT NULL,
  allowances_minor bigint NOT NULL DEFAULT 0,
  gross_minor bigint NOT NULL,
  paye_minor bigint NOT NULL DEFAULT 0,
  shif_minor bigint NOT NULL DEFAULT 0,
  nssf_minor bigint NOT NULL DEFAULT 0,
  housing_minor bigint NOT NULL DEFAULT 0,
  other_deductions_minor bigint NOT NULL DEFAULT 0,
  total_deductions_minor bigint NOT NULL DEFAULT 0,
  net_pay_minor bigint NOT NULL,
  kra_pin varchar(11),
  nssf_number varchar(30),
  shif_number varchar(30),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payroll_employees_run_idx ON payroll_employees (run_id);
CREATE INDEX payroll_employees_tenant_idx ON payroll_employees (tenant_id);
CREATE INDEX payroll_employees_employee_idx ON payroll_employees (employee_id);

CREATE TABLE payroll_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  type varchar(30) NOT NULL,
  name varchar(100) NOT NULL,
  amount_minor bigint NOT NULL,
  rate varchar(20),
  taxable_amount_minor bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payroll_deductions_employee_idx ON payroll_deductions (employee_id);
CREATE INDEX payroll_deductions_run_idx ON payroll_deductions (run_id);

CREATE TABLE payslips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payslip_number varchar(50) NOT NULL UNIQUE,
  pdf_ref varchar(200),
  status varchar(20) NOT NULL DEFAULT 'GENERATED',
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payslips_run_idx ON payslips (run_id);
CREATE INDEX payslips_employee_idx ON payslips (employee_id);