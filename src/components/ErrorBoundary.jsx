import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by boundary:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" style={{ height: '100%' }}>
          <p style={{ color: 'var(--danger)', fontWeight: 700 }}>Что-то пошло не так</p>
          <p style={{ maxWidth: 420, fontSize: 12.5 }}>{String(this.state.error.message || this.state.error)}</p>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Вернуться
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
