import { NextRequest, NextResponse } from 'next/server';
import { createApiSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase-server';
import { requireAuthentication, handleGuardError } from '@/lib/server-guards';
import { hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';
import { estimateTransitionSchema } from '@/lib/validation-schemas';
import { isValidUUID } from '@/lib/validation-helpers';
import { estimateService } from '@/lib/estimate-service';
import { logger } from '@/lib/debug-logger';

interface RouteParams {
  params: Promise<{
    accountId: string;
    estimateId: string;
  }>;
}

/**
 * POST /api/accounts/[accountId]/estimates/[estimateId]/transition
 * Transition estimate lifecycle: draft -> sent -> accepted | rejected.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const user = await requireAuthentication(request);
    const supabase = createAdminSupabaseClient() || createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const validation = estimateTransitionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const { status: targetStatus, rejection_reason } = validation.data;

    // RBAC check:
    // - Internal staff need MANAGE_ESTIMATES for this account
    // - Client users can accept/reject sent estimates if bound to this account
    let isAuthorized = false;

    if (user.is_client) {
      if (
        user.client_account_id === accountId &&
        (targetStatus === 'accepted' || targetStatus === 'rejected')
      ) {
        isAuthorized = true;
      }
    } else {
      isAuthorized = await hasPermission(
        user,
        Permission.MANAGE_ESTIMATES,
        { accountId },
        supabase,
      );
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'You do not have permission to perform this estimate transition' },
        { status: 403 },
      );
    }

    const updated = await estimateService.transitionEstimateStatus(
      supabase,
      accountId,
      estimateId,
      targetStatus,
      rejection_reason,
    );

    return NextResponse.json({ estimate: updated });
  } catch (error: any) {
    logger.error('Error in POST /api/accounts/[accountId]/estimates/[estimateId]/transition', {}, error);
    if (error?.message?.includes('Invalid lifecycle transition') || error?.message?.includes('Cannot send')) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error?.message?.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleGuardError(error);
  }
}

