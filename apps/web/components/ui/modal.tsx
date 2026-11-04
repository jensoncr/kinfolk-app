"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";

const Modal = DialogPrimitive.Root;
const ModalTrigger = DialogPrimitive.Trigger;
const ModalPortal = DialogPrimitive.Portal;

function ModalOverlay({
  className = "",
  ...props
}: ComponentPropsWithRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-kin-overlay=""
      className={`fixed inset-0 z-40 bg-[rgba(14,31,23,0.32)] backdrop-blur-[6px] ${className}`}
      {...props}
    />
  );
}

type ModalContentProps = ComponentPropsWithRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  children: ReactNode;
  hideClose?: boolean;
};

function ModalContent({
  className = "",
  title,
  description,
  children,
  hideClose = false,
  ...props
}: ModalContentProps) {
  return (
    <ModalPortal>
      <ModalOverlay />
      <DialogPrimitive.Content
        className={`kin-modal-base z-50 grid w-[calc(100%-2rem)] max-w-[420px] gap-5 rounded-2xl border border-[var(--pp-hairline)] bg-white p-5 text-[var(--pp-ink)] shadow-[0_18px_50px_-20px_rgba(14,31,23,0.32)] outline-none sm:p-6 ${className}`}
        {...props}
      >
        <div className="flex flex-col gap-1 pr-8 text-left">
          <DialogPrimitive.Title className="serif text-[22px] leading-[1.15] tracking-[-0.01em] text-[var(--pp-ink)]">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-[13px] leading-[1.5] text-[var(--pp-ink-60)]">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="kin-focus absolute right-4 top-4 grid size-8 place-items-center rounded-full text-[var(--pp-ink-40)] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[var(--pp-ink-80)]"
          >
            <X aria-hidden="true" size={16} strokeWidth={1.7} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </ModalPortal>
  );
}

export { Modal, ModalTrigger, ModalContent };
