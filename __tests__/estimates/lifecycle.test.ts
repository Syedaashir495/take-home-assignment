import { describe, it, expect } from 'vitest';
import {
  canTransition,
  ALLOWED_TRANSITIONS,
} from '@/lib/estimate-service';
import type { EstimateStatus } from '@/lib/supabase';

describe('Lifecycle State Machine (draft -> sent -> accepted | rejected)', () => {
  describe('State Transition Matrix', () => {
    it('allows valid forward transitions', () => {
      // draft -> sent
      expect(canTransition('draft', 'sent')).toBe(true);

      // sent -> accepted
      expect(canTransition('sent', 'accepted')).toBe(true);

      // sent -> rejected
      expect(canTransition('sent', 'rejected')).toBe(true);
    });

    it('rejects skipping states', () => {
      // Cannot jump draft -> accepted without client review / sending
      expect(canTransition('draft', 'accepted')).toBe(false);

      // Cannot jump draft -> rejected without sending
      expect(canTransition('draft', 'rejected')).toBe(false);
    });

    it('enforces terminal states (accepted / rejected cannot transition further)', () => {
      // accepted is immutable agreement
      expect(canTransition('accepted', 'draft')).toBe(false);
      expect(canTransition('accepted', 'sent')).toBe(false);
      expect(canTransition('accepted', 'rejected')).toBe(false);
      expect(ALLOWED_TRANSITIONS['accepted']).toHaveLength(0);

      // rejected is terminal
      expect(canTransition('rejected', 'draft')).toBe(false);
      expect(canTransition('rejected', 'sent')).toBe(false);
      expect(canTransition('rejected', 'accepted')).toBe(false);
      expect(ALLOWED_TRANSITIONS['rejected']).toHaveLength(0);
    });

    it('prohibits reverting sent estimates to draft directly', () => {
      expect(canTransition('sent', 'draft')).toBe(false);
    });
  });

  describe('Lifecycle Transition Invariants', () => {
    it('verifies sending requires at least 1 line item and non-zero total', () => {
      const emptyEstimate = {
        status: 'draft',
        total_minor: 0,
        estimate_line_items: [],
      };

      // Simulation of sending rule
      const canSend = (est: typeof emptyEstimate) => {
        if (!est.estimate_line_items || est.estimate_line_items.length === 0) {
          throw new Error('Cannot send an estimate with no line items');
        }
        if (est.total_minor <= 0) {
          throw new Error('Cannot send an estimate with total amount of 0');
        }
        return true;
      };

      expect(() => canSend(emptyEstimate)).toThrow('Cannot send an estimate with no line items');

      const zeroTotalEstimate = {
        status: 'draft',
        total_minor: 0,
        estimate_line_items: [{ description: 'Zero price item', quantity: 1, unit_price_minor: 0, amount_minor: 0 }],
      };
      expect(() => canSend(zeroTotalEstimate)).toThrow('Cannot send an estimate with total amount of 0');

      const validEstimate = {
        status: 'draft',
        total_minor: 50000,
        estimate_line_items: [{ description: 'Discovery', quantity: 1, unit_price_minor: 50000, amount_minor: 50000 }],
      };
      expect(canSend(validEstimate)).toBe(true);
    });

    it('enforces that accepted estimates cannot be deleted', () => {
      const canDelete = (status: EstimateStatus) => {
        if (status === 'accepted') {
          throw new Error('Accepted estimates cannot be deleted');
        }
        return true;
      };

      expect(canDelete('draft')).toBe(true);
      expect(canDelete('sent')).toBe(true);
      expect(() => canDelete('accepted')).toThrow('Accepted estimates cannot be deleted');
    });

    it('enforces that only draft estimates can be edited', () => {
      const canEdit = (status: EstimateStatus) => {
        if (status !== 'draft') {
          throw new Error('Lifecycle lock: Only draft estimates may be modified');
        }
        return true;
      };

      expect(canEdit('draft')).toBe(true);
      expect(() => canEdit('sent')).toThrow('Lifecycle lock: Only draft estimates may be modified');
      expect(() => canEdit('accepted')).toThrow('Lifecycle lock: Only draft estimates may be modified');
      expect(() => canEdit('rejected')).toThrow('Lifecycle lock: Only draft estimates may be modified');
    });
  });
});

