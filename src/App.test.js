import { render, screen } from '@testing-library/react';
import App from './App';

test('renders public menu shell', () => {
  render(<App />);
  expect(screen.getByText(/All Menus/i)).toBeInTheDocument();
});

test.each([
  ["/khobar", "NAC"],
  ["/riyadh", "NAC Riyadh"],
  ["/jeddah", "NAC Jeddah"],
])('public route %s sets the configured branch document title', (path, title) => {
  window.history.replaceState({}, '', path);
  const { unmount } = render(<App />);
  expect(document.title).toBe(title);
  unmount();
});
