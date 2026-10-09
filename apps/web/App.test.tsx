import { render, screen } from '@testing-library/react-native';
import App from './App';

test('renders the development screen', async () => {
  await render(<App />);

  expect(screen.getByRole('header', { name: 'Bounce Challenge' })).toBeTruthy();
  expect(screen.getByText('Ready for development.')).toBeTruthy();
});
