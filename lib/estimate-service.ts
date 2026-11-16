import { createHash } from 'crypto';
import type { AppSupabaseClient } from './supabase';
import type {
  Estimate,
  EstimateLineItem,
  EstimateStatus,
  EstimateWithLineItems,
} from './supabase';
import type {
  CreateEstimateInput,
  UpdateEstimateInput,
  EstimateFilterInput,
} from './validation-schemas';
import { logger } from './debug-logger';

// ============================================================================
// FINANCIAL MATHEMATICS ENGINE (MINOR UNITS)
// ============================================================================

/**
 * Calculates a single line item amount in minor units:
 * amount_minor = round(quantity * unit_price_minor)
 */
export function calculateLineItemAmount(quantity: number, unitPriceMinor: number): number {
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0');
  }
  if (unitPriceMinor < 0 || !Number.isInteger(unitPriceMinor)) {
    throw new Error('Unit price in minor units must be a non-negative integer');
  }
  return Math.round(quantity * unitPriceMinor);
}

/**
 * Calculates subtotal, tax, and total in minor units.
 * Invariant: total_minor = subtotal_minor + tax_minor
 */
export function calculateEstimateTotals(
  lineItems: Array<{ quantity: number; unit_price_minor: number; description: string; position?: number }>,
  taxRate: number = 0,
): {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  calculatedItems: Array<{
    description: string;
    quantity: number;
    unit_price_minor: number;
    amount_minor: number;
    position: number;
  }>;
} {
  let subtotal = 0;
  const calculatedItems = lineItems.map((item, index) => {
    const amountMinor = calculateLineItemAmount(item.quantity, item.unit_price_minor);
    subtotal += amountMinor;
    return {
      description: item.description,
      quantity: item.quantity,
      unit_price_minor: item.unit_price_minor,
      amount_minor: amountMinor,
      position: item.position !== undefined ? item.position : index,
    };
  });

  const taxMinor = taxRate > 0 ? Math.round(subtotal * taxRate) : 0;
  const totalMinor = subtotal + taxMinor;

  return {
    subtotalMinor: subtotal,
    taxMinor,
    totalMinor,
    calculatedItems,
  };
}

// ============================================================================
// IDEMPOTENCY UTILITIES
// ============================================================================

/**
 * Deterministically serializes and hashes payload with SHA-256
 */
export function hashPayload(payload: unknown): string {
  function stableStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }

  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

// ============================================================================
// LIFECYCLE STATE MACHINE
// ============================================================================

export const ALLOWED_TRANSITIONS: Record<EstimateStatus, EstimateStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected'],
  accepted: [],
  rejected: [],
};

export function canTransition(current: EstimateStatus, target: EstimateStatus): boolean {
  return ALLOWED_TRANSITIONS[current]?.includes(target) ?? false;
}

// ============================================================================
// ESTIMATE DOMAIN SERVICE
// ============================================================================

