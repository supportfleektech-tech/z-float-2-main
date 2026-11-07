-- ============================================================
-- Z-float down migration: 024_payroll.down.sql
-- Rollback: Drop payroll tables and enum type
-- ============================================================

DROP INDEX IF EXISTS payslips_employee_idx;
DROP INDEX IF EXISTS payslips_run_idx;
DROP TABLE IF EXISTS payslips;

DROP INDEX IF EXISTS payroll_deductions_run_idx;
DROP INDEX IF EXISTS payroll_deductions_employee_idx;
DROP TABLE IF EXISTS payroll_deductions;

DROP INDEX IF EXISTS payroll_employees_employee_idx;
DROP INDEX IF EXISTS payroll_employees_tenant_idx;
DROP INDEX IF EXISTS payroll_employees_run_idx;
DROP TABLE IF EXISTS payroll_employees;

DROP INDEX IF EXISTS payroll_runs_period_idx;
DROP INDEX IF EXISTS payroll_runs_tenant_idx;
DROP TABLE IF EXISTS payroll_runs;

DROP TYPE IF EXISTS payroll_run_status;