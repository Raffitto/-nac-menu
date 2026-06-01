import { render, screen } from '@testing-library/react';
import App from './App';

test('renders public menu shell', () => {
  render(<App />);
  expect(screen.getByText(/All Menus/i)).toBeInTheDocument();
});
