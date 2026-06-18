"use client";

import { useState } from "react";

/**
 * Password input with a reveal (show/hide) toggle, styled to match the auth
 * screens. The toggle button is type="button" so it never submits the form;
 * flipping type between "password" and "text" lets the user confirm what they
 * typed or pasted. Paste is never blocked (standard input, no onPaste handler).
 */
export default function PasswordField({
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
  id,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  id?: string;
  testId?: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={reveal ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full h-7 pl-2 pr-9 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        aria-label={reveal ? "Hide password" : "Show password"}
        aria-pressed={reveal}
        data-testid={testId ? `${testId}-reveal` : undefined}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-7 grid place-items-center rounded-[3px] text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] focus:outline-none focus:text-[var(--color-navy-700)]"
        tabIndex={-1}
      >
        {reveal ? (
          // eye-off
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 2l12 12" />
            <path d="M6.6 6.62a2 2 0 002.78 2.86" />
            <path d="M4.3 4.36C2.9 5.23 1.85 6.5 1.3 8c1.1 2.9 3.8 4.8 6.7 4.8 1.2 0 2.35-.33 3.35-.9" />
            <path d="M7 3.28A6.9 6.9 0 018 3.2c2.9 0 5.6 1.9 6.7 4.8a9 9 0 01-1.7 2.6" />
          </svg>
        ) : (
          // eye
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M1.3 8C2.4 5.1 5.1 3.2 8 3.2s5.6 1.9 6.7 4.8c-1.1 2.9-3.8 4.8-6.7 4.8S2.4 10.9 1.3 8z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        )}
      </button>
    </div>
  );
}
