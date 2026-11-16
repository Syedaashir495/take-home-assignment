'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EstimateStatusBadge } from './estimate-status-badge';
import { formatCurrency } from './line-item-editor';
import {
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Calendar,
  Building,
  Briefcase,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { EstimateWithLineItems, EstimateStatus } from '@/lib/supabase';

interface EstimateDetailDialogProps {
  estimate: EstimateWithLineItems | null;
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEstimateUpdated: (updated: EstimateWithLineItems) => void;
  onEstimateDeleted?: (estimateId: string) => void;
  canManage?: boolean;
}

export function EstimateDetailDialog({
  estimate,
  accountId,
  open,
  onOpenChange,
  onEstimateUpdated,
  onEstimateDeleted,
  canManage = true,
}: EstimateDetailDialogProps) {
  const [transitioning, setTransitioning] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  if (!estimate) return null;

  const handleTransition = async (targetStatus: EstimateStatus, reason?: string) => {
    setTransitioning(true);
    try {
      const res = await fetch(
        `/api/accounts/${accountId}/estimates/${estimate.id}/transition`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: targetStatus,
            rejection_reason: reason || null,
          }),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update estimate status');
      }

      toast.success(`Estimate status updated to ${targetStatus}`);
      onEstimateUpdated(data.estimate);
      if (rejectDialogOpen) {
        setRejectDialogOpen(false);
        setRejectionReason('');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error updating status');
    } finally {
      setTransitioning(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!confirm('Are you sure you want to delete this estimate draft?')) return;

    setTransitioning(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}/estimates/${estimate.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete estimate');
      }

      toast.success('Estimate deleted');
      onOpenChange(false);
      if (onEstimateDeleted) {
        onEstimateDeleted(estimate.id);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error deleting estimate');
    } finally {
      setTransitioning(false);
    }
  };

  const lineItems = estimate.estimate_line_items || [];
  const status = estimate.status as EstimateStatus;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                  {estimate.estimate_number}
                </span>
                <EstimateStatusBadge status={status} />
              </div>
              <span className="text-xs text-muted-foreground">
                Created {format(new Date(estimate.created_at), 'MMM d, yyyy')}
              </span>
            </div>
            <DialogTitle className="text-xl">{estimate.title}</DialogTitle>
            {estimate.description && (
              <DialogDescription className="text-sm">
                {estimate.description}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Meta Details */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
            {estimate.projects && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" />
                <span>Project:</span>
                <span className="font-medium text-foreground">{estimate.projects.name}</span>
              </div>
            )}
            {estimate.valid_until && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                <span>Valid Until:</span>
                <span className="font-medium text-foreground">
                  {format(new Date(estimate.valid_until), 'MMM d, yyyy')}
                </span>
              </div>
            )}
            {estimate.sent_at && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Send className="h-3.5 w-3.5" />
                <span>Sent:</span>
                <span className="font-medium text-foreground">
                  {format(new Date(estimate.sent_at), 'MMM d, yyyy')}
                </span>
              </div>
            )}
            {estimate.accepted_at && (
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Accepted:</span>
                <span className="font-medium">
                  {format(new Date(estimate.accepted_at), 'MMM d, yyyy')}
                </span>
              </div>
            )}
            {estimate.rejected_at && (
              <div className="flex items-center gap-1.5 text-rose-600">
                <XCircle className="h-3.5 w-3.5" />
                <span>Rejected:</span>
                <span className="font-medium">
                  {format(new Date(estimate.rejected_at), 'MMM d, yyyy')}
                </span>
              </div>
            )}
          </div>

          {/* Rejection Banner */}
          {status === 'rejected' && estimate.rejection_reason && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <span className="font-semibold">Rejection Reason:</span>
                <p className="mt-0.5">{estimate.rejection_reason}</p>
              </div>
            </div>
          )}

          {/* Line Items Table */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scope of Work & Pricing
            </h4>
            <div className="rounded-md border">
              <div className="grid grid-cols-12 gap-2 border-b bg-muted/40 p-2.5 text-xs font-medium text-muted-foreground">
                <div className="col-span-6">Description</div>
                <div className="col-span-2 text-right">Qty</div>
                <div className="col-span-2 text-right">Unit Price</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              <div className="divide-y text-sm">
                {lineItems.map((item, idx) => (
                  <div key={item.id || idx} className="grid grid-cols-12 gap-2 p-2.5 text-xs">
                    <div className="col-span-6 font-medium text-foreground">{item.description}</div>
                    <div className="col-span-2 text-right text-muted-foreground">{item.quantity}</div>
                    <div className="col-span-2 text-right text-muted-foreground">
                      {formatCurrency(item.unit_price_minor, estimate.currency)}
                    </div>
                    <div className="col-span-2 text-right font-medium text-foreground">
                      {formatCurrency(item.amount_minor, estimate.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 rounded-lg border bg-muted/20 p-3 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatCurrency(estimate.subtotal_minor, estimate.currency)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Tax</span>
                <span>{formatCurrency(estimate.tax_minor, estimate.currency)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-bold text-foreground">
                <span>Total</span>
                <span className="text-sm">
                  {formatCurrency(estimate.total_minor, estimate.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Lifecycle Action Buttons */}
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t pt-4">
            <div>
              {canManage && status === 'draft' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={handleSoftDelete}
                  disabled={transitioning}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete Draft
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>

              {canManage && status === 'draft' && (
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handleTransition('sent')}
                  disabled={transitioning}
                >
                  {transitioning ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Send to Client
                </Button>
              )}

              {status === 'sent' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={transitioning}
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => handleTransition('accepted')}
                    disabled={transitioning}
                  >
                    {transitioning ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Accept Estimate
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Reason Modal */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Estimate</DialogTitle>
            <DialogDescription>
              Please provide a reason for declining this estimate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="rejectionReason">Reason (Optional)</Label>
            <Input
              id="rejectionReason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Budget constraints, scope changes required..."
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRejectDialogOpen(false)}
              disabled={transitioning}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleTransition('rejected', rejectionReason)}
              disabled={transitioning}
            >
              {transitioning && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

