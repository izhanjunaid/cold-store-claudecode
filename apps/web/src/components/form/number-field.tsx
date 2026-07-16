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
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface NumberFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
  suffix?: string;
  className?: string;
  inputName?: string;
}

/**
 * Numeric input. Stores the raw string in the form (empty string when
 * cleared) so the zod schema can coerce/validate; submit handlers parse.
 */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  description,
  required,
  min,
  max,
  step,
  suffix,
  className,
  inputName,
}: NumberFieldProps<T>) {
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
          <div className="relative">
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                name={inputName ?? name}
                type="number"
                inputMode="decimal"
                placeholder={placeholder}
                min={min}
                max={max}
                step={step}
                className={cn('tabular-nums', suffix && 'pr-12')}
              />
            </FormControl>
            {suffix && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {suffix}
              </span>
            )}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
