"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Mail,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { cadenceLabel } from "@/lib/format";
import type { Client } from "@/lib/types";

const PAGE_SIZES = [5, 10, 20];

const STATUS_STYLES: Record<Client["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  paused: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  prospect: "bg-blue-500/15 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
};

function dateLabel(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relativeLabel(value: string) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.round((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function CustomerTable({
  clients,
  messageTypeCount,
  sendFrequency,
  search,
  onSearchChange,
  onOpen,
  onEmail,
  onToggleStatus,
  onRemove,
}: {
  clients: Client[];
  messageTypeCount: number;
  sendFrequency: Parameters<typeof cadenceLabel>[0];
  search: string;
  onSearchChange: (value: string) => void;
  onOpen: (id: string) => void;
  onEmail: (id: string) => void;
  onToggleStatus: (client: Client) => void;
  onRemove: (client: Client) => void;
}) {
  const [rowSelection, setRowSelection] = useState({});

  const columns = useMemo<ColumnDef<Client>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={
              table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "name",
        header: "Customer",
        cell: ({ row }) => (
          <div className="min-w-0">
            <span className="block font-medium text-foreground">{row.original.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {row.original.company} · {row.original.tier} plan
            </span>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => <span className="text-sm">{row.original.email}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={cn("border-0 capitalize", STATUS_STYLES[row.original.status])}
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "messages",
        header: "Messages",
        enableSorting: false,
        cell: () => (
          <div className="text-sm">
            <span className="block text-foreground">
              {messageTypeCount} type{messageTypeCount === 1 ? "" : "s"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {cadenceLabel(sendFrequency)} batch
            </span>
          </div>
        ),
      },
      {
        accessorKey: "nextSendAt",
        header: "Next send",
        cell: ({ row }) => (
          <div className="text-sm">
            <span className="block text-foreground">{dateLabel(row.original.nextSendAt)}</span>
            <span className="block text-xs text-muted-foreground">
              sent {relativeLabel(row.original.lastContacted)}
            </span>
          </div>
        ),
      },
      {
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button aria-label={`Actions for ${row.original.name}`} size="icon-sm" variant="ghost" />
                }
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onOpen(row.original.id)}>
                  <Eye className="mr-2 h-4 w-4" />
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEmail(row.original.id)}>
                  <Mail className="mr-2 h-4 w-4" />
                  Send now
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggleStatus(row.original)}>
                  {row.original.status === "paused" ? (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Resume sends
                    </>
                  ) : (
                    <>
                      <Pause className="mr-2 h-4 w-4" />
                      Pause sends
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onRemove(row.original)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [messageTypeCount, onEmail, onOpen, onRemove, onToggleStatus, sendFrequency],
  );

  const table = useReactTable({
    data: clients,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onGlobalFilterChange: onSearchChange,
    globalFilterFn: "includesString",
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.id,
    state: { globalFilter: search, rowSelection },
    initialState: { pagination: { pageSize: 5 } },
  });

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex + 1;
  const selectedIds = table.getSelectedRowModel().rows.map((r) => r.original.id);
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Show</span>
          <Select
            value={String(table.getState().pagination.pageSize)}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">entries</span>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                selectedIds.forEach((id) => onEmail(id));
                table.resetRowSelection();
              }}
            >
              <Mail className="h-3.5 w-3.5" />
              Send to {selectedIds.length}
            </Button>
          ) : null}
          <Input
            className="h-8 w-full sm:w-64"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search customers..."
            aria-label="Search customers"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex cursor-pointer items-center gap-1"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onOpen(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={
                        cell.column.id === "select" || cell.column.id === "actions"
                          ? (e) => e.stopPropagation()
                          : undefined
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="h-24 text-center text-muted-foreground" colSpan={columns.length}>
                  No customers in this view.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-pretty text-muted-foreground">
          Showing{" "}
          {filteredCount === 0
            ? 0
            : table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}{" "}
          to{" "}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            filteredCount,
          )}{" "}
          of {filteredCount} entries
        </p>

        <div className="flex items-center gap-1">
          <Button
            aria-label="Previous page"
            size="icon-sm"
            variant="outline"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => (
            <Button
              aria-label={`Go to page ${page}`}
              key={page}
              size="icon-sm"
              variant={currentPage === page ? "default" : "outline"}
              onClick={() => table.setPageIndex(page - 1)}
            >
              {page}
            </Button>
          ))}
          <Button
            aria-label="Next page"
            size="icon-sm"
            variant="outline"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
