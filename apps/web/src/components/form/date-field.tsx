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

interface DateFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  required?: boolean;
  min?: string;
  max?: string;
  className?: string;
  inputName?: string;
}

/**
 * Native date input (yyyy-MM-dd). Native because back-office users type
 * dates faster than navigating a calendar popover, and it keeps a real
 * `name` attribute for tests.
 */
export function DateField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  min,
  max,
  className,
  inputName,
}: DateFieldProps<T>) {
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
            <Input
              {...field}
              value={field.value ?? ''}
              name={inputName ?? name}
              type="date"
              min={min}
              max={max}
              className="tabular-nums"
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
