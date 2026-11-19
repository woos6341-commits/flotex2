import { useEffect, useRef, useState } from "react";

/** Direct RPC only. React Query's MutationCache must never receive password/PIN inputs. */
export function useEphemeralMutation<Input, Output>(execute: (input: Input) => Promise<Output>) {
  const [isPending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const operation = useRef(execute);
  operation.current = execute;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const mutateAsync = async (input: Input): Promise<Output> => {
    if (busy.current) throw new Error("الطلب الحالي قيد التنفيذ؛ انتظر نتيجته.");
    busy.current = true;
    if (mounted.current) setPending(true);
    try {
      return await operation.current(input);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { isPending, mutateAsync };
}
