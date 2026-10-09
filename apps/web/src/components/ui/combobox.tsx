'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary text shown muted (e.g. capacity, rate). */
  hint?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  /** data-testid on the trigger button for E2E (e.g. combobox-owner_party_id). */
  testId?: string;
  className?: string;
  ariaInvalid?: boolean;
  /**
   * Search on the server instead: called as the user types, and `options` are then
   * shown as given rather than filtered here — for lists too long to load whole.
   */
  onSearchChange?: (search: string) => void;
  /** Trigger label for a value that is not among the current `options` (server search). */
  selectedLabel?: string;
  loading?: boolean;
}

/**
 * Type-ahead entity picker (Popover + cmdk). Keyboard: type to filter,
 * Enter/click to commit, Esc to close.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found.',
  disabled,
  id,
  testId,
  className,
  ariaInvalid,
  onSearchChange,
  selectedLabel,
  loading,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const label = options.find((o) => o.value === value)?.label ?? (value ? selectedLabel : undefined);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          id={id}
          data-testid={testId}
          disabled={disabled}
          className={cn(
            'h-9 w-full justify-between font-normal',
            !label && 'text-muted-foreground',
            ariaInvalid && 'border-destructive',
            className,
          )}
        >
          <span className="truncate">{label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={!onSearchChange}>
          {onSearchChange ? (
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={(s) => {
                setSearch(s);
                onSearchChange(s);
              }}
            />
          ) : (
            <CommandInput placeholder={searchPlaceholder} />
          )}
          <CommandList>
            <CommandEmpty>{loading ? 'Searching…' : emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.hint ?? ''} ${opt.value}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      opt.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">{opt.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
