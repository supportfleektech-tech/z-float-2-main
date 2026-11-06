/**
 * Kenya Statutory Rates for 2025/2026 Tax Year
 *
 * Source: KRA PAYE bands, SHIF Act 2023, NSSF Act 2013, Housing Levy Act 2024
 * All rates are annual unless specified. Monthly calculations use 1/12 of annual.
 */

export interface PayeBand {
  min: number;
  max: number;
  rate: number;
}

export const KENYA_STATUTORY_RATES_2025_2026 = {
  /** PAYE (Pay As You Earn) - Monthly bands for 2025/2026 */
  paye: {
    bands: [
      { min: 0, max: 24000, rate: 0.10 },       // 10% on first 24,000
      { min: 24001, max: 32333, rate: 0.25 },   // 25% on next 8,333
      { min: 32334, max: 500000, rate: 0.30 },  // 30% on next 467,667
      { min: 500001, max: 800000, rate: 0.325 }, // 32.5% on next 300,000
      { min: 800001, max: Infinity, rate: 0.35 }, // 35% above 800,000
    ] as const satisfies readonly PayeBand[],
    personalRelief: 2400, // Monthly personal relief (KES 28,800 annually)
    insuranceReliefRate: 0.15, // 15% of premiums paid, max KES 5,000/month
    insuranceReliefMax: 5000,
  },

  /** SHIF (Social Health Insurance Fund) - 2.75% of gross, no ceiling */
  shif: {
    rate: 0.0275, // 2.75%
    employerRate: 0.0275, // Employer also contributes 2.75%
    // No ceiling - applies to full gross
  },

  /** NSSF (National Social Security Fund) - 6% each (employee + employer) */
  nssf: {
    employeeRate: 0.06, // 6%
    employerRate: 0.06, // 6%
    // Tier I ceiling: KES 7,000 (Tier I earnings)
    // Tier II ceiling: KES 36,000 (Tier II earnings)
    // Max employee contribution: (7,000 * 0.06) + (36,000 * 0.06) = 420 + 2,160 = 2,580/month
    // BUT the actuarial cap is KES 2,160/month (KES 25,920 annually) per the 2024 regulations
    maxEmployeeContribution: 2160, // Monthly ceiling in KES
    tier1Ceiling: 7000,
    tier2Ceiling: 36000,
  },

  /** Housing Levy (Affordable Housing Fund) - 1.5% each */
  housing: {
    employeeRate: 0.015, // 1.5%
    employerRate: 0.015, // 1.5%
    // No ceiling - applies to full gross
  },
} as const;
export type ShifRates = typeof KENYA_STATUTORY_RATES_2025_2026.shif;
export type NssfRates = typeof KENYA_STATUTORY_RATES_2025_2026.nssf;
export type HousingRates = typeof KENYA_STATUTORY_RATES_2025_2026.housing;

/**
 * Calculate PAYE tax for monthly gross pay
 * Uses 2025/2026 monthly bands with personal relief
 */
export function calculatePaye(
  monthlyGross: bigint,
  options: { insurancePremiumsMinor?: bigint } = {}
): { payeMinor: bigint; taxablePayMinor: bigint; reliefAppliedMinor: bigint; bands: Array<{ band: PayeBand; taxMinor: bigint }> } {
  const grossKes = Number(monthlyGross) / 100;
  const taxablePay = grossKes;
  let tax = 0;
  const bands: Array<{ band: PayeBand; taxMinor: bigint }> = [];

  for (const band of KENYA_STATUTORY_RATES_2025_2026.paye.bands) {
    if (taxablePay <= band.min) break;
    const bandMax = band.max === Infinity ? taxablePay : Math.min(taxablePay, band.max);
    const bandAmount = bandMax - band.min;
    if (bandAmount > 0) {
      const bandTax = bandAmount * band.rate;
      tax += bandTax;
      bands.push({ band, taxMinor: BigInt(Math.round(bandTax * 100)) });
    }
  }

  // Apply personal relief
  const personalRelief = KENYA_STATUTORY_RATES_2025_2026.paye.personalRelief;
  tax = Math.max(0, tax - personalRelief);

  // Apply insurance relief if provided
  if (options.insurancePremiumsMinor) {
    const premiumsKes = Number(options.insurancePremiumsMinor) / 100;
    const insuranceRelief = Math.min(
      premiumsKes * KENYA_STATUTORY_RATES_2025_2026.paye.insuranceReliefRate,
      KENYA_STATUTORY_RATES_2025_2026.paye.insuranceReliefMax
    );
    tax = Math.max(0, tax - insuranceRelief);
  }

  return {
    payeMinor: BigInt(Math.round(tax * 100)),
    taxablePayMinor: BigInt(Math.round(grossKes * 100)),
    reliefAppliedMinor: BigInt(Math.round((personalRelief + (options.insurancePremiumsMinor
      ? Math.min(
          (Number(options.insurancePremiumsMinor) / 100) * KENYA_STATUTORY_RATES_2025_2026.paye.insuranceReliefRate,
          KENYA_STATUTORY_RATES_2025_2026.paye.insuranceReliefMax
        )
      : 0)) * 100)),
    bands,
  };
}

/**
 * Calculate SHIF contribution (2.75% of gross, no ceiling)
 */
