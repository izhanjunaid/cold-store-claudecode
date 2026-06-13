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
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface CheckboxFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  className?: string;
}

export function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  className,
}: CheckboxFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={cn(
            'flex flex-row items-start gap-2.5 space-y-0 rounded-md border p-3',
            className,
          )}
        >
          <FormControl>
            <Checkbox checked={!!field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <div className="space-y-0.5 leading-none">
            <FormLabel className="cursor-pointer">{label}</FormLabel>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}
