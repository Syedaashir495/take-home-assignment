'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { LineItemEditor, EditableLineItem } from './line-item-editor';
import type { EstimateWithLineItems } from '@/lib/supabase';

interface ProjectOption {
  id: string;
  name: string;
}

interface CreateEstimateDialogProps {
  accountId: string;
  projects?: ProjectOption[];
  onEstimateCreated?: (estimate: EstimateWithLineItems) => void;
  children?: React.ReactNode;
}

export function CreateEstimateDialog({
  accountId,
  projects = [],
  onEstimateCreated,
  children,
}: CreateEstimateDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [estimateNumber, setEstimateNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string>('none');
  const [currency, setCurrency] = useState('USD');
  const [validUntil, setValidUntil] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [lineItems, setLineItems] = useState<EditableLineItem[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Reset & initialize when dialog opens
  useEffect(() => {
    if (open) {
      const year = new Date().getFullYear();
      const randNum = Math.floor(1000 + Math.random() * 9000);
      setEstimateNumber(`EST-${year}-${randNum}`);
      setTitle('');
      setDescription('');
      setProjectId('none');
      setCurrency('USD');

      // Default valid until 30 days from now (YYYY-MM-DD)
      const future = new Date();
      future.setDate(future.getDate() + 30);
      setValidUntil(future.toISOString().split('T')[0]);

      setTaxRate(0);
      setLineItems([
        {
          description: '',
          quantity: 1,
          unit_price_minor: 0,
          amount_minor: 0,
          position: 0,
        },
      ]);

      // Generate a fresh Idempotency-Key
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      );
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Please enter an estimate title');
      return;
    }

    if (!estimateNumber.trim()) {
      toast.error('Please enter an estimate number');
      return;
    }

    if (lineItems.length === 0 || !lineItems[0].description.trim()) {
      toast.error('Please provide at least one valid line item with a description');
      return;
    }

    // Ensure all items have descriptions
    for (const item of lineItems) {
      if (!item.description.trim()) {
        toast.error('Every line item must have a description');
        return;
      }
      if (item.quantity <= 0) {
        toast.error('Line item quantity must be greater than 0');
        return;
      }
    }

    setSubmitting(true);

    try {
      const payload = {
        estimate_number: estimateNumber.trim(),
        title: title.trim(),
        description: description.trim() || null,
        project_id: projectId === 'none' ? null : projectId,
        currency,
        valid_until: validUntil || null,
        tax_rate: taxRate,
        line_items: lineItems.map((item, idx) => ({
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unit_price_minor: Number(item.unit_price_minor),
          position: idx,
        })),
      };

      const res = await fetch(`/api/accounts/${accountId}/estimates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create estimate');
      }

      toast.success('Estimate draft created successfully');
      setOpen(false);

      if (onEstimateCreated && data.estimate) {
        onEstimateCreated(data.estimate);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error creating estimate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button size="sm" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            <span>New Estimate</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <DialogHeader>
            <DialogTitle>Create Draft Estimate</DialogTitle>
            <DialogDescription>
              Create a new financial proposal scoped to this account. Drafts can be reviewed and edited before sending.
            </DialogDescription>
          </DialogHeader>

          {/* Primary Metadata */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="estimateNumber">Estimate #</Label>
              <Input
                id="estimateNumber"
                value={estimateNumber}
                onChange={(e) => setEstimateNumber(e.target.value)}
                placeholder="EST-2026-001"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($ - US Dollar)</SelectItem>
                  <SelectItem value="EUR">EUR (€ - Euro)</SelectItem>
                  <SelectItem value="GBP">GBP (£ - British Pound)</SelectItem>
                  <SelectItem value="CAD">CAD ($ - Canadian Dollar)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="title">Estimate Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Q1 Infrastructure Migration & Security Hardening"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project">Linked Project (Optional)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="project">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Account-level general)</SelectItem>
                  {projects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>
                      {proj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="validUntil">Valid Until</Label>
              <Input
                id="validUntil"
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Scope Overview / Notes</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of the scope, deliverables, and payment assumptions..."
                rows={2}
              />
            </div>
          </div>

          {/* Line-Item Editor */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">Scope & Line Items</Label>
            <LineItemEditor
              lineItems={lineItems}
              onChange={setLineItems}
              taxRate={taxRate}
              onTaxRateChange={setTaxRate}
              currency={currency}
            />
          </div>

          <DialogFooter className="flex items-center justify-between border-t pt-4">
            <span className="text-muted-foreground text-xs">
              Idempotency: <code className="bg-muted rounded px-1">{idempotencyKey.slice(0, 8)}...</code>
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Draft
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