export function calculateShif(monthlyGross: bigint): { shifMinor: bigint; rate: number } {
  const grossKes = Number(monthlyGross) / 100;
  const shif = grossKes * KENYA_STATUTORY_RATES_2025_2026.shif.rate;
  return { shifMinor: BigInt(Math.round(shif * 100)), rate: KENYA_STATUTORY_RATES_2025_2026.shif.rate };
}

/**
 * Calculate NSSF contribution (6% with ceiling of KES 2,160/month)
 * Tier I: 6% on first 7,000
 * Tier II: 6% on next 29,000 (up to 36,000)
 * Ceiling: KES 2,160/month
 */
export function calculateNssf(monthlyGross: bigint): { nssfMinor: bigint; tier1Minor: bigint; tier2Minor: bigint; capped: boolean } {
  const grossKes = Number(monthlyGross) / 100;
  const { tier1Ceiling, tier2Ceiling, employeeRate, maxEmployeeContribution } = KENYA_STATUTORY_RATES_2025_2026.nssf;

  const tier1Amount = Math.min(grossKes, tier1Ceiling);
  const tier1Contribution = tier1Amount * employeeRate;

  let tier2Amount = 0;
  if (grossKes > tier1Ceiling) {
    tier2Amount = Math.min(grossKes - tier1Ceiling, tier2Ceiling - tier1Ceiling);
  }
  const tier2Contribution = tier2Amount * employeeRate;

  const totalContribution = tier1Contribution + tier2Contribution;
  const capped = totalContribution >= maxEmployeeContribution;
  const finalContribution = capped ? maxEmployeeContribution : totalContribution;

  return {
    nssfMinor: BigInt(Math.round(finalContribution * 100)),
    tier1Minor: BigInt(Math.round(Math.min(tier1Contribution, maxEmployeeContribution * (tier1Contribution / totalContribution)) * 100)),
    tier2Minor: BigInt(Math.round(Math.min(tier2Contribution, maxEmployeeContribution * (tier2Contribution / totalContribution)) * 100)),
    capped,
  };
}

/**
 * Calculate Housing Levy (1.5% of gross, no ceiling)
 */
export function calculateHousing(monthlyGross: bigint): { housingMinor: bigint; rate: number } {
  const grossKes = Number(monthlyGross) / 100;
  const housing = grossKes * KENYA_STATUTORY_RATES_2025_2026.housing.employeeRate;
  return { housingMinor: BigInt(Math.round(housing * 100)), rate: KENYA_STATUTORY_RATES_2025_2026.housing.employeeRate };
}

/**
 * Calculate all statutory deductions for an employee
 */
export interface StatutoryDeductionsResult {
  paye: ReturnType<typeof calculatePaye>;
  shif: ReturnType<typeof calculateShif>;
  nssf: ReturnType<typeof calculateNssf>;
  housing: ReturnType<typeof calculateHousing>;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;
}

export function calculateStatutoryDeductions(
  monthlyGross: bigint,
  options: { insurancePremiumsMinor?: bigint } = {}
): StatutoryDeductionsResult {
  const paye = calculatePaye(monthlyGross, options);
  const shif = calculateShif(monthlyGross);
  const nssf = calculateNssf(monthlyGross);
  const housing = calculateHousing(monthlyGross);

  const totalDeductionsMinor = paye.payeMinor + shif.shifMinor + nssf.nssfMinor + housing.housingMinor;
  const netPayMinor = monthlyGross - totalDeductionsMinor;

  return { paye, shif, nssf, housing, totalDeductionsMinor, netPayMinor };
}

/**
 * Calculate employer statutory contributions (for costing/remittance)
 */
export interface EmployerContributionsResult {
  nssfEmployerMinor: bigint;
  shifEmployerMinor: bigint;
  housingEmployerMinor: bigint;
  totalEmployerMinor: bigint;
}

export function calculateEmployerContributions(monthlyGross: bigint): EmployerContributionsResult {
  const grossKes = Number(monthlyGross) / 100;

  // NSSF employer: 6% with same tiered ceiling
  const { tier1Ceiling, tier2Ceiling, employerRate, maxEmployeeContribution } = KENYA_STATUTORY_RATES_2025_2026.nssf;
  const tier1Amount = Math.min(grossKes, tier1Ceiling);
  const tier1Employer = tier1Amount * employerRate;
  let tier2Amount = 0;
  if (grossKes > tier1Ceiling) {
    tier2Amount = Math.min(grossKes - tier1Ceiling, tier2Ceiling - tier1Ceiling);
  }
  const tier2Employer = tier2Amount * employerRate;
  const nssfEmployerTotal = tier1Employer + tier2Employer;
  const nssfEmployerCapped = Math.min(nssfEmployerTotal, maxEmployeeContribution);

  // SHIF employer: 2.75% no ceiling
  const shifEmployer = grossKes * KENYA_STATUTORY_RATES_2025_2026.shif.employerRate;

  // Housing employer: 1.5% no ceiling
  const housingEmployer = grossKes * KENYA_STATUTORY_RATES_2025_2026.housing.employerRate;

  return {
    nssfEmployerMinor: BigInt(Math.round(nssfEmployerCapped * 100)),
    shifEmployerMinor: BigInt(Math.round(shifEmployer * 100)),
    housingEmployerMinor: BigInt(Math.round(housingEmployer * 100)),
    totalEmployerMinor: BigInt(Math.round((nssfEmployerCapped + shifEmployer + housingEmployer) * 100)),
  };
}