'use client'

import React, { useMemo, useState } from 'react'

type SourceFilter = 'all' | 'smithery' | 'github' | 'custom' | 'templates'

export interface MCPImportModalProps {
  open: boolean
  onClose: () => void
  onSelect?: (id: string) => void
  onImport?: (source: SourceFilter, config: Record<string, unknown>) => void
}

export default function MCPImportModal({ open, onClose, onSelect, onImport }: MCPImportModalProps) {
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [query, setQuery] = useState('')

  const items = useMemo(
    () => [
      { id: 'smithery-1', name: 'GitHub Issues MCP', source: 'smithery' as const },
      { id: 'github-1', name: 'Local FS MCP', source: 'github' as const },
      { id: 'custom-1', name: 'Custom MCP Upload', source: 'custom' as const },
    ],
    []
  )

  if (!open) return null

  const visible = items.filter((i) =>
    (filter === 'all' || i.source === filter) && i.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">Import MCP</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search MCPs..."
            className="input"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as SourceFilter)}
            className="input max-w-40"
          >
            <option value="all">All Sources</option>
            <option value="smithery">Smithery</option>
            <option value="github">GitHub</option>
            <option value="custom">Custom</option>
            <option value="templates">Templates</option>
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map((i) => (
            <button
              key={i.id}
              onClick={() => onSelect?.(i.id)}
              className="text-left card-basic hover:bg-accent"
            >
              <div className="text-xs uppercase text-muted-foreground">{i.source}</div>
              <div className="mt-1 font-medium">{i.name}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => onImport?.('custom', {})}>Upload Custom</button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

