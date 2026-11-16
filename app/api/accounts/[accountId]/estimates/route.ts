import { NextRequest, NextResponse } from 'next/server';
import { createApiSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase-server';
import { requireAuthAndPermission, handleGuardError } from '@/lib/server-guards';
import { Permission } from '@/lib/permissions';
import { createEstimateSchema, estimateFilterSchema } from '@/lib/validation-schemas';
import { isValidUUID } from '@/lib/validation-helpers';
import { estimateService } from '@/lib/estimate-service';
import { logger } from '@/lib/debug-logger';

interface RouteParams {
  params: Promise<{
    accountId: string;
  }>;
}

/**
 * GET /api/accounts/[accountId]/estimates
 * Server-side list, filter, search, and pagination for estimates scoped to an account.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid account ID format' }, { status: 400 });
    }

    // Require VIEW_ESTIMATES permission scoped to this account
    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const supabase = createAdminSupabaseClient() || createApiSupabaseClient(request);
    if (!supabase) {
      return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    // Parse and validate query filters
    const searchParams = request.nextUrl.searchParams;
    const filterInput = {
      status: searchParams.get('status') || undefined,
      projectId: searchParams.get('projectId') || undefined,
      search: searchParams.get('search') || undefined,
      page: searchParams.get('page') ? Number(searchParams.get('page')) : 1,
      limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 20,
    };

    const validation = estimateFilterSchema.safeParse(filterInput);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid filter parameters', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    const result = await estimateService.listEstimates(supabase, accountId, validation.data);

    return NextResponse.json(result);
  } catch (error) {
    logger.error('Error in GET /api/accounts/[accountId]/estimates', {}, error as Error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/accounts/[accountId]/estimates
 * Create draft estimate with line items using Idempotency-Key.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { accountId } = await params;

    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid account ID format' }, { status: 400 });
    }

    // Require MANAGE_ESTIMATES permission scoped to this account
    const user = await requireAuthAndPermission(Permission.MANAGE_ESTIMATES, { accountId }, request);

    // Enforce Idempotency-Key header for safe money-touching operations
    const idempotencyKey =
      request.headers.get('idempotency-key') || request.headers.get('Idempotency-Key');

    if (!idempotencyKey || idempotencyKey.trim() === '') {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required for creating estimates' },
        { status: 400 },
      );
    }

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

    // Check idempotency cache
    const idempotency = await estimateService.checkIdempotency(
      supabase,
      accountId,
      idempotencyKey.trim(),
      request.nextUrl.pathname,
      body,
    );

    if (idempotency.status === 'hit') {
      return NextResponse.json(idempotency.responseBody, {
        status: idempotency.responseStatus,
        headers: { 'Idempotent-Replay': 'true' },
      });
    }

    if (idempotency.status === 'conflict') {
      return NextResponse.json({ error: idempotency.message }, { status: 409 });
    }

    // Validate body with Zod schema
    const validation = createEstimateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten() },
        { status: 400 },
      );
    }

    // Create estimate and line items atomically
    const estimate = await estimateService.createEstimate(
      supabase,
      accountId,
      user.id,
      validation.data,
      idempotencyKey.trim(),
    );

    const responsePayload = { estimate };

    // Record idempotency record
    await estimateService.saveIdempotency(
      supabase,
      accountId,
      idempotencyKey.trim(),
      request.nextUrl.pathname,
      idempotency.paramsHash,
      201,
      responsePayload,
    );

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error: any) {
    logger.error('Error in POST /api/accounts/[accountId]/estimates', {}, error);
    if (error?.message?.includes('Tenant boundary violation')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return handleGuardError(error);
  }
}

