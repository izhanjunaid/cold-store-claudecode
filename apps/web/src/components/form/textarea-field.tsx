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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface TextareaFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  placeholder?: string;
  description?: string;
  required?: boolean;
  rows?: number;
  className?: string;
  inputName?: string;
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  description,
  required,
  rows = 3,
  className,
  inputName,
}: TextareaFieldProps<T>) {
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
            <Textarea
              {...field}
              value={field.value ?? ''}
              name={inputName ?? name}
              placeholder={placeholder}
              rows={rows}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
