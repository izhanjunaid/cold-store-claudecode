'use client';

import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: SelectOption[];
  placeholder?: string;
  description?: string;
  required?: boolean;
  className?: string;
  inputName?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Native <select> styled to match the design system. Native because short
 * enum fields are faster for keyboard-driven entry and keep a real `name`
 * attribute for tests. Use ComboboxField for large entity lists instead.
 */
export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder,
  description,
  required,
  className,
  inputName,
  onValueChange,
}: SelectFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn('space-y-1.5', className)}>
          <FormLabel>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </FormLabel>
          <FormControl>
            <select
              {...field}
              value={field.value ?? ''}
              name={inputName ?? name}
              onChange={(e) => {
                field.onChange(e);
                onValueChange?.(e.target.value);
              }}
              className={cn(
                'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                !field.value && 'text-muted-foreground',
              )}
            >
              {placeholder && <option value="">{placeholder}</option>}
              {options.map((opt) => (
                <option key={opt.value} value={opt.value} className="text-foreground">
                  {opt.label}
                </option>
              ))}
            </select>
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
