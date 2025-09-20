"use client"

import { XYPosition } from '@xyflow/react'

interface ServerMergeZoneProps {
  isActive: boolean
  position?: XYPosition
  serverCount: number
  previewName?: string
}

export function ServerMergeZone({
  isActive,
  position = { x: 0, y: 0 },
  serverCount,
  previewName = 'Drop to merge'
}: ServerMergeZoneProps) {
  if (!isActive) return null

  return (
    <div
      className="absolute pointer-events-none z-40"
      style={{
        left: position.x - 55,
        top: position.y - 55,
      }}
    >
      <div className="w-28 h-28 border-2 border-dashed border-primary/80 rounded-full bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-1 text-xs font-medium text-primary">
        <span className="inline-flex h-2 w-2 rounded-full bg-primary" />
        <span className="uppercase tracking-wide">{previewName}</span>
        <span className="text-[10px] text-muted-foreground">{serverCount} server{serverCount === 1 ? '' : 's'}</span>
      </div>
    </div>
  )
}
