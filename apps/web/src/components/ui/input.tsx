import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    // A wheel scroll over a *focused* number input increments/decrements its
    // value — a silent edit to an amount somebody is about to post, with no
    // undo and no visual cue that it happened. Blurring first makes the page
    // scroll instead. This lives in the shared primitive rather than on each
    // money field so that no future form can forget it.
    const handleWheel = React.useCallback(
      (e: React.WheelEvent<HTMLInputElement>) => {
        if (type === "number") e.currentTarget.blur()
        onWheel?.(e)
      },
      [type, onWheel]
    )

    return (
      <input
        type={type}
        onWheel={handleWheel}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
