import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  translate?: (key: string) => string;
}

interface State {
  hasError: boolean;
}

/**
 * Error boundary that catches React rendering errors and shows a
 * localized, body-free recovery UI. Raw error details are never
 * displayed or logged to protect user privacy.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // Intentionally no-op: raw error details must not be logged
    // to protect user privacy (file paths, provider content, etc.).
  }

  handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const t = this.props.translate ?? ((key: string) => key);

      return (
        <div className="error-boundary" role="alert" aria-live="assertive">
          <div className="error-boundary__card">
            <h2 className="error-boundary__title">{t("errorBoundary.title")}</h2>
            <p className="error-boundary__description">
              {t("errorBoundary.description")}
            </p>
            <button
              type="button"
              className="error-boundary__retry"
              onClick={this.handleReset}
              autoFocus
            >
              {t("errorBoundary.retry")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
