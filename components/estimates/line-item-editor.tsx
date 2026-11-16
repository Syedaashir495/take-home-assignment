'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import type { CreateEstimateLineItemInput } from '@/lib/validation-schemas';

export interface EditableLineItem extends CreateEstimateLineItemInput {
  id?: string;
  amount_minor: number;
}

interface LineItemEditorProps {
  lineItems: EditableLineItem[];
  onChange: (items: EditableLineItem[]) => void;
  taxRate: number;
  onTaxRateChange: (rate: number) => void;
  currency?: string;
  readOnly?: boolean;
}

/**
 * Formats minor units (cents) to standard currency string (e.g. $1,250.00)
 */
export function formatCurrency(amountMinor: number, currency: string = 'USD'): string {
  const amount = (amountMinor || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function LineItemEditor({
  lineItems,
  onChange,
  taxRate,
  onTaxRateChange,
  currency = 'USD',
  readOnly = false,
}: LineItemEditorProps) {
  const updateItem = (index: number, updates: Partial<EditableLineItem>) => {
    const updated = [...lineItems];
    const item = { ...updated[index], ...updates };

    // Recalculate amount_minor: round(quantity * unit_price_minor)
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 0;
    const unitPriceMinor = Number(item.unit_price_minor) >= 0 ? Number(item.unit_price_minor) : 0;
    item.amount_minor = Math.round(quantity * unitPriceMinor);

    updated[index] = item;
    onChange(updated);
  };

  const addItem = () => {
    const newItem: EditableLineItem = {
      description: '',
      quantity: 1,
      unit_price_minor: 0,
      amount_minor: 0,
      position: lineItems.length,
    };
    onChange([...lineItems, newItem]);
  };

  const removeItem = (index: number) => {
    if (lineItems.length <= 1) return;
    const updated = lineItems.filter((_, i) => i !== index);
    onChange(updated);
  };

  // Calculations
  const subtotalMinor = lineItems.reduce((sum, item) => sum + (item.amount_minor || 0), 0);
  const taxMinor = taxRate > 0 ? Math.round(subtotalMinor * taxRate) : 0;
  const totalMinor = subtotalMinor + taxMinor;

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-12 gap-2 border-b p-3 text-xs font-medium">
          <div className="col-span-6">Description</div>
          <div className="col-span-2 text-right">Qty</div>
          <div className="col-span-2 text-right">Unit Price ($)</div>
          <div className="col-span-2 text-right">Amount</div>
        </div>

        <div className="divide-y">
          {lineItems.map((item, index) => {
            const priceInDollars = ((item.unit_price_minor || 0) / 100).toFixed(2);

            return (
              <div key={index} className="grid grid-cols-12 items-center gap-2 p-3 text-sm">
                <div className="col-span-6 flex items-center gap-2">
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
                      onClick={() => removeItem(index)}
                      disabled={lineItems.length <= 1}
                      title={lineItems.length <= 1 ? 'Minimum 1 line item required' : 'Remove item'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {readOnly ? (
                    <span className="font-medium">{item.description}</span>
                  ) : (
                    <Input
                      placeholder="Scope item description..."
                      value={item.description}
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                      className="h-8 text-sm"
                      required
                    />
                  )}
                </div>

                <div className="col-span-2">
                  {readOnly ? (
                    <span className="block text-right">{item.quantity}</span>
                  ) : (
                    <Input
                      type="number"
                      step="any"
                      min="0.01"
                      placeholder="1"
                      value={item.quantity || ''}
                      onChange={(e) =>
                        updateItem(index, { quantity: parseFloat(e.target.value) || 0 })
                      }
                      className="h-8 text-right text-sm"
                      required
                    />
                  )}
                </div>

                <div className="col-span-2">
                  {readOnly ? (
                    <span className="block text-right">{formatCurrency(item.unit_price_minor, currency)}</span>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={priceInDollars === '0.00' && !item.unit_price_minor ? '' : priceInDollars}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        updateItem(index, { unit_price_minor: Math.round(val * 100) });
                      }}
                      className="h-8 text-right text-sm"
                      required
                    />
                  )}
                </div>

                <div className="col-span-2 text-right font-medium">
                  {formatCurrency(item.amount_minor, currency)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addItem}
          className="flex items-center gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Line Item
        </Button>
      )}

      {/* Financial Summary */}
      <div className="flex justify-end pt-2">
        <div className="bg-muted/30 w-72 space-y-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{formatCurrency(subtotalMinor, currency)}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Tax</span>
              {!readOnly ? (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={(taxRate * 100).toString()}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      onTaxRateChange(val / 100);
                    }}
                    className="h-6 w-14 text-right text-xs"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </div>
              ) : (
                <span className="text-muted-foreground text-xs">({(taxRate * 100).toFixed(1)}%)</span>
              )}
            </div>
            <span className="font-medium">{formatCurrency(taxMinor, currency)}</span>
          </div>

          <div className="border-t pt-2">
            <div className="flex justify-between font-semibold">
              <span>Total Amount</span>
              <span className="text-foreground text-base">{formatCurrency(totalMinor, currency)}</span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-right text-[10px]">
              Stored as {totalMinor.toLocaleString()} minor units
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

