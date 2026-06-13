'use client';

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';

interface UseApiMutationOptions<TData, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  /** Query keys invalidated after a successful mutation. */
  invalidates?: QueryKey[];
  /** Toast shown on success; pass a function to include result data. */
  successMessage?: string | ((data: TData) => string);
  /** Suppress the automatic error toast (e.g. when mapping errors to form fields). */
  silentError?: boolean;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: unknown, variables: TVariables) => void;
}

/**
 * Mutation wrapper with sonner feedback and query invalidation.
 * ApiError messages come from the API's error envelope ({ code, message, field? }).
 */
export function useApiMutation<TData = unknown, TVariables = void>({
  mutationFn,
  invalidates = [],
  successMessage,
  silentError,
  onSuccess,
  onError,
}: UseApiMutationOptions<TData, TVariables>) {
  const queryClient = useQueryClient();

  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess: (data, variables) => {
      for (const key of invalidates) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      if (successMessage) {
        toast.success(
          typeof successMessage === 'function' ? successMessage(data) : successMessage,
        );
      }
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      if (!silentError) {
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error('Something went wrong. Please try again.');
        }
      }
      onError?.(error, variables);
    },
  });
}
