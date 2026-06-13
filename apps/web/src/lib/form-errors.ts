import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api-client';

/**
 * Maps an ApiError to a react-hook-form field error when the API names a
 * field. The API error envelope is { code, message, field? } (see
 * apps/api/src/plugins/error-handler.ts and common/errors.ts), surfaced on
 * ApiError.details. Returns true if a field-level error was applied; the
 * caller should toast the message otherwise.
 */
export function applyApiErrorToForm<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  /** Optional map from API field names to form field names if they differ. */
  fieldMap?: Record<string, Path<T>>,
): boolean {
  if (!(error instanceof ApiError)) return false;

  const details = error.details as { field?: string } | undefined;
  const apiField = details?.field;
  if (!apiField) return false;

  const formField = (fieldMap?.[apiField] ?? apiField) as Path<T>;
  setError(formField, { type: 'server', message: error.message });
  return true;
}
