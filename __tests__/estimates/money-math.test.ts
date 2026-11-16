import { describe, it, expect } from 'vitest';
import {
  calculateLineItemAmount,
  calculateEstimateTotals,
} from '@/lib/estimate-service';
import { formatCurrency } from '@/components/estimates/line-item-editor';

describe('Financial Math Engine (Minor Units)', () => {
  describe('calculateLineItemAmount', () => {
    it('calculates integer line item totals accurately in minor units', () => {
      // 5 units at $25.00 (2500 minor units) = $125.00 (12500 minor units)
      expect(calculateLineItemAmount(5, 2500)).toBe(12500);
      // 1 unit at $0.99 (99 minor units) = 99 minor units
      expect(calculateLineItemAmount(1, 99)).toBe(99);
      // 100 units at $0.00 (0 minor units) = 0 minor units
      expect(calculateLineItemAmount(100, 0)).toBe(0);
    });

    it('accurately handles fractional hours/days with deterministic rounding', () => {
      // 2.5 hours at $150.00/hr (15000 minor units) = $375.00 (37500 minor units)
      expect(calculateLineItemAmount(2.5, 15000)).toBe(37500);

      // 1.3333 hours at $120.00/hr (12000 minor units) = 15999.6 -> 16000 minor units ($160.00)
      expect(calculateLineItemAmount(1.3333, 12000)).toBe(16000);

      // 0.25 day at $1200.00/day (120000 minor units) = 30000 minor units ($300.00)
      expect(calculateLineItemAmount(0.25, 120000)).toBe(30000);
    });

    it('rejects invalid inputs to prevent financial corruption', () => {
      // Zero or negative quantity
      expect(() => calculateLineItemAmount(0, 5000)).toThrow('Quantity must be greater than 0');
      expect(() => calculateLineItemAmount(-2, 5000)).toThrow('Quantity must be greater than 0');

      // Negative unit price
      expect(() => calculateLineItemAmount(1, -500)).toThrow(
        'Unit price in minor units must be a non-negative integer',
      );

      // Float unit price (must be integer minor units)
      expect(() => calculateLineItemAmount(1, 10.5)).toThrow(
        'Unit price in minor units must be a non-negative integer',
      );
    });
  });

  describe('calculateEstimateTotals', () => {
    it('aggregates subtotal, tax, and asserts total_minor = subtotal_minor + tax_minor', () => {
      const items = [
        { description: 'Design Sprint', quantity: 2, unit_price_minor: 50000 }, // 100,000 minor ($1,000.00)
        { description: 'Implementation', quantity: 10, unit_price_minor: 15000 }, // 150,000 minor ($1,500.00)
        { description: 'QA Testing', quantity: 4.5, unit_price_minor: 12000 }, // 54,000 minor ($540.00)
      ];

      // Tax rate: 8.5% (0.085)
      const result = calculateEstimateTotals(items, 0.085);

      // Subtotal = 100000 + 150000 + 54000 = 304000 ($3,040.00)
      expect(result.subtotalMinor).toBe(304000);

      // Tax = round(304000 * 0.085) = round(25840) = 25840 ($258.40)
      expect(result.taxMinor).toBe(25840);

      // Total = subtotal + tax = 304000 + 25840 = 329840 ($3,298.40)
      expect(result.totalMinor).toBe(329840);
      expect(result.totalMinor).toBe(result.subtotalMinor + result.taxMinor);

      // Check calculated items
      expect(result.calculatedItems).toHaveLength(3);
      expect(result.calculatedItems[0].amount_minor).toBe(100000);
      expect(result.calculatedItems[1].amount_minor).toBe(150000);
      expect(result.calculatedItems[2].amount_minor).toBe(54000);
      expect(result.calculatedItems[0].position).toBe(0);
      expect(result.calculatedItems[1].position).toBe(1);
      expect(result.calculatedItems[2].position).toBe(2);
    });

    it('correctly handles zero tax rate', () => {
      const items = [
        { description: 'Consulting', quantity: 5, unit_price_minor: 20000 }, // 100,000 minor ($1,000.00)
      ];

      const result = calculateEstimateTotals(items, 0);
      expect(result.subtotalMinor).toBe(100000);
      expect(result.taxMinor).toBe(0);
      expect(result.totalMinor).toBe(100000);
    });

    it('accurately rounds fractional cents on tax calculation', () => {
      // 1 item at $10.55 (1055 minor units) with 7.25% tax
      // 1055 * 0.0725 = 76.4875 -> rounds to 76 minor units ($0.76)
      const items = [{ description: 'Item A', quantity: 1, unit_price_minor: 1055 }];
      const result = calculateEstimateTotals(items, 0.0725);
      expect(result.taxMinor).toBe(76);
      expect(result.totalMinor).toBe(1131);
    });
  });

  describe('formatCurrency', () => {
    it('formats minor units to standard USD currency string', () => {
      expect(formatCurrency(1250000, 'USD')).toBe('$12,500.00');
      expect(formatCurrency(99, 'USD')).toBe('$0.99');
      expect(formatCurrency(0, 'USD')).toBe('$0.00');
      expect(formatCurrency(50000, 'USD')).toBe('$500.00');
    });

    it('formats other international ISO currencies', () => {
      expect(formatCurrency(50000, 'EUR')).toContain('500.00');
      expect(formatCurrency(50000, 'GBP')).toContain('500.00');
    });
  });
});

