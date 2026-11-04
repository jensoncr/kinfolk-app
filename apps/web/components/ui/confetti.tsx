"use client";

import confetti from "canvas-confetti";
import type {
  GlobalOptions as ConfettiGlobalOptions,
  CreateTypes as ConfettiInstance,
  Options as ConfettiOptions,
} from "canvas-confetti";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentPropsWithoutRef,
  type Ref,
} from "react";

// Confetti — adapted from https://magicui.design/docs/components/confetti.
// Renders its own canvas so bursts are scoped to wherever the component is
// mounted; expose `fire()` through a ref so callers trigger it imperatively.
type ConfettiProps = ComponentPropsWithoutRef<"canvas"> & {
  options?: ConfettiOptions;
  globalOptions?: ConfettiGlobalOptions;
  ref?: Ref<ConfettiRef>;
  // When true, the canvas mounts silently and only fires via the ref.
  manualstart?: boolean;
};

const DEFAULT_GLOBAL_OPTIONS: ConfettiGlobalOptions = {
  resize: true,
  useWorker: true,
};

export type ConfettiRef = {
  fire: (options?: ConfettiOptions) => void;
} | null;

export function Confetti({
  options,
  globalOptions = DEFAULT_GLOBAL_OPTIONS,
  manualstart = false,
  ref,
  ...rest
}: ConfettiProps) {
  const instanceRef = useRef<ConfettiInstance | null>(null);
  const latestOptionsRef = useRef(options);
  const manualstartRef = useRef(manualstart);
  const didAutoFireRef = useRef(false);

  useEffect(() => {
    latestOptionsRef.current = options;
    manualstartRef.current = manualstart;
  }, [manualstart, options]);

  const canvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (node !== null) {
        if (instanceRef.current) return;
        instanceRef.current = confetti.create(node, globalOptions);
        if (!manualstartRef.current && !didAutoFireRef.current) {
          didAutoFireRef.current = true;
          window.requestAnimationFrame(() => {
            instanceRef.current?.({ ...latestOptionsRef.current })?.catch(() => {
              /* canvas torn down mid-burst — nothing to recover */
            });
          });
        }
      } else if (instanceRef.current) {
        instanceRef.current.reset();
        instanceRef.current = null;
        didAutoFireRef.current = false;
      }
    },
    [globalOptions],
  );

  const fire = useCallback(
    (opts: ConfettiOptions = {}) => {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      instanceRef.current?.({ ...latestOptionsRef.current, ...opts })?.catch(() => {
        /* canvas torn down mid-burst — nothing to recover */
      });
    },
    [],
  );

  useImperativeHandle(ref, () => ({ fire }), [fire]);

  return <canvas ref={canvasRef} {...rest} />;
}
