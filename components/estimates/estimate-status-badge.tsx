'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import type { EstimateStatus } from '@/lib/supabase';
import { Clock, Send, CheckCircle2, XCircle } from 'lucide-react';

interface EstimateStatusBadgeProps {
  status: EstimateStatus;
  className?: string;
}

export function EstimateStatusBadge({ status, className = '' }: EstimateStatusBadgeProps) {
  switch (status) {
    case 'draft':
      return (
        <Badge
          variant="outline"
          className={`flex items-center gap-1 border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${className}`}
        >
          <Clock className="h-3 w-3" />
          <span>Draft</span>
        </Badge>
      );
    case 'sent':
      return (
        <Badge
          variant="outline"
          className={`flex items-center gap-1 border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300 ${className}`}
        >
          <Send className="h-3 w-3" />
          <span>Sent</span>
        </Badge>
      );
    case 'accepted':
      return (
        <Badge
          variant="outline"
          className={`flex items-center gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ${className}`}
        >
          <CheckCircle2 className="h-3 w-3" />
          <span>Accepted</span>
        </Badge>
      );
    case 'rejected':
      return (
        <Badge
          variant="outline"
          className={`flex items-center gap-1 border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300 ${className}`}
        >
          <XCircle className="h-3 w-3" />
          <span>Rejected</span>
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