export class EstimateService {
  /**
   * List estimates for an account with server-side filtering & pagination.
   */
  async listEstimates(
    supabase: AppSupabaseClient,
    accountId: string,
    filters: EstimateFilterInput = {},
  ) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('estimates')
      .select(
        `
        *,
        projects!project_id(id, name),
        estimate_line_items!estimate_id(id, position, description, quantity, unit_price_minor, amount_minor)
      `,
        { count: 'exact' },
      )
      .eq('account_id', accountId)
      .is('deleted_at', null);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.projectId) {
      query = query.eq('project_id', filters.projectId);
    }

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(`title.ilike.${term},estimate_number.ilike.${term}`);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      logger.error('Error listing estimates', { accountId, filters }, error);
      throw new Error(`Failed to list estimates: ${error.message}`);
    }

    // Calculate aggregated metrics for the account
    const { data: allActiveEstimates } = await supabase
      .from('estimates')
      .select('status, total_minor')
      .eq('account_id', accountId)
      .is('deleted_at', null);

    const summary = {
      totalCount: count || 0,
      totalPipelineValueMinor: 0,
      draftCount: 0,
      draftValueMinor: 0,
      sentCount: 0,
      sentValueMinor: 0,
      acceptedCount: 0,
      acceptedValueMinor: 0,
      rejectedCount: 0,
    };

    if (allActiveEstimates) {
      for (const est of allActiveEstimates) {
        const val = Number(est.total_minor) || 0;
        summary.totalPipelineValueMinor += val;
        if (est.status === 'draft') {
          summary.draftCount++;
          summary.draftValueMinor += val;
        } else if (est.status === 'sent') {
          summary.sentCount++;
          summary.sentValueMinor += val;
        } else if (est.status === 'accepted') {
          summary.acceptedCount++;
          summary.acceptedValueMinor += val;
        } else if (est.status === 'rejected') {
          summary.rejectedCount++;
        }
      }
    }

    return {
      estimates: (data || []) as EstimateWithLineItems[],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      summary,
    };
  }

  /**
   * Get estimate by ID with line items, enforcing account boundary.
   */
  async getEstimateById(
    supabase: AppSupabaseClient,
    accountId: string,
    estimateId: string,
  ): Promise<EstimateWithLineItems | null> {
    const { data, error } = await supabase
      .from('estimates')
      .select(
        `
        *,
        projects!project_id(id, name),
        estimate_line_items!estimate_id(id, position, description, quantity, unit_price_minor, amount_minor, created_at, updated_at)
      `,
      )
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) {
      logger.error('Error fetching estimate by ID', { accountId, estimateId }, error);
      throw new Error(`Failed to fetch estimate: ${error.message}`);
    }

    if (!data) return null;

    // Ensure line items are sorted by position
    if (data.estimate_line_items && Array.isArray(data.estimate_line_items)) {
      data.estimate_line_items.sort(
        (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0),
      );
    }

    return data as unknown as EstimateWithLineItems;
  }

  /**
   * Create estimate with line items atomically and idempotently.
   */
  async createEstimate(
    supabase: AppSupabaseClient,
    accountId: string,
    userId: string | null,
    input: CreateEstimateInput,
    idempotencyKey?: string,
  ): Promise<EstimateWithLineItems> {
    // 1. Tenancy check: if project_id is provided, verify it belongs to this account
    if (input.project_id) {
      const { data: project, error: projError } = await supabase
        .from('projects')
        .select('account_id')
        .eq('id', input.project_id)
        .maybeSingle();

      if (projError || !project) {
        throw new Error('Project not found');
      }

      if (project.account_id !== accountId) {
        throw new Error('Tenant boundary violation: Project does not belong to this account');
      }
    }

    // 2. Recalculate all totals server-side
    const { subtotalMinor, taxMinor, totalMinor, calculatedItems } = calculateEstimateTotals(
      input.line_items,
      input.tax_rate || 0,
    );

    // 3. Insert header
    const { data: estimate, error: estError } = await supabase
      .from('estimates')
      .insert({
        account_id: accountId,
        project_id: input.project_id || null,
        estimate_number: input.estimate_number,
        title: input.title,
        description: input.description || null,
        status: 'draft',
        currency: input.currency || 'USD',
        subtotal_minor: subtotalMinor,
        tax_minor: taxMinor,
        total_minor: totalMinor,
        valid_until: input.valid_until || null,
        created_by: userId || null,
        idempotency_key: idempotencyKey || null,
      })
      .select()
      .single();

    if (estError) {
      logger.error('Error creating estimate header', { accountId, input }, estError);
      throw new Error(`Failed to create estimate: ${estError.message}`);
    }

    // 4. Insert line items
    const lineItemRows = calculatedItems.map((item) => ({
      estimate_id: estimate.id,
      account_id: accountId,
      position: item.position,
      description: item.description,
      quantity: item.quantity,
      unit_price_minor: item.unit_price_minor,
      amount_minor: item.amount_minor,
    }));

    const { data: lineItems, error: itemsError } = await supabase
      .from('estimate_line_items')
      .insert(lineItemRows)
      .select();

    if (itemsError) {
      logger.error('Error creating estimate line items', { estimateId: estimate.id }, itemsError);
      // Soft-delete the orphaned header if line items fail
      await supabase.from('estimates').update({ deleted_at: new Date().toISOString() }).eq('id', estimate.id);
      throw new Error(`Failed to create line items: ${itemsError.message}`);
    }

    return {
      ...estimate,
      estimate_line_items: lineItems || [],
    } as unknown as EstimateWithLineItems;
  }

  /**
   * Update draft estimate and line items.
   * Modifying non-draft estimates is strictly prohibited.
   */
  async updateEstimate(
    supabase: AppSupabaseClient,
    accountId: string,
    estimateId: string,
    input: UpdateEstimateInput,
  ): Promise<EstimateWithLineItems> {
    const existing = await this.getEstimateById(supabase, accountId, estimateId);
    if (!existing) {
      throw new Error('Estimate not found');
    }

    if (existing.status !== 'draft') {
      throw new Error('Lifecycle lock: Only draft estimates may be modified');
    }

    // Tenancy check if project_id is being changed
    if (input.project_id) {
      const { data: project } = await supabase
        .from('projects')
        .select('account_id')
        .eq('id', input.project_id)
        .maybeSingle();

      if (!project || project.account_id !== accountId) {
        throw new Error('Tenant boundary violation: Project does not belong to this account');
      }
    }

    const updates: Partial<Estimate> = {};
    if (input.estimate_number !== undefined) updates.estimate_number = input.estimate_number;
    if (input.title !== undefined) updates.title = input.title;
    if (input.description !== undefined) updates.description = input.description;
    if (input.project_id !== undefined) updates.project_id = input.project_id;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.valid_until !== undefined) updates.valid_until = input.valid_until;

    // If line items or tax rate are updated, recalculate financial totals
    if (input.line_items) {
      const taxRate = input.tax_rate !== undefined ? input.tax_rate : 0;
      const { subtotalMinor, taxMinor, totalMinor, calculatedItems } = calculateEstimateTotals(
        input.line_items,
        taxRate,
      );

      updates.subtotal_minor = subtotalMinor;
      updates.tax_minor = taxMinor;
      updates.total_minor = totalMinor;

      // Replace line items: remove existing line items and insert new
      await supabase.from('estimate_line_items').delete().eq('estimate_id', estimateId);

      const lineItemRows = calculatedItems.map((item) => ({
        estimate_id: estimateId,
        account_id: accountId,
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unit_price_minor: item.unit_price_minor,
        amount_minor: item.amount_minor,
      }));

      await supabase.from('estimate_line_items').insert(lineItemRows);
    }

    const { data: updated, error } = await supabase
      .from('estimates')
      .update(updates)
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .select()
      .single();

    if (error) {
      logger.error('Error updating estimate', { estimateId, updates }, error);
      throw new Error(`Failed to update estimate: ${error.message}`);
    }

    return (await this.getEstimateById(supabase, accountId, estimateId))!;
  }

  /**
   * Transition estimate lifecycle status.
   * Invariant: draft -> sent -> accepted | rejected
   */
  async transitionEstimateStatus(
    supabase: AppSupabaseClient,
    accountId: string,
    estimateId: string,
    targetStatus: EstimateStatus,
    rejectionReason?: string | null,
  ): Promise<EstimateWithLineItems> {
    const estimate = await this.getEstimateById(supabase, accountId, estimateId);
    if (!estimate) {
      throw new Error('Estimate not found');
    }

    const currentStatus = estimate.status as EstimateStatus;

    if (!canTransition(currentStatus, targetStatus)) {
      throw new Error(
        `Invalid lifecycle transition: Cannot transition estimate from '${currentStatus}' to '${targetStatus}'`,
      );
    }

    const updates: Record<string, any> = {
      status: targetStatus,
    };

    if (targetStatus === 'sent') {
      // Must have at least one line item and total > 0 to send
      if (!estimate.estimate_line_items || estimate.estimate_line_items.length === 0) {
        throw new Error('Cannot send an estimate with no line items');
      }
      if (Number(estimate.total_minor) <= 0) {
        throw new Error('Cannot send an estimate with total amount of 0');
      }
      updates.sent_at = new Date().toISOString();
    } else if (targetStatus === 'accepted') {
      updates.accepted_at = new Date().toISOString();
    } else if (targetStatus === 'rejected') {
      updates.rejected_at = new Date().toISOString();
      if (rejectionReason) {
        updates.rejection_reason = rejectionReason;
      }
    }

    const { error } = await supabase
      .from('estimates')
      .update(updates)
      .eq('id', estimateId)
      .eq('account_id', accountId);

    if (error) {
      logger.error('Error transitioning estimate', { estimateId, targetStatus }, error);
      throw new Error(`Failed to transition estimate: ${error.message}`);
    }

    return (await this.getEstimateById(supabase, accountId, estimateId))!;
  }

  /**
   * Soft delete estimate (sets deleted_at).
   * Note: Database trigger completely blocks hard DELETEs.
   */
  async softDeleteEstimate(
    supabase: AppSupabaseClient,
    accountId: string,
    estimateId: string,
  ): Promise<void> {
    const estimate = await this.getEstimateById(supabase, accountId, estimateId);
    if (!estimate) {
      throw new Error('Estimate not found');
    }

    if (estimate.status === 'accepted') {
      throw new Error('Accepted estimates cannot be deleted');
    }

    const now = new Date().toISOString();

    // Soft delete header
    const { error: headerError } = await supabase
      .from('estimates')
      .update({ deleted_at: now })
      .eq('id', estimateId)
      .eq('account_id', accountId);

    if (headerError) {
      throw new Error(`Failed to soft delete estimate: ${headerError.message}`);
    }

    // Soft delete associated line items
    await supabase
      .from('estimate_line_items')
      .update({ deleted_at: now })
      .eq('estimate_id', estimateId)
      .eq('account_id', accountId);
  }

  /**
   * Idempotency record handler.
   */
  async checkIdempotency(
    supabase: AppSupabaseClient,
    accountId: string,
    key: string,
    path: string,
    payload: unknown,
  ): Promise<
    | { status: 'hit'; responseStatus: number; responseBody: any }
    | { status: 'conflict'; message: string }
    | { status: 'miss'; paramsHash: string }
  > {
    const paramsHash = hashPayload(payload);

    const { data: existing, error } = await supabase
      .from('idempotency_keys')
      .select('*')
      .eq('account_id', accountId)
      .eq('key', key)
      .maybeSingle();

    if (error) {
      logger.error('Error querying idempotency key', { accountId, key }, error);
      return { status: 'miss', paramsHash };
    }

    if (!existing) {
      return { status: 'miss', paramsHash };
    }

    // Check expiration
    if (new Date(existing.expires_at).getTime() < Date.now()) {
      return { status: 'miss', paramsHash };
    }

    // Compare payload hash
    if (existing.params_hash !== paramsHash) {
      return {
        status: 'conflict',
        message: 'Idempotency conflict: key was previously used with different parameters',
      };
    }

    return {
      status: 'hit',
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    };
  }

  /**
   * Record idempotency outcome.
   */
  async saveIdempotency(
    supabase: AppSupabaseClient,
    accountId: string,
    key: string,
    path: string,
    paramsHash: string,
    responseStatus: number,
    responseBody: any,
  ): Promise<void> {
    await supabase.from('idempotency_keys').upsert({
      account_id: accountId,
      key,
      request_path: path,
      params_hash: paramsHash,
      response_status: responseStatus,
      response_body: responseBody,
    });
  }
}

export const estimateService = new EstimateService();

