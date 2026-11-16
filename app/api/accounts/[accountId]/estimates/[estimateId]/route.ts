import { NextRequest, NextResponse } from 'next/server';
import { createApiSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase-server';
import { requireAuthAndPermission, handleGuardError } from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import { updateEstimateSchema } from '@/lib/validation-schemas';
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
 * GET /api/accounts/[accountId]/estimates/[estimateId]
 * Get estimate by ID with full line items, enforcing account boundary.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Require VIEW_ESTIMATES permission scoped to this account
    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const supabase = createAdminSupabaseClient() || createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    const estimate = await estimateService.getEstimateById(supabase, accountId, estimateId);

    if (!estimate) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    return NextResponse.json({ estimate });
  } catch (error) {
    logger.error('Error in GET /api/accounts/[accountId]/estimates/[estimateId]', {}, error as Error);
    return handleGuardError(error);
  }
}

/**
 * PATCH /api/accounts/[accountId]/estimates/[estimateId]
 * Update draft estimate details and line items.
 * Non-draft estimates cannot be mutated.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Require MANAGE_ESTIMATES permission scoped to this account
    await requireAuthAndPermission(Permission.MANAGE_ESTIMATES, { accountId }, request);

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

    const validation = updateEstimateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await estimateService.updateEstimate(
      supabase,
      accountId,
      estimateId,
      validation.data,
    );

    return NextResponse.json({ estimate: updated });
  } catch (error: any) {
    logger.error('Error in PATCH /api/accounts/[accountId]/estimates/[estimateId]', {}, error);
    if (error?.message?.includes('Lifecycle lock')) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error?.message?.includes('Tenant boundary violation')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error?.message?.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleGuardError(error);
  }
}

/**
 * DELETE /api/accounts/[accountId]/estimates/[estimateId]
 * Soft-delete estimate (marks deleted_at timestamp). Hard deletes are prohibited.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId, estimateId } = await params;

    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    // Require MANAGE_ESTIMATES permission scoped to this account
    await requireAuthAndPermission(Permission.MANAGE_ESTIMATES, { accountId }, request);

    const supabase = createAdminSupabaseClient() || createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    await estimateService.softDeleteEstimate(supabase, accountId, estimateId);

    return NextResponse.json({
      success: true,
      message: 'Estimate soft-deleted successfully',
    });
  } catch (error: any) {
    logger.error('Error in DELETE /api/accounts/[accountId]/estimates/[estimateId]', {}, error);
    if (error?.message?.includes('Accepted estimates cannot be deleted')) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    if (error?.message?.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleGuardError(error);
  }
}

