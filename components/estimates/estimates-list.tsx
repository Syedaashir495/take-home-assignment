'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EstimateStatusBadge } from './estimate-status-badge';
import { CreateEstimateDialog } from './create-estimate-dialog';
import { EstimateDetailDialog } from './estimate-detail-dialog';
import { formatCurrency } from './line-item-editor';
import {
  Search,
  Filter,
  FileText,
  DollarSign,
  Clock,
  Send,
  CheckCircle2,
  AlertCircle,
  Eye,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { EstimateWithLineItems, EstimateStatus } from '@/lib/supabase';

interface ProjectOption {
  id: string;
  name: string;
}

interface EstimatesListProps {
  accountId: string;
  projects?: ProjectOption[];
  canManage?: boolean;
}

export function EstimatesList({
  accountId,
  projects = [],
  canManage = true,
}: EstimatesListProps) {
  const [loading, setLoading] = useState(true);
  const [estimates, setEstimates] = useState<EstimateWithLineItems[]>([]);
  const [summary, setSummary] = useState({
    totalCount: 0,
    totalPipelineValueMinor: 0,
    draftCount: 0,
    draftValueMinor: 0,
    sentCount: 0,
    sentValueMinor: 0,
    acceptedCount: 0,
    acceptedValueMinor: 0,
    rejectedCount: 0,
  });

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected estimate for detail modal
  const [selectedEstimate, setSelectedEstimate] = useState<EstimateWithLineItems | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (projectFilter !== 'all') params.set('projectId', projectFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const res = await fetch(`/api/accounts/${accountId}/estimates?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch estimates');
      }

      setEstimates(data.estimates || []);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error loading estimates');
    } finally {
      setLoading(false);
    }
  }, [accountId, statusFilter, projectFilter, searchTerm]);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  const handleEstimateCreated = (newEst: EstimateWithLineItems) => {
    setEstimates((prev) => [newEst, ...prev]);
    fetchEstimates();
  };

  const handleEstimateUpdated = (updated: EstimateWithLineItems) => {
    setEstimates((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    setSelectedEstimate(updated);
    fetchEstimates();
  };

  const handleEstimateDeleted = (deletedId: string) => {
    setEstimates((prev) => prev.filter((e) => e.id !== deletedId));
    fetchEstimates();
  };

  const openDetail = (estimate: EstimateWithLineItems) => {
    setSelectedEstimate(estimate);
    setDetailModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 1. Metric Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Total Pipeline
            </span>
            <DollarSign className="text-muted-foreground h-4 w-4" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatCurrency(summary.totalPipelineValueMinor)}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {summary.totalCount} total estimates
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Drafts
            </span>
            <Clock className="h-4 w-4 text-slate-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatCurrency(summary.draftValueMinor)}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {summary.draftCount} draft proposals
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Sent / Pending
            </span>
            <Send className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">
            {formatCurrency(summary.sentValueMinor)}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {summary.sentCount} awaiting decision
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Accepted Revenue
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(summary.acceptedValueMinor)}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {summary.acceptedCount} signed commitments
          </p>
        </Card>
      </div>

      {/* 2. Estimates Table Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="text-lg sm:text-xl">Estimates & Quotes</CardTitle>
              <CardDescription>
                Financial proposals, pricing breakdowns, and client commitment lifecycle
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchEstimates()}
                disabled={loading}
                title="Refresh estimates"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {canManage && (
                <CreateEstimateDialog
                  accountId={accountId}
                  projects={projects}
                  onEstimateCreated={handleEstimateCreated}
                />
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-3 top-2.5 h-4 w-4" />
              <Input
                placeholder="Search by title or estimate #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              {projects.length > 0 && (
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="w-[160px] text-sm">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              <p className="text-muted-foreground mt-2 text-sm">Loading estimates...</p>
            </div>
          ) : estimates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="text-muted-foreground/40 mb-3 h-12 w-12" />
              <h3 className="text-base font-semibold">No estimates found</h3>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                {searchTerm || statusFilter !== 'all' || projectFilter !== 'all'
                  ? 'No estimates match your active filters. Try clearing filters.'
                  : 'Get started by creating your first draft estimate for this client account.'}
              </p>
              {canManage && (
                <div className="mt-4">
                  <CreateEstimateDialog
                    accountId={accountId}
                    projects={projects}
                    onEstimateCreated={handleEstimateCreated}
                  >
                    <Button size="sm">Create First Estimate</Button>
                  </CreateEstimateDialog>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[120px]">Estimate #</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="w-[120px]">Valid Until</TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimates.map((est) => (
                    <TableRow
                      key={est.id}
                      className="cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => openDetail(est)}
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        {est.estimate_number}
                      </TableCell>
                      <TableCell className="font-medium">
                        <div>
                          <span>{est.title}</span>
                          {est.description && (
                            <p className="text-muted-foreground line-clamp-1 text-xs font-normal">
                              {est.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {est.projects?.name || '—'}
                      </TableCell>
                      <TableCell>
                        <EstimateStatusBadge status={est.status as EstimateStatus} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(est.total_minor, est.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {est.valid_until
                          ? format(new Date(est.valid_until), 'MMM d, yyyy')
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openDetail(est)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Detail & Lifecycle Dialog */}
      <EstimateDetailDialog
        estimate={selectedEstimate}
        accountId={accountId}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        onEstimateUpdated={handleEstimateUpdated}
        onEstimateDeleted={handleEstimateDeleted}
        canManage={canManage}
      />
    </div>
  );
}

