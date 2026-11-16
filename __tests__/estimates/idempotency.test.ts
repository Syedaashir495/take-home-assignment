import { describe, it, expect } from 'vitest';
import { hashPayload } from '@/lib/estimate-service';

describe('Idempotency Protocol & Payload Hashing', () => {
  describe('hashPayload', () => {
    it('produces identical SHA-256 hashes for identical payloads', () => {
      const payload1 = {
        title: 'Project Alpha Estimate',
        estimate_number: 'EST-2026-001',
        currency: 'USD',
        tax_rate: 0.1,
        line_items: [
          { description: 'Design Sprint', quantity: 1, unit_price_minor: 100000 },
          { description: 'Development', quantity: 2, unit_price_minor: 150000 },
        ],
      };

      const payload2 = {
        title: 'Project Alpha Estimate',
        estimate_number: 'EST-2026-001',
        currency: 'USD',
        tax_rate: 0.1,
        line_items: [
          { description: 'Design Sprint', quantity: 1, unit_price_minor: 100000 },
          { description: 'Development', quantity: 2, unit_price_minor: 150000 },
        ],
      };

      expect(hashPayload(payload1)).toBe(hashPayload(payload2));
    });

    it('produces identical hashes regardless of object key order (canonical serialization)', () => {
      const payloadA = {
        title: 'Security Audit',
        estimate_number: 'EST-100',
        line_items: [{ description: 'Audit', quantity: 1, unit_price_minor: 50000 }],
      };

      // Same data with scrambled key order
      const payloadB = {
        estimate_number: 'EST-100',
        line_items: [{ unit_price_minor: 50000, quantity: 1, description: 'Audit' }],
        title: 'Security Audit',
      };

      expect(hashPayload(payloadA)).toBe(hashPayload(payloadB));
    });

    it('produces distinct hashes when payload parameters differ', () => {
      const basePayload = {
        title: 'Initial Estimate',
        estimate_number: 'EST-100',
        line_items: [{ description: 'Audit', quantity: 1, unit_price_minor: 50000 }],
      };

      // Changed quantity
      const payloadDiffQty = {
        ...basePayload,
        line_items: [{ description: 'Audit', quantity: 2, unit_price_minor: 50000 }],
      };

      // Changed price
      const payloadDiffPrice = {
        ...basePayload,
        line_items: [{ description: 'Audit', quantity: 1, unit_price_minor: 60000 }],
      };

      // Changed title
      const payloadDiffTitle = {
        ...basePayload,
        title: 'Revised Estimate',
      };

      const baseHash = hashPayload(basePayload);
      expect(hashPayload(payloadDiffQty)).not.toBe(baseHash);
      expect(hashPayload(payloadDiffPrice)).not.toBe(baseHash);
      expect(hashPayload(payloadDiffTitle)).not.toBe(baseHash);
    });
  });

  describe('Idempotency State Resolution Logic', () => {
    it('accurately resolves cache hits vs conflicts', () => {
      const storedRecord = {
        key: 'key-12345',
        params_hash: hashPayload({ title: 'Task A', amount: 500 }),
        response_status: 201,
        response_body: { estimate: { id: 'est-1', title: 'Task A' } },
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };

      const evaluateIdempotency = (
        record: typeof storedRecord | null,
        incomingPayload: unknown,
      ) => {
        if (!record) return { status: 'miss' };
        if (new Date(record.expires_at).getTime() < Date.now()) return { status: 'miss' };

        const currentHash = hashPayload(incomingPayload);
        if (record.params_hash !== currentHash) {
          return { status: 'conflict', message: 'Payload mismatch for same key' };
        }

        return {
          status: 'hit',
          status_code: record.response_status,
          body: record.response_body,
        };
      };

      // 1. Same payload -> Hit with cached body and 201 status
      const hitResult = evaluateIdempotency(storedRecord, { title: 'Task A', amount: 500 });
      expect(hitResult.status).toBe('hit');
      if (hitResult.status === 'hit') {
        expect(hitResult.status_code).toBe(201);
        expect(hitResult.body).toEqual({ estimate: { id: 'est-1', title: 'Task A' } });
      }

      // 2. Different payload with same key -> Conflict
      const conflictResult = evaluateIdempotency(storedRecord, { title: 'Task B (Different)', amount: 999 });
      expect(conflictResult.status).toBe('conflict');

      // 3. Null record -> Miss
      const missResult = evaluateIdempotency(null, { title: 'New Task', amount: 100 });
      expect(missResult.status).toBe('miss');
    });
  });
});

