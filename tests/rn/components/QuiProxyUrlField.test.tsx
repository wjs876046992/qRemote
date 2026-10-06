import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { QuiProxyUrlField } from '@/components/QuiProxyUrlField';

jest.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('./theme-mock').mockColors }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts?.url ? `${key}|${opts.url}` : key),
  }),
}));

const KEY = 'sup3rS3cretKey';

describe('QuiProxyUrlField', () => {
  it('masks the URL by default and reveals it with the eye toggle', async () => {
    await render(<QuiProxyUrlField value="" onChangeText={jest.fn()} />);
    const input = screen.getByLabelText('server.quiProxyUrl');
    expect(input.props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByLabelText('server.quiProxyShowUrl'));
    expect(screen.getByLabelText('server.quiProxyUrl').props.secureTextEntry).toBe(false);

    await fireEvent.press(screen.getByLabelText('server.quiProxyHideUrl'));
    expect(screen.getByLabelText('server.quiProxyUrl').props.secureTextEntry).toBe(true);
  });

  it('shows only the hint for an empty value (no error, no preview)', async () => {
    await render(<QuiProxyUrlField value="  " onChangeText={jest.fn()} />);
    expect(screen.getByText('server.quiProxyHint')).toBeTruthy();
    expect(screen.queryByText(/server\.quiProxyError/)).toBeNull();
    expect(screen.queryByText(/server\.quiProxyPreview/)).toBeNull();
  });

  it('shows a resolved preview with the key masked, never the key itself', async () => {
    await render(
      <QuiProxyUrlField
        value={`https://qui.example.com:8443/qui/proxy/${KEY}`}
        onChangeText={jest.fn()}
      />,
    );
    expect(
      screen.getByText('server.quiProxyPreview|https://qui.example.com:8443/qui/proxy/••••'),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(KEY))).toBeNull();
    expect(screen.queryByText(/server\.quiProxyError/)).toBeNull();
  });

  it.each([
    ['qui.example.com/proxy/abc', 'server.quiProxyErrorScheme'],
    ['https://qui.example.com/qui', 'server.quiProxyErrorProxyPath'],
    ['https://qui.example.com:99999/proxy/abc', 'server.quiProxyErrorPort'],
    ['https://user@qui.example.com/proxy/abc', 'server.quiProxyErrorHost'],
  ])('shows an inline error for %s', async (value, errorKey) => {
    await render(<QuiProxyUrlField value={value} onChangeText={jest.fn()} />);
    expect(screen.getByText(errorKey)).toBeTruthy();
    expect(screen.queryByText(/server\.quiProxyPreview/)).toBeNull();
  });

  it('uses a custom hint when provided', async () => {
    await render(<QuiProxyUrlField value="" onChangeText={jest.fn()} hint="custom hint" />);
    expect(screen.getByText('custom hint')).toBeTruthy();
    expect(screen.queryByText('server.quiProxyHint')).toBeNull();
  });

  it('reports typed text', async () => {
    const onChangeText = jest.fn();
    await render(<QuiProxyUrlField value="" onChangeText={onChangeText} />);
    await fireEvent.changeText(screen.getByLabelText('server.quiProxyUrl'), 'https://h/proxy/k');
    expect(onChangeText).toHaveBeenCalledWith('https://h/proxy/k');
  });
});
