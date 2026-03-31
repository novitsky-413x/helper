import { useState, useCallback, type ReactNode } from "react";

export function CodeBlock(props: {
  className?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const language = props.className?.replace(/^language-/, "") ?? "";

  const text =
    typeof props.children === "string"
      ? props.children
      : Array.isArray(props.children)
        ? props.children.map(String).join("")
        : String(props.children ?? "");

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        {language && <span className="code-block-lang">{language}</span>}
        <button
          type="button"
          className="code-block-copy"
          onClick={handleCopy}
          aria-label="Copy code"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code className={props.className}>{props.children}</code>
    </div>
  );
}
