/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Payslip PDF Generation
 *
 * Generates professional payslips in PDF format using PDFKit.
 */
import PDFDocument from "pdfkit";
import { minorToDisplay } from "@zfloat/money";
import { KENYA_STATUTORY_RATES_2025_2026 } from "./rates.js";

export interface PayslipData {
  // Company info
  companyName: string;
  companyKraPin: string;
  companyAddress: string;
  companyPhone?: string;
  companyEmail?: string;

  // Employee info
  employeeName: string;
  employeeNumber: string;
  employeeKraPin: string;
  employeeNssfNumber: string;
  employeeShifNumber: string;
  department?: string;
  designation?: string;
  bankName?: string;
  bankAccount?: string;

  // Pay period
  periodStart: Date;
  periodEnd: Date;
  payDate: Date;

  // Earnings
  basicSalaryMinor: bigint;
  allowances: Array<{ name: string; amountMinor: bigint }>;
  grossPayMinor: bigint;

  // Deductions
  payeMinor: bigint;
  shifMinor: bigint;
  nssfMinor: bigint;
  housingMinor: bigint;
  otherDeductions: Array<{ name: string; amountMinor: bigint }>;
  totalDeductionsMinor: bigint;
  netPayMinor: bigint;

  // Employer contributions (for info)
  employerNssfMinor: bigint;
  employerShifMinor: bigint;
  employerHousingMinor: bigint;

  // YTD totals
  ytdGrossMinor?: bigint;
  ytdPayeMinor?: bigint;
  ytdNetMinor?: bigint;
}

/**
 * Generate a payslip PDF as a buffer
 */
