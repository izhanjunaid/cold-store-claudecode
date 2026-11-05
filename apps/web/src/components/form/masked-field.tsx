'use client';

import type { ReactNode } from 'react';
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
import { MASKS, MASK_PLACEHOLDER, type Mask } from './masks';

interface MaskedFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  mask: Mask;
  placeholder?: string;
  description?: string;
  required?: boolean;
  className?: string;
  inputName?: string;
  /** Extra content under the input, e.g. the trucks-inside chips beside a plate field. */
  children?: ReactNode;
}

/** Text field with lightweight input masking for phone / CNIC / vehicle. */
export function MaskedField<T extends FieldValues>({
  control,
  name,
  label,
  mask,
  placeholder,
  description,
  required,
  className,
  inputName,
  children,
}: MaskedFieldProps<T>) {
  const apply = MASKS[mask];
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value ?? ''}
              name={inputName ?? name}
              inputMode={mask === 'vehicle' ? 'text' : 'numeric'}
              placeholder={placeholder ?? MASK_PLACEHOLDER[mask]}
              onChange={(e) => field.onChange(apply(e.target.value))}
            />
          </FormControl>
          {children}
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
