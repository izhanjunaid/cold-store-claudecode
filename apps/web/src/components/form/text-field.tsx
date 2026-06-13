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

interface TextFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'tel' | 'password';
  maxLength?: number;
  className?: string;
  /** Forwarded as the input's name attribute (defaults to `name`) for E2E selectors. */
  inputName?: string;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  description,
  required,
  type = 'text',
  maxLength,
  className,
  inputName,
}: TextFieldProps<T>) {
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
              type={type}
              placeholder={placeholder}
              maxLength={maxLength}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
