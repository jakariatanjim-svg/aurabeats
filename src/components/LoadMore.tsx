/** "More" at the end of a paged list: loads by itself when it scrolls near. */
import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import type { PagedState } from "@/hooks/useYtPaged";

export function LoadMore({ st, onMore }: { st: PagedState<unknown>; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  const can = !!st.next && !st.loading && !st.error;
  useEffect(() => {
    const el = ref.current;
    if (!el || !can) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more.current(), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [can, st.items.length]);
  if (!st.next && !st.error) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      {st.error ? (
        <Button variant="outline" onClick={onMore}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      ) : (
        <Spinner />
      )}
    </div>
  );
}
