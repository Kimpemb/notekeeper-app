// src/features/editor/components/Editor/NodeViewErrorBoundary.tsx
import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  label?: string;
  children: ReactNode;
}

interface State {
  crashed: boolean;
}

export class NodeViewErrorBoundary extends Component<Props, State> {
  state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[NodeViewErrorBoundary] ${this.props.label ?? "node"} crashed:`, error);
  }

  render() {
    if (this.state.crashed) {
      return (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 10px",
            borderRadius: "6px",
            fontSize: "12px",
          }}
          className="bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7 4v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="7" cy="10" r="0.75" fill="currentColor"/>
          </svg>
          Failed to render {this.props.label ?? "block"}
        </div>
      );
    }
    return this.props.children;
  }
}