export function generatePayslipPdf(data: PayslipData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Fonts
      doc.registerFont("Helvetica", "Helvetica");
      doc.registerFont("Helvetica-Bold", "Helvetica-Bold");

      // Track Y position manually to avoid TypeScript issues with doc.y
      const pos = { y: 50 };

      const addText = (text: string, options: { x?: number; y?: number; font?: string; size?: number; color?: string; align?: "left" | "center" | "right"; width?: number } = {}) => {
        if (options.font) doc.font(options.font);
        if (options.size) doc.fontSize(options.size);
        if (options.color) doc.fillColor(options.color);
        const x = options.x ?? 50;
        const textY = options.y ?? pos.y;
        const width = options.width ?? 495;
        doc.text(text, x, textY, { width, align: options.align ?? "left" });
        if (options.y === undefined) {
          // Update our tracked y position based on the text height
          // Approximate: font size * 1.2 line height
          const fontSize = options.size ?? 12;
          pos.y = textY + fontSize * 1.2;
        }
      };

      const moveDown = (lines = 1) => {
        pos.y += lines * 14;
      };

      const drawLine = (startX: number, endX: number, color = "#e2e8f0", lineWidth = 1) => {
        doc.strokeColor(color).lineWidth(lineWidth).moveTo(startX, pos.y).lineTo(endX, pos.y).stroke();
      };

      const drawRect = (x: number, y: number, width: number, height: number, fill?: string, stroke?: string) => {
        if (fill) doc.rect(x, y, width, height).fill(fill);
        if (stroke) doc.rect(x, y, width, height).stroke(stroke);
        else if (!fill) doc.rect(x, y, width, height).stroke();
      };

      const drawTableHeader = (colWidths: number[], headers: string[], rowHeight = 18, startX = 50) => {
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
        let cx = startX;
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i] ?? "";
          doc.rect(cx, pos.y, colWidths[i], rowHeight).fill("#2b6cb0");
          doc.fillColor("#ffffff").text(header, cx + 5, pos.y + 4, { width: colWidths[i] - 10, align: i === headers.length - 1 ? "right" : "left" });
          cx += colWidths[i];
        }
        pos.y += rowHeight;
      };

      const drawTableRow = (colWidths: number[], cells: Array<{ text: string; bold?: boolean; align?: "left" | "right" }>, rowHeight = 18, startX = 50) => {
        const isEven = Math.floor((pos.y - 50) / rowHeight) % 2 === 0;
        let cx = startX;
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i] ?? { text: "" };
          const bgColor = isEven ? "#f7fafc" : "#ffffff";
          doc.rect(cx, pos.y, colWidths[i], rowHeight).fillAndStroke(bgColor, "#e2e8f0");
          doc.font(cell.bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#2d3748");
          doc.text(cell.text, cx + 5, pos.y + 4, { width: colWidths[i] - 10, align: cell.align ?? "left" });
          cx += colWidths[i];
        }
        pos.y += rowHeight;
      };

      // ===== HEADER =====
      addText(data.companyName, { font: "Helvetica-Bold", size: 18, color: "#1a365d", align: "center" });
      moveDown(0.3);

      addText(`KRA PIN: ${data.companyKraPin}`, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });
      addText(data.companyAddress, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });
      if (data.companyPhone) addText(`Tel: ${data.companyPhone}`, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });
      if (data.companyEmail) addText(`Email: ${data.companyEmail}`, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });

      moveDown(0.5);
      drawLine(50, 545);
      moveDown(0.5);

      // ===== TITLE =====
      addText("PAYSLIP", { font: "Helvetica-Bold", size: 14, color: "#1a365d", align: "center" });
      moveDown(0.5);

      // ===== EMPLOYEE & PERIOD INFO =====
      const empColWidth = [110, 110, 110, 110];
      const rowHeight = 18;

      drawTableRow(empColWidth, [
        { text: "Employee", bold: true },
        { text: data.employeeName },
        { text: "Employee No.", bold: true },
        { text: data.employeeNumber },
      ]);

      drawTableRow(empColWidth, [
        { text: "KRA PIN", bold: true },
        { text: data.employeeKraPin || "N/A" },
        { text: "NSSF No.", bold: true },
        { text: data.employeeNssfNumber || "N/A" },
      ]);

      drawTableRow(empColWidth, [
        { text: "SHIF No.", bold: true },
        { text: data.employeeShifNumber || "N/A" },
        { text: "Department", bold: true },
        { text: data.department || "N/A" },
      ]);

      if (data.designation) {
        drawTableRow(empColWidth, [
          { text: "Designation", bold: true },
          { text: data.designation },
          { text: "", bold: false },
          { text: "" },
        ]);
      }

      moveDown(0.3);

      // Period info
      drawTableRow(empColWidth, [
        { text: "Pay Period", bold: true },
        { text: `${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}` },
        { text: "Pay Date", bold: true },
        { text: formatDate(data.payDate) },
      ]);

      moveDown(0.5);
      drawLine(50, 545);
      moveDown(0.5);

      // ===== EARNINGS =====
      addText("EARNINGS", { font: "Helvetica-Bold", size: 12, color: "#1a365d" });
      moveDown(0.3);

      const earnColWidth = [250, 100, 145];
      drawTableHeader(earnColWidth, ["Description", "Rate/Units", "Amount (KES)"]);

      // Basic salary
      drawTableRow(earnColWidth, [
        { text: "Basic Salary" },
        { text: "1 Month" },
        { text: minorToDisplay(data.basicSalaryMinor), align: "right" },
      ]);

      // Allowances
      for (const allowance of data.allowances) {
        drawTableRow(earnColWidth, [
          { text: allowance.name },
          { text: "" },
          { text: minorToDisplay(allowance.amountMinor), align: "right" },
        ]);
      }

      // Gross pay total
      moveDown(0.1);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1a365d");
      const grossY = pos.y;
      drawRect(50, grossY, earnColWidth[0] + earnColWidth[1], rowHeight, undefined, "#e2e8f0");
      drawRect(50 + earnColWidth[0] + earnColWidth[1], grossY, earnColWidth[2], rowHeight, "#edf2f7", "#e2e8f0");
      doc.fillColor("#1a365d").text("GROSS PAY", 60, grossY + 5, { width: earnColWidth[0] + earnColWidth[1] - 20 });
      doc.text(minorToDisplay(data.grossPayMinor), 50 + earnColWidth[0] + earnColWidth[1] + 10, grossY + 5, { width: earnColWidth[2] - 20, align: "right" });
      pos.y = grossY + rowHeight;

      moveDown(0.5);
      drawLine(50, 545);
      moveDown(0.5);

      // ===== DEDUCTIONS =====
      addText("STATUTORY DEDUCTIONS", { font: "Helvetica-Bold", size: 12, color: "#1a365d" });
      moveDown(0.3);

      const dedColWidth = [250, 100, 145];
      drawTableHeader(dedColWidth, ["Description", "Rate", "Amount (KES)"]);

      // PAYE
      drawTableRow(dedColWidth, [
        { text: "PAYE (Income Tax)" },
        { text: "Per KRA Bands" },
        { text: minorToDisplay(data.payeMinor), align: "right" },
      ]);

      // SHIF
      drawTableRow(dedColWidth, [
        { text: "SHIF (Social Health Insurance)" },
        { text: `${(KENYA_STATUTORY_RATES_2025_2026.shif.rate * 100).toFixed(2)}%` },
        { text: minorToDisplay(data.shifMinor), align: "right" },
      ]);

      // NSSF
      drawTableRow(dedColWidth, [
        { text: "NSSF (Pension)" },
        { text: `${(KENYA_STATUTORY_RATES_2025_2026.nssf.employeeRate * 100).toFixed(0)}% (Max KES 2,160)` },
        { text: minorToDisplay(data.nssfMinor), align: "right" },
      ]);

      // Housing Levy
      drawTableRow(dedColWidth, [
        { text: "Housing Levy (Affordable Housing)" },
        { text: `${(KENYA_STATUTORY_RATES_2025_2026.housing.employeeRate * 100).toFixed(1)}%` },
        { text: minorToDisplay(data.housingMinor), align: "right" },
      ]);

      // Other deductions
      for (const ded of data.otherDeductions) {
        drawTableRow(dedColWidth, [
          { text: ded.name },
          { text: "" },
          { text: minorToDisplay(ded.amountMinor), align: "right" },
        ]);
      }

      // Total deductions
      moveDown(0.1);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#1a365d");
      const dedTotalY = pos.y;
      drawRect(50, dedTotalY, dedColWidth[0] + dedColWidth[1], rowHeight, undefined, "#e2e8f0");
      drawRect(50 + dedColWidth[0] + dedColWidth[1], dedTotalY, dedColWidth[2], rowHeight, "#edf2f7", "#e2e8f0");
      doc.fillColor("#1a365d").text("TOTAL DEDUCTIONS", 60, dedTotalY + 5, { width: dedColWidth[0] + dedColWidth[1] - 20 });
      doc.text(minorToDisplay(data.totalDeductionsMinor), 50 + dedColWidth[0] + dedColWidth[1] + 10, dedTotalY + 5, { width: dedColWidth[2] - 20, align: "right" });
      pos.y = dedTotalY + rowHeight;

      moveDown(0.5);
      drawLine(50, 545);
      moveDown(0.5);

      // ===== NET PAY =====
      addText("NET PAY", { font: "Helvetica-Bold", size: 14, color: "#276749", align: "left" });
      addText(minorToDisplay(data.netPayMinor), { font: "Helvetica-Bold", size: 18, color: "#276749", align: "right" });
      moveDown(0.5);

      // ===== EMPLOYER CONTRIBUTIONS (Info only) =====
      addText("EMPLOYER CONTRIBUTIONS (Not deducted from your pay)", { font: "Helvetica-Bold", size: 11, color: "#4a5568" });
      moveDown(0.2);

      const employerColWidth = [250, 145, 150];
      drawTableHeader(employerColWidth, ["Contribution", "Employer Amount (KES)", "Total (Employee + Employer)"]);

      drawTableRow(employerColWidth, [
        { text: "NSSF" },
        { text: minorToDisplay(data.employerNssfMinor), align: "right" },
        { text: minorToDisplay(data.nssfMinor + data.employerNssfMinor), align: "right" },
      ]);

      drawTableRow(employerColWidth, [
        { text: "SHIF" },
        { text: minorToDisplay(data.employerShifMinor), align: "right" },
        { text: minorToDisplay(data.shifMinor + data.employerShifMinor), align: "right" },
      ]);

      drawTableRow(employerColWidth, [
        { text: "Housing Levy" },
        { text: minorToDisplay(data.employerHousingMinor), align: "right" },
        { text: minorToDisplay(data.housingMinor + data.employerHousingMinor), align: "right" },
      ]);

      moveDown(0.5);
      drawLine(50, 545);
      moveDown(0.5);

      // ===== YTD TOTALS =====
      if (data.ytdGrossMinor || data.ytdPayeMinor || data.ytdNetMinor) {
        addText("YEAR TO DATE SUMMARY", { font: "Helvetica-Bold", size: 11, color: "#4a5568" });
        moveDown(0.2);

        const ytdColWidth = [250, 145];
        drawTableHeader(ytdColWidth, ["Description", "Amount (KES)"]);

        drawTableRow(ytdColWidth, [
          { text: "YTD Gross Pay" },
          { text: minorToDisplay(data.ytdGrossMinor ?? 0n), align: "right" },
        ]);

        drawTableRow(ytdColWidth, [
          { text: "YTD PAYE" },
          { text: minorToDisplay(data.ytdPayeMinor ?? 0n), align: "right" },
        ]);

        drawTableRow(ytdColWidth, [
          { text: "YTD Net Pay" },
          { text: minorToDisplay(data.ytdNetMinor ?? 0n), align: "right" },
        ]);

        moveDown(0.5);
      }

      // ===== FOOTER =====
      drawLine(50, 545);
      moveDown(0.3);

      addText("This is a system-generated payslip. No signature required.", { font: "Helvetica", size: 8, color: "#718096", align: "center" });
      addText(`Generated on ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })}`, { font: "Helvetica", size: 8, color: "#718096", align: "center" });

      // Bank info if provided
      if (data.bankName || data.bankAccount) {
        moveDown(0.3);
        addText("BANK DETAILS", { font: "Helvetica-Bold", size: 9, color: "#4a5568", align: "center" });
        if (data.bankName) addText(`Bank: ${data.bankName}`, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });
        if (data.bankAccount) addText(`Account: ${data.bankAccount}`, { font: "Helvetica", size: 9, color: "#4a5568", align: "center" });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generate multiple payslips as a combined PDF
 */
export async function generatePayslipsPdf(payslips: PayslipData[]): Promise<Buffer> {
  const pdfBuffers = await Promise.all(payslips.map(generatePayslipPdf));
  return Buffer.concat(pdfBuffers);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}